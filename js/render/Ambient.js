import { HW, HH } from './iso.js';
import { PLAYER } from '../data/gameData.js';

/**
 * CANLILIK: oynanışı etkilemeyen, dünyayı yaşar gösteren küçük ayrıntılar (Ayarlar → "Canlılık" ile kapatılabilir).
 *  • Kuş sürüleri  : gündüz ekranın bir ucundan diğerine V düzeninde kanat çırparak geçer; yerde gölgeleri kayar.
 *  • Tavuklar      : Kasaba Merkezi ve evlerin çevresinde gezinir, durup yem gagalar.
 *  • Balık sürüsü  : kaynağın altında daire çizen balık gölgeleri ve hafif halkalar (miktar azaldıkça seyrelir).
 *  • Zıplayan balık: görünür sularda ara sıra bir balık sıçrar; sıçrama halkası + alçak sesli "şıp".
 *  • Baca dumanı   : ev, Kasaba Merkezi, kışla, pazar… çatının en yüksek noktasından ince duman.
 * Tüm konumlar dünya koordinatındadır; çizimler Renderer'ın kamera dönüşümü altında yapılır.
 */
const CHIMNEY = new Set(['house', 'townCenter', 'barracks', 'market', 'lumberCamp', 'miningCamp', 'stable', 'siegeWorkshop', 'dock']);

const rnd = (a, b) => a + Math.random() * (b - a);

export class Ambient {
  constructor(renderer) {
    this.r = renderer;
    this.world = renderer.world;
    this.flocks = [];
    this.chickens = [];
    this.jumps = [];
    this.flockT = rnd(4, 10);
    this.jumpT = rnd(2, 5);
    this._chimney = new WeakMap(); // sprite → çatı tepe noktası (oran)
    this._initChickens();
  }

  _initChickens() {
    const tc = this.world.townCenter;
    if (!tc) return;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.4;
      this.chickens.push({ home: tc, x: tc.centerI + Math.cos(a) * 3.6, y: tc.centerJ + Math.sin(a) * 3.6, tx: 0, ty: 0,
        wait: rnd(0, 3), peck: 0, facing: 1, hop: rnd(0, 6), white: k % 3 !== 0 });
    }
  }

  update(dt, frame) {
    const w = this.world, day = (frame.darkness ?? 0) < 0.45;
    const storm = w.weather.intensity > 0.5 && w.weather.kind !== 'fog';
    // Kuşlar
    this.flockT -= dt;
    if (this.flockT <= 0 && day && !storm && this.flocks.length < 2) { this._spawnFlock(); this.flockT = rnd(14, 30); }
    for (const f of this.flocks) { f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt; }
    this.flocks = this.flocks.filter((f) => f.life > 0);
    // Tavuklar: kısa yürüyüş → bekle/gagala; geceleri kümeste (gizli)
    for (const c of this.chickens) {
      if (!w.isAlive(c.home)) { c.gone = true; continue; }
      c.hop += dt * 9;
      if (c.wait > 0) {
        c.wait -= dt;
        c.peck = Math.max(0, c.peck - dt);
        if (Math.random() < dt * 0.8) c.peck = 0.35;
        if (c.wait <= 0) {
          const h = c.home, a = Math.random() * Math.PI * 2, r = rnd(2.8, 4.8);
          c.tx = h.centerI + Math.cos(a) * r; c.ty = h.centerJ + Math.sin(a) * r;
          if (!w.map.isWalkable(Math.round(c.tx), Math.round(c.ty))) { c.wait = 0.5; continue; }
        }
        continue;
      }
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d < 0.05) { c.wait = rnd(1.5, 5); if (Math.random() < 0.15) w.sound('cluck', c.x, c.y, 0.25); continue; }
      const step = Math.min(d, 0.9 * dt);
      c.x += (dx / d) * step; c.y += (dy / d) * step;
      if (Math.abs(dx - dy) > 0.01) c.facing = dx - dy > 0 ? 1 : -1;
    }
    // Zıplayan balık
    this.jumpT -= dt;
    if (this.jumpT <= 0) { this.jumpT = rnd(3, 7); this._spawnJump(); }
    for (const j of this.jumps) j.t += dt;
    this.jumps = this.jumps.filter((j) => j.t < 1.6);
  }

  _spawnFlock() {
    const v = this.r._viewRect(0), n = 5 + ((Math.random() * 5) | 0);
    const fromLeft = Math.random() < 0.5, speed = rnd(70, 110);
    const y = rnd(v.t + (v.b - v.t) * 0.1, v.t + (v.b - v.t) * 0.7);
    const x = fromLeft ? v.l - 120 : v.r + 120;
    const vy = rnd(-0.25, 0.25) * speed, vx = (fromLeft ? 1 : -1) * speed;
    const birds = [];
    for (let k = 0; k < n; k++) { const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1; birds.push({ ox: -row * 16 * Math.sign(vx), oy: side * row * 11, ph: Math.random() * 6 }); }
    this.flocks.push({ x, y, vx, vy, birds, alt: rnd(70, 130), life: ((v.r - v.l) + 400) / speed });
  }

  _spawnJump() {
    const v = this.r._viewRect(0), map = this.world.map, fog = this.world.fog;
    for (let tries = 0; tries < 30; tries++) {
      const wx = rnd(v.l, v.r), wy = rnd(v.t, v.b);
      const i = Math.round((wy / HH + wx / HW) / 2), j = Math.round((wy / HH - wx / HW) / 2);
      if (!map.inBounds(i, j) || map.waterDepth[j][i] < 2) continue;
      if (fog && !fog.isVisible(i, j)) continue;
      this.jumps.push({ x: wx, y: wy, t: 0, dir: Math.random() < 0.5 ? 1 : -1 });
      this.world.sound('splash', i, j, 0.3);
      return;
    }
  }

  // ───────── Çizim (kamera dönüşümü altında) ─────────
  /** Su üstü: balık sürüleri ve sıçramalar (birimlerden önce) */
  drawWater(ctx, frame) {
    const t = frame.time, v = this.r._viewRect(40), fog = this.world.fog, map = this.world.map;
    ctx.save();
    for (const f of this.world.fishNodes ?? []) {
      if (!this.world.isAlive(f)) continue;
      const cx = (f.i - f.j) * HW, cy = (f.i + f.j) * HH;
      if (cx < v.l || cx > v.r || cy < v.t || cy > v.b) continue;
      if (fog && !fog.isExplored(f.i, f.j)) continue;
      const n = 2 + Math.ceil((f.amount / f.maxAmount) * 4);
      ctx.fillStyle = 'rgba(10,35,50,0.38)';
      for (let k = 0; k < n; k++) {
        const a = t * (0.6 + k * 0.07) + k * 1.9 + f.i, r = 7 + (k % 3) * 5;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.5;
        ctx.beginPath(); ctx.ellipse(x, y, 4, 1.6, a + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
      }
      const ph = (t * 0.35 + f.j * 0.13) % 1;
      ctx.strokeStyle = `rgba(230,245,255,${0.35 * (1 - ph)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, 6 + ph * 18, (6 + ph * 18) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const j of this.jumps) {
      const p = Math.min(1, j.t / 0.9);
      if (j.t < 0.9) {
        const x = j.x + j.dir * (p - 0.5) * 22, y = j.y - Math.sin(Math.PI * p) * 18;
        ctx.fillStyle = 'rgba(70,90,100,0.95)';
        ctx.beginPath(); ctx.ellipse(x, y, 5, 2, j.dir * (p - 0.5) * 2.2, 0, Math.PI * 2); ctx.fill();
      }
      for (const [at, ox] of [[0, -11], [0.9, 11]]) { // çıkış ve dalış halkaları
        const q = (j.t - at) / 0.7;
        if (q < 0 || q > 1) continue;
        ctx.strokeStyle = `rgba(235,248,255,${0.6 * (1 - q)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(j.x + j.dir * ox, j.y, 3 + q * 14, (3 + q * 14) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
    void map;
  }

  /** Tavuklar: birimlerle aynı derinlik sırasına girer (Renderer listesine "deco" olarak eklenir) */
  chickenItems(frame) {
    if ((frame.darkness ?? 0) > 0.6) return []; // gece kümeste
    const fog = this.world.fog, out = [];
    for (const c of this.chickens) {
      if (c.gone) continue;
      if (fog && !fog.isVisible(c.x, c.y)) continue;
      out.push({ deco: true, draw: (ctx) => this._drawChicken(ctx, c), wx: (c.x - c.y) * HW, wy: (c.x + c.y) * HH });
    }
    return out;
  }

  _drawChicken(ctx, c) {
    const x = (c.x - c.y) * HW, y = (c.x + c.y) * HH;
    const walking = c.wait <= 0, hop = walking ? Math.abs(Math.sin(c.hop)) * 1.6 : 0, peck = c.peck > 0 ? Math.sin((0.35 - c.peck) / 0.35 * Math.PI) : 0;
    const s = this.r.sprites.get('chicken');
    ctx.drawImage(this.r.sprites.shadow, x - 5, y - 2, 10, 4);
    if (s) {
      const h = 11, w = h / s.aspect;
      ctx.save();
      ctx.translate(x, y - hop);
      if (c.facing < 0) ctx.scale(-1, 1);
      ctx.rotate(peck * 0.5);
      ctx.drawImage(s.pick(w * 2), -w * s.anchorX, -h, w, h);
      ctx.restore();
      return;
    }
    // Görsel yoksa basit çizim: gövde, kuyruk, ibik, gaga
    ctx.save();
    ctx.translate(x, y - hop);
    ctx.scale(c.facing, 1);
    ctx.fillStyle = c.white ? '#f2ede2' : '#a8642e';
    ctx.beginPath(); ctx.ellipse(0, -4, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-3.5, -6, 1.6, 2.4, -0.5, 0, Math.PI * 2); ctx.fill();
    const hx = 3.2, hy = -7 + peck * 4;
    ctx.beginPath(); ctx.arc(hx, hy, 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d83a2a'; ctx.fillRect(hx - 0.8, hy - 2.6, 1.6, 1.2);
    ctx.fillStyle = '#e8b030'; ctx.beginPath(); ctx.moveTo(hx + 1.6, hy - 0.4); ctx.lineTo(hx + 3, hy + 0.2); ctx.lineTo(hx + 1.6, hy + 0.7); ctx.fill();
    ctx.restore();
  }

  /** Baca dumanı (birimlerden sonra) */
  drawSmoke(ctx, frame) {
    const t = frame.time, v = this.r._viewRect(120), fog = this.world.fog, fx = this.r.fx;
    const winter = this.world.weather.season.id === 'winter', k = winter || (frame.darkness ?? 0) > 0.3 ? 1 : 0.7;
    for (const L of this.r.pickList) {
      const b = L.obj;
      if (!b.isBuilding || !b.complete || !CHIMNEY.has(b.type)) continue;
      if (L.cx < v.l || L.cx > v.r || L.y > v.b || L.y + L.h < v.t) continue;
      if (b.owner !== PLAYER && fog && !fog.seesObject(b)) continue;
      const p = this._chimneyPoint(L.s);
      const x = L.x + L.w * p.u, y = L.y + L.h * p.v, base = L.w * 0.05;
      for (let q = 0; q < 4; q++) {
        const ph = (t * 0.22 + q / 4 + b.id * 0.13) % 1, sz = base * (1 + ph * 3);
        ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, ph * 1.3)) * 0.32 * k * (1 - ph * 0.4);
        ctx.drawImage(fx.smoke, x + ph * ph * base * 5 - sz / 2, y - ph * L.h * 0.55 - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Sprite'ın orta bölgesinde en üstteki dolu piksel (bacanın/çatının tepesi) */
  _chimneyPoint(s) {
    let p = this._chimney.get(s);
    if (p) return p;
    p = { u: 0.5, v: 0.1 };
    for (let vv = 0.02; vv < 0.6; vv += 0.01) {
      let hit = -1;
      for (let uu = 0.3; uu <= 0.7; uu += 0.02) if (s.hit(uu, vv)) { hit = uu; break; }
      if (hit >= 0) { p = { u: hit + 0.02, v: vv + 0.02 }; break; }
    }
    this._chimney.set(s, p);
    return p;
  }

  /** Kuşlar ve yerdeki gölgeleri (en üstte, gece katmanından önce) */
  drawBirds(ctx, frame) {
    const t = frame.time;
    for (const f of this.flocks) {
      for (const b of f.birds) {
        const x = f.x + b.ox, y = f.y + b.oy;
        const flap = Math.sin(t * 9 + b.ph), span = 6;
        // gölge (yerde, kuşun altında ve biraz aşağıda)
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath(); ctx.ellipse(x + 10, y + f.alt, 4, 1.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,28,26,0.9)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - span, y - flap * 4);
        ctx.quadraticCurveTo(x - span * 0.4, y - 1 - flap * 2, x, y);
        ctx.quadraticCurveTo(x + span * 0.4, y - 1 - flap * 2, x + span, y - flap * 4);
        ctx.stroke();
      }
    }
  }
}
