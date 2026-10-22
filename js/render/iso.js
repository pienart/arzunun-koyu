import { CONFIG } from '../config.js';

/** Yarım karo boyutları: tüm izometrik formüller bu iki değere dayanır. */
export const HW = CONFIG.TILE_WIDTH / 2;
export const HH = CONFIG.TILE_HEIGHT / 2;

/**
 * Grid (i, j) → Dünya (x, y)   [karonun MERKEZİ]
 * İzometrik projeksiyon = grid'i 45° döndürüp dikeyde yarıya basmak:
 *   x = (i − j) · W/2      y = (i + j) · H/2
 */
export function tileToWorld(i, j) {
  return { x: (i - j) * HW, y: (i + j) * HH };
}

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
