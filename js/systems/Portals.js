import { StaticObject } from '../world/GameMap.js';

const MOVE_EVERY = 300;  // sn: geçitler 5 dakikada bir yer değiştirir
const COOLDOWN = 4;      // aynı birim art arda ışınlanmasın

/**
 * GİZEMLİ GEÇİT (portal): haritanın en uç bölgelerinde (kenarlara yakın) iki ağız. Birinin üstüne basan kara birimi
 * diğerinden çıkar. Ağızlar her dakika başka uç noktalara taşınır. Görünüşü: kütüklerle örtülmüş toprak tümsek.
 * Kullanım: birimleri seçip geçidin üstüne sağ tıklayın.
 */
export class Portals {
  constructor(world) {
    this.world = world;
    this.ends = [];
    this.timer = MOVE_EVERY;
  }

  setup() { this._relocate(); }

  update(dt) {
    const w = this.world;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = MOVE_EVERY; this._relocate(); }
    if (this.ends.length < 2) return;
    for (const u of w.units) {
      if (u.naval || u.dead || (u._portalAt ?? -99) > w.time - COOLDOWN) continue;
      const o = w.map.occupancy[u.tileJ]?.[u.tileI];
      const k = this.ends.indexOf(o);
      if (k < 0) continue;
      const out = this._exit(this.ends[1 - k]);
      if (!out) continue;
      u.x = u.prevX = out.i; u.y = u.prevY = out.j;
      u._portalAt = w.time;
      u.stop();
      if (u.owner === 1) w.sound('ram', out.i, out.j, 0.25);
    }
  }

  /** Geçidin önünde (ayak izi dışında) yürünebilir karo */
  _exit(p) {
    const map = this.world.map;
    for (let r = 1; r <= 4; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = p.i + di, j = p.j + dj;
        if (map.occupancy[j]?.[i] === p) continue;
        if (map.isWalkable(i, j)) return { i, j };
      }
    }
    return null;
  }

  /** İki farklı kenara yakın (kenardan 6–20 karo içeride), 2×2 boş kara noktası seç */
  _relocate() {
    const map = this.world.map, W = map.width, H = map.height;
    for (const e of this.ends) map.removeObject(e);
    this.ends = [];
    const sides = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    for (const side of sides) {
      if (this.ends.length >= 2) break;
      for (let attempt = 0; attempt < 400; attempt++) {
        const along = 10 + Math.random() * (W - 20), depth = 6 + Math.random() * 14;
        const i = Math.round(side === 0 ? depth : side === 1 ? W - depth : along);
        const j = Math.round(side === 2 ? depth : side === 3 ? H - depth : along);
        if (!map.canPlace(i - 1, j - 1, 2)) continue;
        if (!map.isWalkable(i + 1, j + 1) && !map.isWalkable(i - 2, j - 2)) continue;
        const p = new StaticObject('portal', i, j, { size: 2, blocks: false });
        p.isPortal = true;
        this.ends.push(map.addObject(p));
        break;
      }
    }
  }
}
