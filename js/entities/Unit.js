import { UNITS, PLAYER } from '../data/gameData.js';
import { ANIMS, UNIT_PREFIX, WALK_DIRS } from '../data/animData.js';

let NEXT_ID = 1;

/**
 * Unit: tüm hareketli birimlerin ortak tabanı (köylü, milis, okçu).
 *  - Konum grid uzayında kesirli (x = i, y = j); prevX/prevY render enterpolasyonu için.
 *  - Yol takibi (A* çıktısı), yön (sprite aynalama), savaş (kovalama + saldırı döngüsü).
 * Alt sınıflar update() içinde kendi durum makinelerini çalıştırır.
 */
export class Unit {
  constructor(type, i, j, owner = PLAYER) {
    this.id = NEXT_ID++;
    this.type = type;
    this.def = UNITS[type];
    this.owner = owner;
    this.isUnit = true;
    this.x = i; this.y = j;
    this.prevX = i; this.prevY = j;
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.path = [];
    this.goal = null;       // { fn, hi, hj } → yol tıkanırsa yeniden hesaplamak için
    this.state = 'idle';
    this.phase = null;
    this.task = null;
    this.facing = 1;        // 1 = sağa (sprite'ın doğal yönü), −1 = sola (aynala)
    this.moving = false;
    this.anim = Math.random() * 10;
    this.dead = false;
    // Savaş
    this.target = null;
    this.cooldown = Math.random() * 0.5;
    this.attackAnim = 0;    // > 0 iken saldırı pozu gösterilir
    this.repathT = 0;
    this.scanT = Math.random() * 0.4;
    this.resume = null;     // hedef ölünce dönülecek durum ('attackMove' | 'guard' | null)
    this.walkDist = Math.random() * 2; // yürüyüş animasyonu: toplam alınan yol (karo) → kare mesafeyle ilerler
    this.engaged = false;   // bu tick'te hedef menzilde ve vuruyor (saldırı animasyonu)
    // Ekrandaki yürüyüş yönü (yumuşatılmış birim vektör) ve seçili 8'li dilim (0 = sağ, saat yönünde)
    this.hx = 1; this.hy = 0;
    this.dir = 0;
  }

  /**
   * Hareket yönünü güncelle. Izgaradaki adım (di, dj) ekranda (di − dj, (di + dj)/2) yönüne düşer.
   * Vektör üstel olarak yumuşatılır (köşe dönüşlerinde ani sıçrama olmaz); dilim değişimi için
   * 8°'lik eşik payı vardır (iki yön arasında titreme olmaz).
   */
  _steer(di, dj, dt) {
    const sx = di - dj, sy = (di + dj) * 0.5, len = Math.hypot(sx, sy);
    if (len < 1e-6) return;
    const k = 1 - Math.exp(-14 * dt);
    this.hx += (sx / len - this.hx) * k;
    this.hy += (sy / len - this.hy) * k;
    const ang = Math.atan2(this.hy, this.hx);
    let diff = ang - this.dir * (Math.PI / 4);
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > Math.PI / 8 + 0.14) this.dir = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  }

  get prefix() { return UNIT_PREFIX[this.type] ?? 'vil'; }

  /**
   * Animasyon durumu { name, phase } (Renderer kare seçer). null → durağan "idle" sprite'ı.
   * Alt sınıflar genişletir; burada yalnızca ortak yardımcılar var.
   */
  get animState() { return null; }

  /** Yürüyüş: 8 yönden birinin animasyonu (yoksa yan görünüme düşer), kare alınan yola bağlı */
  _walkAnim(base) {
    const d = WALK_DIRS[this.dir];
    return { name: base + d.suffix, base, flip: d.flip, phase: (this.walkDist / (ANIMS[base]?.stride ?? 1.3)) % 1 };
  }

  /** Saldırı döngüsü yeniden dolma süresine eşit; hasar anında (cooldown = reload) kare = vuruş anı */
  _attackAnim(name) {
    const reload = this.def.reload;
    const t = (reload - Math.max(0, this.cooldown)) / reload;
    return { name, phase: (t + (ANIMS[name]?.hit ?? 0.5)) % 1 };
  }

  get tileI() { return Math.round(this.x); }
  get tileJ() { return Math.round(this.y); }
  get name() { return this.def.name; }
  get isMilitary() { return !this.def.civil && !this.def.naval; }

  /** Bu karoya adım atılabilir mi? (kendi kapısı dahil; düşman çiti hayır — önce kırılmalı) */
  canWalk(world, i, j) { return world.passFor(this)(i, j) === 1 || this._canEnter(i, j); }

  stop() {
    this.state = 'idle'; this.phase = null; this.task = null; this.path = []; this.goal = null;
    this.target = null; this.resume = null;
  }

  /** Belirli bir hedefe saldır (sağ tık veya otomatik hedef seçimi) */
  attack(target, resume = null) {
    this.path = []; this.goal = null; this.task = null; this.phase = null;
    this.target = target;
    this.state = 'attack';
    this.resume = resume;
    this.repathT = 0;
  }

  speed(world) {
    const p = world.players[this.owner];
    let v = this.def.speed * (this.def.civil && !this.def.vehicle ? p.modifiers.speed : 1) + (p.bonus[this.type]?.speed ?? 0);
    if ((p.effects?.swift ?? 0) > world.time) v *= 1.4;          // Rüzgâr İksiri
    const o = world.map.occupancy[this.tileJ]?.[this.tileI];
    if (o?.def?.ground && o.complete) v *= 1.35;                 // patika
    return v;
  }

  /** Yolu takip eder; vardığında true döner. */
  followPath(dt, world) {
    if (this.path.length === 0) return true;
    const [ni, nj] = this.path[0];
    if (!this.canWalk(world, ni, nj)) {
      // Yol üzerine bina kondu → yeniden hesapla
      if (!this.goal || !world.repath(this)) { this.path = []; return true; }
      return false;
    }
    let step = this.speed(world) * dt;
    while (step > 0 && this.path.length) {
      const [ti, tj] = this.path[0];
      const dx = ti - this.x, dy = tj - this.y, d = Math.hypot(dx, dy);
      const sx = dx - dy; // ekrandaki yatay yön → sprite aynalama
      if (Math.abs(sx) > 0.01) this.facing = sx > 0 ? 1 : -1;
      if (d > 1e-6) this._steer(dx / d, dy / d, dt);
      if (d <= step) {
        this.x = ti; this.y = tj;
        this.path.shift();
        step -= d;
        this.walkDist += d;
      } else {
        this.x += (dx / d) * step;
        this.y += (dy / d) * step;
        this.walkDist += step;
        step = 0;
      }
    }
    this.moving = true;
    return this.path.length === 0;
  }

  _canEnter() { return false; }

  face(obj) {
    const cx = obj.centerI ?? obj.x ?? obj.i, cy = obj.centerJ ?? obj.y ?? obj.j;
    const sx = (cx - this.x) - (cy - this.y);
    if (Math.abs(sx) > 0.05) this.facing = sx > 0 ? 1 : -1;
    // Yönlü görselli birimler (tekne, koçbaşı) hedefe döner
    if (this.def.naval || this.def.siege) {
      const dx = cx - this.x, dy = cy - this.y, d = Math.hypot(dx, dy);
      if (d > 0.05) this._steer(dx / d, dy / d, 0.2);
    }
  }

  /**
   * Saldırı döngüsü: hedef menzil dışındaysa kovala (yolu periyodik yenile), içindeyse dur ve vur.
   * Yakın dövüş hasarı anında, okçu hasarı mermi (ok) varınca uygulanır.
   * @returns {boolean} hedef hâlâ geçerli mi
   */
  updateAttack(dt, world) {
    const t = this.target;
    if (!world.isAlive(t)) { this.target = null; return false; }
    if (world.inAttackRange(this, t)) {
      this.path = [];
      this.engaged = true;
      this.face(t);
      if (this.cooldown <= 0) {
        this.cooldown = this.def.reload;
        this.attackAnim = 0.45;
        world.performAttack(this, t);
      }
    } else {
      this.repathT -= dt;
      if (this.repathT <= 0 || this.path.length === 0) {
        this.repathT = t.isUnit ? 0.8 : 2.5;
        if (!world.moveToAttack(this, t)) { this.target = null; return false; }
      }
      // Hedefe giden yol bir düşman çitinden geçiyorsa önce çiti kır (sonra eski hedefe döner)
      const next = this.path[0];
      const wall = next && world.blockingWall(this, next[0], next[1]);
      if (wall && wall !== t) { this.target = wall; this.repathT = 0; return true; }
      this.followPath(dt, world);
    }
    return true;
  }

  /** Ortak zamanlayıcılar */
  tick(dt) {
    this.prevX = this.x; this.prevY = this.y;
    this.moving = false;
    this.engaged = false;
    this.anim += dt;
    this.cooldown -= dt;
    this.attackAnim -= dt;
    this.scanT -= dt;
  }
}
