import { CONFIG } from '../config.js';

/** Yarım karo boyutları: tüm izometrik formüller bu iki değere dayanır. */
export const HW = CONFIG.TILE_WIDTH / 2;
export const HH = CONFIG.TILE_HEIGHT / 2;

/**
 * Dünya → Grid (kesirli). Doğrusal dönüşümün tersi:
 *   x/HW = i − j,  y/HH = i + j   ⇒   i = (y/HH + x/HW)/2,   j = (y/HH − x/HW)/2
 */
export function worldToTileFloat(x, y) {
  const a = x / HW, b = y / HH;
  return { i: (b + a) / 2, j: (b - a) / 2 };
}

/** Karo merkezleri tam sayı olduğundan Math.round imlecin altındaki karoyu birebir verir. */
export function worldToTile(x, y) {
  const t = worldToTileFloat(x, y);
  return { i: Math.round(t.i), j: Math.round(t.j) };
}

/** Eşkenar dörtgen yol çizer (ctx veya Path2D). */
export function traceDiamond(target, cx, cy, hw = HW, hh = HH) {
  target.moveTo(cx, cy - hh);
  target.lineTo(cx + hw, cy);
  target.lineTo(cx, cy + hh);
  target.lineTo(cx - hw, cy);
  target.closePath();
}

/** Kare ayak izinin (origin, size) 4 köşesi dünya koordinatında: üst, sağ, alt, sol */
export function footprintCorners(oi, oj, size) {
  const P = (gi, gj) => [(gi - gj) * HW, (gi + gj) * HH];
  const i0 = oi - 0.5, j0 = oj - 0.5, i1 = oi + size - 0.5, j1 = oj + size - 0.5;
  return [P(i0, j0), P(i1, j0), P(i1, j1), P(i0, j1)];
}

/**
 * Parçalı yol: Chromium'da tek bir Path2D'ye on binlerce alt şekil eklemek karesel yavaşlar
 * (20 bin elmas ~0,8 sn, 40 bin ~3,2 sn). Bu sınıf aynı moveTo/lineTo/closePath arayüzüyle her `n` şekilde
 * yeni bir Path2D'ye geçer; fillPath tüm parçaları doldurur. fresh(): sonraki şekiller yeni parçada başlasın
 * (sarım kuralının aynı yolda olmasını gerektiren dikdörtgen + delik gibi bileşik şekiller için).
 */
export class ChunkedPath {
  constructor(n = 600) { this.n = n; this.list = [new Path2D()]; this.c = 0; }
  get cur() { return this.list[this.list.length - 1]; }
  fresh() { if (this.c > 0) { this.list.push(new Path2D()); this.c = 0; } }
  moveTo(x, y) { if (this.c >= this.n) this.fresh(); this.cur.moveTo(x, y); }
  lineTo(x, y) { this.cur.lineTo(x, y); }
  rect(x, y, w, h) { this.cur.rect(x, y, w, h); }
  closePath() { this.cur.closePath(); this.c++; }
}

/** Path2D veya ChunkedPath doldur */
export function fillPath(ctx, p) {
  if (p.list) for (const x of p.list) ctx.fill(x); else ctx.fill(p);
}
