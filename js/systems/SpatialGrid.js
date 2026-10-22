/**
 * Mekânsal ızgara: birimleri CELL×CELL karoluk kovalara yerleştirir.
 * "Yakındaki düşman", kule hedefi ve birimlerin birbirini itmesi gibi sorgular tüm birimleri değil yalnızca
 * çevredeki kovaları tarar → birim sayısı arttıkça maliyet doğrusal kalır (n² değil).
 * Her simülasyon adımında baştan kurulur (birkaç yüz birim için ~0,1 ms).
 */
export class SpatialGrid {
  constructor(width, height, cell = 8) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
  }

  rebuild(units) {
    for (const b of this.buckets) b.length = 0;
    const c = this.cell;
    for (const u of units) {
      if (u.dead) continue;
      const ci = Math.min(this.cols - 1, Math.max(0, (u.x / c) | 0));
      const cj = Math.min(this.rows - 1, Math.max(0, (u.y / c) | 0));
      this.buckets[cj * this.cols + ci].push(u);
    }
  }

  /** (x, y) çevresinde r karo içindeki kovalardaki birimler için fn(u) (mesafe kontrolü çağırana aittir) */
  each(x, y, r, fn) {
    const c = this.cell;
    const i0 = Math.max(0, ((x - r) / c) | 0), i1 = Math.min(this.cols - 1, ((x + r) / c) | 0);
    const j0 = Math.max(0, ((y - r) / c) | 0), j1 = Math.min(this.rows - 1, ((y + r) / c) | 0);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const b = this.buckets[j * this.cols + i];
        for (let k = 0; k < b.length; k++) fn(b[k]);
      }
    }
  }
}
