import { PLAYER } from '../data/gameData.js';

/**
 * SAVAŞ SİSİ
 *  explored[k] = 1 → bu karo bir kez görüldü (arazi ve binalar hatırlanır, üstü yarı karanlık)
 *  visible[k]  = 1 → şu an görüş alanında (düşman birimleri yalnızca burada görünür)
 *
 * Görüş 0,25 sn'de bir yeniden hesaplanır (birim başına küçük bir daire damgası). Sonuç, karo başına bir
 * piksellik bir görüntüye yazılır; Renderer bunu izometrik dönüşümle ve yumuşatarak çizer → kenarlar
 * yumuşak geçişli bir sis olur, karo karo merdiven görünmez.
 */
const UNSEEN = 255, EXPLORED = 120; // görüntüdeki karanlık (alfa) seviyeleri

export class Fog {
  constructor(map, enabled = true) {
    this.map = map;
    this.W = map.width;
    this.H = map.height;
    this.enabled = enabled;
    this.explored = new Uint8Array(this.W * this.H);
    this.visible = new Uint8Array(this.W * this.H);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(this.W, this.H);
    this.version = 0;
    this._t = 0;
    if (!enabled) { this.explored.fill(1); this.visible.fill(1); }
  }

  isVisible(i, j) {
    if (!this.enabled) return true;
    i = Math.round(i); j = Math.round(j);
    return i >= 0 && j >= 0 && i < this.W && j < this.H && this.visible[j * this.W + i] === 1;
  }

  isExplored(i, j) {
    if (!this.enabled) return true;
    i = Math.round(i); j = Math.round(j);
    return i >= 0 && j >= 0 && i < this.W && j < this.H && this.explored[j * this.W + i] === 1;
  }

  /** Bir nesnenin (bina: ayak izinin herhangi bir karosu) görünür olup olmadığı */
  seesObject(o) {
    if (!this.enabled) return true;
    if (o.isUnit) return this.isVisible(o.x, o.y);
    for (let j = o.originJ; j <= o.j; j++) for (let i = o.originI; i <= o.i; i++) if (this.isVisible(i, j)) return true;
    return false;
  }

  knowsObject(o) {
    if (!this.enabled) return true;
    for (let j = o.originJ; j <= o.j; j++) for (let i = o.originI; i <= o.i; i++) if (this.isExplored(i, j)) return true;
    return false;
  }

  update(dt, world, nightFactor = 0) {
    if (!this.enabled) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.25;
    const vis = this.visible, exp = this.explored, W = this.W, H = this.H;
    vis.fill(0);
    // Gece görüş biraz kısalır (kamp ateşi ve binalar yine aydınlatır)
    const k = 1 - 0.25 * nightFactor;
    const stamp = (ci, cj, r) => {
      const r2 = r * r, i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(W - 1, Math.ceil(ci + r));
      const j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(H - 1, Math.ceil(cj + r));
      for (let j = j0; j <= j1; j++) {
        const dy = j - cj, row = j * W;
        for (let i = i0; i <= i1; i++) {
          const dx = i - ci;
          if (dx * dx + dy * dy <= r2) { vis[row + i] = 1; exp[row + i] = 1; }
        }
      }
    };
    for (const u of world.units) if (u.owner === PLAYER) stamp(u.x, u.y, (u.def.los + 1.5) * k);
    for (const b of world.buildings) {
      if (b.owner !== PLAYER) continue;
      const r = b.complete ? (b.type === 'townCenter' ? 9 : b.def.attack ? 8 : b.size + 3) : b.size + 1.5;
      stamp(b.centerI, b.centerJ, r);
    }
    if (world.campfire) stamp(world.campfire.i, world.campfire.j, 4);
    this._paint();
  }

  _paint() {
    const d = this.image.data, vis = this.visible, exp = this.explored;
    for (let k = 0, n = vis.length; k < n; k++) {
      d[k * 4 + 3] = vis[k] ? 0 : exp[k] ? EXPLORED : UNSEEN;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.version++;
  }

  /** Kayıt için: keşfedilmiş karolar (base64) */
  serialize() {
    let s = '';
    const e = this.explored;
    for (let k = 0; k < e.length; k += 8192) s += String.fromCharCode.apply(null, e.subarray(k, k + 8192));
    return btoa(s);
  }

  restore(b64) {
    if (!b64) return;
    const s = atob(b64);
    for (let k = 0; k < s.length && k < this.explored.length; k++) this.explored[k] = s.charCodeAt(k);
    this._t = 0;
  }
}
