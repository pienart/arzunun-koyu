/**
 * A* yol bulma (8 yönlü, köşe kesme yasak).
 *
 * Performans notları:
 *  - Düğümler tek boyutlu indeksle (j * W + i) tutulur; dizi tahsisi her aramada değil, bir kez yapılır.
 *  - "Ziyaret damgası" (stamp) tekniği: her aramada dizileri sıfırlamak yerine bir sayaç artırılır;
 *    stamp[n] !== mevcut arama → düğüm bu aramada hiç görülmemiş demektir. O(1) sıfırlama.
 *  - Açık liste ikili yığın (binary heap) → en düşük f değerli düğüm O(log n).
 */
const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export class Pathfinder {
  constructor(map) {
    this.map = map;
    const n = map.width * map.height;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.search = 0;
    this.heap = new Int32Array(n);
    this.heapSize = 0;
  }

  /**
   * @param {number} si, sj   başlangıç karosu
   * @param {(i:number,j:number)=>boolean} isGoal  hedef testi (ör. "binanın yanındaki karo mu?")
   * @param {number} hi, hj   sezgisel (heuristic) için hedef merkezi
   * @param {number} maxNodes güvenlik sınırı (ulaşılamayan hedefte tüm haritayı taramasın)
   * @returns {Array<[number,number]>|null} başlangıç hariç karo listesi; zaten hedefteyse []
   */
  find(si, sj, isGoal, hi, hj, maxNodes = 12000, pass = null) {
    const map = this.map, W = map.width;
    // pass(i, j) → 0: geçilemez, 1: normal, >1: geçilebilir ama pahalı (ör. düşmanın kırarak geçeceği çit)
    pass ??= (i, j) => (map.isWalkable(i, j) ? 1 : 0);
    this.partial = false;           // true: hedefe ulaşılamadı, en yakın noktaya giden yarım yol döndü
    if (isGoal(si, sj)) return [];
    const s = ++this.search;
    const start = sj * W + si;
    this.heapSize = 0;
    this.g[start] = 0;
    this.f[start] = this._h(si, sj, hi, hj);
    this.came[start] = -1;
    this.stamp[start] = s;
    this._push(start);

    let expanded = 0, best = start, bestH = Infinity;
    while (this.heapSize > 0) {
      const cur = this._pop();
      if (this.closed[cur] === s) continue;
      this.closed[cur] = s;
      const ci = cur % W, cj = (cur / W) | 0;
      if (isGoal(ci, cj)) return this._build(cur);

      const h = this.f[cur] - this.g[cur];
      if (h < bestH) { bestH = h; best = cur; }
      if (++expanded > maxNodes) break;

      for (let d = 0; d < 8; d++) {
        const [di, dj, cost] = DIRS[d];
        const ni = ci + di, nj = cj + dj;
        const c = pass(ni, nj);
        if (!c) continue;
        // Köşe kesme yasağı: çapraz gidişte iki dik komşu da geçilebilir olmalı
        if (di !== 0 && dj !== 0 && (!pass(ci + di, cj) || !pass(ci, cj + dj))) continue;
        const n = nj * W + ni;
        if (this.closed[n] === s) continue;
        const ng = this.g[cur] + cost * c;
        if (this.stamp[n] !== s || ng < this.g[n]) {
          this.stamp[n] = s;
          this.g[n] = ng;
          this.f[n] = ng + this._h(ni, nj, hi, hj);
          this.came[n] = cur;
          this._push(n);
        }
      }
    }
    // Hedefe ulaşılamadı: en yakın noktaya kadar git (RTS'lerde beklenen davranış)
    this.partial = true;
    return best !== start ? this._build(best) : null;
  }

  /** Oktil mesafe: 8 yönlü ızgarada kabul edilebilir (admissible) sezgisel */
  _h(i, j, hi, hj) {
    const dx = Math.abs(i - hi), dy = Math.abs(j - hj);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  }

  _build(n) {
    const W = this.map.width, path = [];
    while (this.came[n] !== -1) {
      path.push([n % W, (n / W) | 0]);
      n = this.came[n];
    }
    return path.reverse();
  }

  // ---- ikili yığın ----
  _push(n) {
    const heap = this.heap, f = this.f;
    let k = this.heapSize++;
    heap[k] = n;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  }

  _pop() {
    const heap = this.heap, f = this.f;
    const top = heap[0];
    const last = heap[--this.heapSize];
    if (this.heapSize > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < this.heapSize && f[heap[l]] < f[heap[m]]) m = l;
        if (r < this.heapSize && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  }
}
