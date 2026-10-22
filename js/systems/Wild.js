import { PLAYER, ENEMY, WILD, WILD_DEF, RESOURCE_NAMES } from '../data/gameData.js';
import { StaticObject } from '../world/GameMap.js';
import { Yeti } from '../entities/Yeti.js';

/**
 * VAHŞİ DOĞA: mağara ve Koca Ayak
 *  • Mağara, oyun başında haritanın rastgele ama HEM oyuncuya HEM düşmana uzak, karadan ulaşılabilir bir yerine konur.
 *  • Yaratık yalnızca KIŞIN çıkar (mevsim döngüsü 30 dk → 30 dakikada bir). Önce rastgele bir tarafın üssüne,
 *    WILD_DEF.huntTime sn sonra diğerine saldırır. Kış bitince mağarasına döner ve orada iyileşir.
 *  • Öldürülürse o kış bir daha çıkmaz; öldüren taraf ödül alır. Sonraki kış yeni bir yaratık uyanır.
 */
export class Wild {
  constructor(world) {
    this.world = world;
    this.cave = null;
    this.yeti = null;        // dışarıdaysa birim
    this.doneThisWinter = false;
    this.winterT = 0;        // bu kışın kaçıncı saniyesi
    this.huntT = 0;
    this.side = PLAYER;      // şu an saldırdığı taraf
  }

  // ───────────── Yerleşim ─────────────
  setup() {
    const spot = this._findCaveSpot();
    if (spot) this._placeCave(spot.i, spot.j);
  }

  _placeCave(oi, oj) {
    const map = this.world.map;
    // Ayak izi ve mağara ağzının önü (2 karo) ağaç/çalı/kütükten temizlenir: giriş görünür ve geçilebilir kalsın
    for (let j = oj - 1; j < oj + 5; j++) {
      for (let i = oi - 1; i < oi + 5; i++) {
        const o = map.occupancy[j]?.[i];
        if (!o || o.isBuilding) continue;
        if (o.kind === 'tree' || o.kind === 'stump' || o.kind === 'berry' || (i >= oi && i < oi + 3 && j >= oj && j < oj + 3)) map.removeObject(o);
      }
    }
    this.cave = map.addObject(new StaticObject('cave', oi + 2, oj + 2, { size: 3, blocks: true }));
  }

  /** Mağaranın önündeki (ekranda alt) yürünebilir karo: yaratık buradan çıkar ve buraya döner */
  get door() {
    const c = this.cave;
    return c ? this.world.map.findWalkableNear(c.i + 1, c.j + 1, 5) : null;
  }

  _findCaveSpot() {
    const w = this.world, map = w.map, W = map.width;
    const tcs = [w.townCenter, w.enemyAI.tc].filter(Boolean);
    if (!tcs.length) return null;
    const start = map.findWalkableNear(Math.round(tcs[0].centerI) + 3, Math.round(tcs[0].centerJ) + 3, 8);
    if (!start) return null;
    // Oyuncu üssünden karadan ulaşılabilen karolar (taşkın doldurma)
    const seen = new Uint8Array(W * map.height), q = [start.j * W + start.i];
    seen[q[0]] = 1;
    for (let k = 0; k < q.length; k++) {
      const n = q[k], ci = n % W, cj = (n / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj, m = nj * W + ni;
        if (!map.inBounds(ni, nj) || seen[m] || !map.isWalkable(ni, nj)) continue;
        seen[m] = 1; q.push(m);
      }
    }
    const cands = [];
    for (const n of q) {
      const i = n % W, j = (n / W) | 0;
      if (i < 4 || j < 4 || i > W - 8 || j > map.height - 8) continue;
      if (!map.canPlace(i - 3, j - 3, 3)) continue;  // mağara ayak izi bu karonun sol-üstünde, kapı = bu karo
      const d = Math.min(...tcs.map((t) => Math.hypot(t.centerI - i, t.centerJ - j)));
      if (d < 30) continue;
      cands.push({ i: i - 3, j: j - 3, d });
    }
    if (!cands.length) return null;
    // En uzak %20'lik dilimden rastgele biri: hem uzak hem her oyunda farklı
    cands.sort((a, b) => b.d - a.d);
    const top = cands.slice(0, Math.max(1, Math.ceil(cands.length * 0.2)));
    return top[(Math.random() * top.length) | 0];
  }

  // ───────────── Döngü ─────────────
  update(dt) {
    const w = this.world;
    if (!this.cave) return;
    const winter = w.weather.season.id === 'winter';
    if (!winter) {
      this.winterT = 0;
      this.doneThisWinter = false;
      if (this.yeti && !this.yeti.dead && !this.yeti.home) this._sendHome();
      return;
    }
    this.winterT += dt;
    if (!this.yeti && !this.doneThisWinter && this.winterT >= WILD_DEF.delay) this._emerge();
    const y = this.yeti;
    if (!y || y.dead || y.home) return;
    this.huntT -= dt;
    if (this.huntT <= 0) this._hunt(this.side === PLAYER ? ENEMY : PLAYER);
    else if (y.state === 'idle') this._hunt(this.side);
  }

  _emerge() {
    const w = this.world, door = this.door;
    if (!door) return;
    const y = new Yeti(door.i, door.j);
    this.yeti = y;
    w.units.push(y);
    this.doneThisWinter = true;
    this._hunt(Math.random() < 0.5 ? PLAYER : ENEMY);
    w.notify('Kış geldi… Mağaradaki Koca Ayak uyandı ve köylere iniyor!', 'warn');
    w.sound('horn');
    w.alert(this.cave.centerI ?? this.cave.i, this.cave.centerJ ?? this.cave.j);
  }

  /** Taraf seç ve onun kasaba merkezine (yoksa herhangi bir binasına) saldırı yürüyüşü */
  _hunt(side) {
    const w = this.world, y = this.yeti;
    let target = side === PLAYER ? w.townCenter : w.enemyAI.tc;
    if (!w.isAlive(target)) target = w.buildings.find((b) => b.owner === side);
    if (!target) { // o taraf yok → diğeri
      side = side === PLAYER ? ENEMY : PLAYER;
      target = w.buildings.find((b) => b.owner === side);
      if (!target) return;
    }
    this.side = side;
    this.huntT = WILD_DEF.huntTime;
    y.attackMoveTo(w, Math.round(target.centerI), Math.round(target.centerJ));
    if (side === PLAYER) w.notify('Koca Ayak köyünüze doğru geliyor!', 'warn');
  }

  _sendHome() {
    const w = this.world, y = this.yeti, door = this.door;
    y.stop();
    y.home = true;
    if (!door || !w.moveToGoal(y, (i, j) => i === door.i && j === door.j, door.i, door.j, 30000)) this.enterCave(y);
    w.notify('Kar eriyor: Koca Ayak mağarasına çekiliyor.', 'info');
  }

  /** Yaratık mağaraya girdi: haritadan kalkar (bir sonraki kışa kadar) */
  enterCave(y) {
    const w = this.world;
    w.units = w.units.filter((u) => u !== y);
    y.dead = true; // seçimden ve hedeflerden düşsün
    if (this.yeti === y) this.yeti = null;
  }

  /** World.killUnit çağırır: öldüren tarafa ödül */
  onKilled(y, killerOwner) {
    const w = this.world;
    if (this.yeti === y) this.yeti = null;
    const p = w.players[killerOwner];
    if (killerOwner === PLAYER) {
      for (const [k, v] of Object.entries(WILD_DEF.reward)) p.add(k, v);
      w.notify(`Koca Ayak öldürüldü! Ödül: ${Object.entries(WILD_DEF.reward).map(([k, v]) => `${v} ${RESOURCE_NAMES[k].toLowerCase()}`).join(', ')}.`, 'good');
      w.sound('fanfare');
    } else if (killerOwner === ENEMY) {
      for (const [k, v] of Object.entries(WILD_DEF.reward)) p.add(k, v);
      w.notify('Düşman Koca Ayak\'ı öldürdü.', 'info');
    } else w.notify('Koca Ayak öldü.', 'info');
  }

  serialize() {
    return { cave: this.cave ? [this.cave.originI, this.cave.originJ] : null, done: this.doneThisWinter, winterT: this.winterT, huntT: this.huntT, side: this.side };
  }

  /** Kayıttan: mağarayı geri koy; dışarıdaki yaratık SaveGame tarafından birim olarak eklenir (attach) */
  restore(s) {
    if (!s) { this.setup(); return; }
    if (s.cave) this._placeCave(s.cave[0], s.cave[1]);
    this.doneThisWinter = !!s.done; this.winterT = s.winterT ?? 0; this.huntT = s.huntT ?? 0; this.side = s.side ?? PLAYER;
  }

  attach(y) {
    this.yeti = y;
    if (this.world.weather.season.id !== 'winter') this._sendHome();
    else this._hunt(this.side);
  }
}

