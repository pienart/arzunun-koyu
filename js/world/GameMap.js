import { TileId, TileRegistry } from './TileTypes.js';
import { ValueNoise2D, mulberry32 } from './Noise.js';
import { RESOURCE_NODES } from '../data/gameData.js';

/**
 * Haritaya yerleşen hareketsiz nesnelerin ortak tabanı.
 * (i, j) = ÇAPA karo: kapladığı alanın en ÖNDEKİ (ekranda en alttaki) karosu.
 */
export class StaticObject {
  constructor(kind, i, j, { variant = 0, size = 1, blocks = true, offX = 0, offY = 0, scale = 1, flip = false } = {}) {
    this.kind = kind;
    this.i = i;
    this.j = j;
    this.variant = variant;
    this.size = size;     // kare ayak izi
    this.blocks = blocks; // yol bulmada engel mi?
    this.offX = offX;     // karo içi kaydırma (grid birimi)
    this.offY = offY;
    this.scale = scale;
    this.flip = flip;
  }
  get originI() { return this.i - this.size + 1; }
  get originJ() { return this.j - this.size + 1; }
  /** İzometrik derinlik anahtarı: ayak izi MERKEZİNİN (i + j) toplamı. Büyük nesnelerde satır sırasından daha doğru. */
  get depth() { return this.i + this.j - (this.size - 1) + this.offX + this.offY; }
  get name() { return this.kind; }
}

/** Toplanabilir doğal kaynak (ağaç, meyve, altın, taş). */
export class ResourceNode extends StaticObject {
  constructor(kind, i, j, opts = {}) {
    super(kind, i, j, opts);
    const def = RESOURCE_NODES[kind];
    this.resType = def.resType;
    this.amount = opts.amount ?? def.amount;
    this.maxAmount = this.amount;
    this.isResource = true;
  }
  get name() { return RESOURCE_NODES[this.kind].name; }
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const grid2D = (w, h, makeRow) => Array.from({ length: h }, () => makeRow(w));

/**
 * GameMap: arazi + statik nesneler + doluluk (occupancy) ızgarası.
 * Her veri katmanı ayrı bir 2D dizidir: terrain[j][i]
 */
export class GameMap {
  constructor(width, height, seed = 1) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.terrain    = grid2D(width, height, (w) => new Uint8Array(w));
    this.waterDepth = grid2D(width, height, (w) => new Uint8Array(w));
    this.shoreMask  = grid2D(width, height, (w) => new Uint8Array(w));
    this.objects    = grid2D(width, height, (w) => new Array(w).fill(null)); // çapa karodaki nesne
    this.occupancy  = grid2D(width, height, (w) => new Array(w).fill(null)); // kaplanan tüm karolar
    this.spawn = { i: width >> 1, j: height >> 1 };
    this.version = 0;      // statik görünüm değişti → Renderer yeniden çizer
    this.terrainVersion = 0; // yalnızca arazi değişimi → minimap
    this.groundVersion = 0;  // zemin katmanında çizilen şey değişti (çiftlik) → zemin yeniden çizilir
    this._generate();
  }

  // ───────────── Sorgular ─────────────
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.width && j < this.height; }
  getTile(i, j) { return this.inBounds(i, j) ? this.terrain[j][i] : -1; }
  getObjectAt(i, j) { return this.inBounds(i, j) ? this.occupancy[j][i] : null; }

  /** Yol bulmanın temel sorusu: bu karoya yürünebilir mi? */
  isWalkable(i, j) {
    if (i < 0 || j < 0 || i >= this.width || j >= this.height) return false;
    if (!TileRegistry.get(this.terrain[j][i]).walkable) return false;
    const o = this.occupancy[j][i];
    return !o || !o.blocks;
  }

  /** Bina yerleştirilebilir mi? (ayak izi tamamen boş ve inşa edilebilir zemin) */
  canPlace(oi, oj, size) {
    for (let j = oj; j < oj + size; j++) {
      for (let i = oi; i < oi + size; i++) {
        if (!this.inBounds(i, j)) return false;
        if (!TileRegistry.get(this.terrain[j][i]).buildable) return false;
        if (this.occupancy[j][i]) return false;
      }
    }
    return true;
  }

  /** Kıyı mı? Ayak izini çevreleyen halkada (köşeler hariç) en az `min` su karosu olmalı (tersane için) */
  isCoastal(oi, oj, size, min = 2) {
    let n = 0;
    for (let k = 0; k < size; k++) {
      if (this.getTile(oi + k, oj - 1) === TileId.WATER) n++;
      if (this.getTile(oi + k, oj + size) === TileId.WATER) n++;
      if (this.getTile(oi - 1, oj + k) === TileId.WATER) n++;
      if (this.getTile(oi + size, oj + k) === TileId.WATER) n++;
    }
    return n >= min;
  }

  addObject(obj) {
    this.objects[obj.j][obj.i] = obj;
    for (let j = obj.originJ; j <= obj.j; j++) {
      for (let i = obj.originI; i <= obj.i; i++) this.occupancy[j][i] = obj;
    }
    this.version++;
    return obj;
  }

  removeObject(obj) {
    if (this.objects[obj.j]?.[obj.i] === obj) this.objects[obj.j][obj.i] = null;
    for (let j = obj.originJ; j <= obj.j; j++) {
      for (let i = obj.originI; i <= obj.i; i++) {
        if (this.occupancy[j]?.[i] === obj) this.occupancy[j][i] = null;
      }
    }
    this.version++;
  }

  /** (i, j) çevresinde, merkezden dışa doğru halka halka arayarak ilk yürünebilir karoyu bulur. */
  findWalkableNear(ci, cj, maxR = 12) {
    for (let r = 0; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.isWalkable(ci + di, cj + dj)) return { i: ci + di, j: cj + dj };
        }
      }
    }
    return null;
  }

  // ───────────── Prosedürel üretim ─────────────
  _generate() {
    const W = this.width, H = this.height;
    const rand = mulberry32(this.seed);
    this.rand = rand;
    const elevNoise = new ValueNoise2D(this.seed);
    const forestNoise = new ValueNoise2D(this.seed + 101);
    const dirtNoise = new ValueNoise2D(this.seed + 202);

    // 1) Yükseklik (fBm) → [0,1] normalize
    const elev = grid2D(W, H, (w) => new Float32Array(w));
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const e = elevNoise.fbm(i * 0.04, j * 0.04, 5);
        elev[j][i] = e;
        if (e < min) min = e;
        if (e > max) max = e;
      }
    }

    // 2) Kenar sönümü (ada) + eşiklerle zemin tipi
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const dx = (i / (W - 1)) * 2 - 1, dy = (j / (H - 1)) * 2 - 1;
        const edge = Math.max(Math.abs(dx), Math.abs(dy));
        const e = (elev[j][i] - min) / (max - min) - smoothstep(0.75, 1.0, edge) * 0.8;
        elev[j][i] = e;
        let t;
        if (e < 0.305) t = TileId.WATER;   // biraz daha geniş göller ve deniz
        else if (e < 0.33) t = TileId.SAND;
        else if (e < 0.75) t = dirtNoise.fbm(i * 0.09, j * 0.09, 3) > 0.64 ? TileId.DIRT : TileId.GRASS;
        else t = TileId.GRASS;             // kayalık (dağ) yok: yüksek yerler de çayır
        this.terrain[j][i] = t;
      }
    }

    // 2b) Küçük su birikintilerini kurut: kumun ortasında tek karelik "su elmasları" kalmasın
    this._removeSmallLakes(220); // küçük su birikintisi kalmasın: yalnızca geniş göller ve deniz

    // 3) Başlangıç noktası: merkeze en yakın, geniş ve açık alan
    this.spawn = this._findOpenArea(W >> 1, H >> 1, 4, 3) ?? { i: W >> 1, j: H >> 1 };
    const sc = { i: this.spawn.i + 2, j: this.spawn.j + 2 }; // 4×4 kasaba merkezinin ortası

    // 4) Dağ kayaları ve ormanlar
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const t = this.terrain[j][i];
        const distSpawn = Math.hypot(i - sc.i, j - sc.j);
        if (t === TileId.MOUNTAIN) {
          // Her dağ karosu bir kaya sprite'ı; ölçek ve aynalama çeşitliliği sıradağ görünümü verir
          this.addObject(new StaticObject('mountain', i, j, {
            scale: 0.75 + rand() * 0.45 + (elev[j][i] - 0.75) * 1.2, flip: rand() < 0.5,
            offX: (rand() - 0.5) * 0.3, offY: (rand() - 0.5) * 0.3,
          }));
        } else if ((t === TileId.GRASS || t === TileId.DIRT) && distSpawn > 7) {
          const dense = forestNoise.fbm(i * 0.07, j * 0.07, 4) > 0.58;
          const chance = (dense ? 0.6 : 0.012) * (t === TileId.DIRT ? 0.35 : 1); // daha seyrek ormanlar
          if (rand() < chance) {
            const r = rand();
            this.addObject(new ResourceNode('tree', i, j, {
              variant: r < 0.45 ? 0 : r < 0.8 ? 1 : 2, // meşe / çam / sonbahar
              scale: 0.85 + rand() * 0.3, flip: rand() < 0.5,
              offX: (rand() - 0.5) * 0.35, offY: (rand() - 0.5) * 0.35,
            }));
          }
        }
      }
    }

    // 5) Köy meydanı: kasaba merkezi çevresi toprak
    for (let dj = -8; dj <= 8; dj++) {
      for (let di = -8; di <= 8; di++) {
        const i = sc.i + di, j = sc.j + dj;
        if (!this.inBounds(i, j) || Math.hypot(di, dj) + rand() * 2 > 6.5) continue;
        if (this.terrain[j][i] === TileId.GRASS) this.terrain[j][i] = TileId.DIRT;
      }
    }

    // 6) Başlangıç kaynakları (AoE'deki gibi garanti): üsse yakın ama FARKLI YÖNLERDE (hepsi aynı yere yığılmasın)
    this._clusters = [];
    const a0 = rand() * Math.PI * 2;
    this._placeCluster('berry', sc, 7, 10, 6, a0);
    this._placeCluster('tree', sc, 9, 12, 9, a0 + 1.6);
    this._placeCluster('gold', sc, 11, 16, 7, a0 + 3.1);
    this._placeCluster('stone', sc, 12, 17, 5, a0 + 4.6);
    // Haritaya dağınık ek kaynaklar: SEYREK — küçük kümeler, aralarında boşluk, kümeler birbirinden çok uzak
    const area = (W * H) / (128 * 128);
    for (let k = 0; k < Math.round(4 * area); k++) this._placeCluster('gold', null, 0, 0, 2 + ((rand() * 2) | 0));
    for (let k = 0; k < Math.round(4 * area); k++) this._placeCluster('stone', null, 0, 0, 2 + ((rand() * 2) | 0));
    for (let k = 0; k < Math.round(5 * area); k++) this._placeCluster('berry', null, 0, 0, 3);
    // Tesisler (mağara gibi büyük alanlar): taş ocağı ve altın rezervi
    for (let k = 0; k < Math.max(2, Math.round(1.2 * area)); k++) this._placeSite('quarry');
    for (let k = 0; k < Math.max(2, Math.round(1.2 * area)); k++) this._placeSite('goldReserve');

    this._analyzeWater();
    this._placeFish();
  }

  /**
   * Balık sürüleri: su karolarına (kıyıya 1–3 karo) aralıklı yerleşir; engel değildir (tekne üstünden geçebilir).
   * Başlangıç noktasının yakınındaki sulara öncelik verilir ki ilk tersane boşa gitmesin.
   */
  _placeFish() {
    const rand = this.rand, W = this.width, H = this.height, cand = [];
    for (let j = 4; j < H - 4; j++) {
      for (let i = 4; i < W - 4; i++) {
        const d = this.waterDepth[j][i];
        if (this.terrain[j][i] === TileId.WATER && d >= 1) cand.push([i, j]);
      }
    }
    if (!cand.length) return;
    // Denizin her yerinde (kıyıda ve açıkta) birbirinden ~6 karo aralıklı balık sürüleri
    const target = Math.max(16, Math.min(900, Math.round(cand.length / 18))); // bol balık: 10 tekne rahatça avlanır
    const placed = [];
    const cell = new Map(), key = (i, j) => `${(i / 6) | 0},${(j / 6) | 0}`;
    const ok = (i, j) => {
      const ci = (i / 6) | 0, cj = (j / 6) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const [a, b] of cell.get(`${ci + di},${cj + dj}`) ?? []) if (Math.hypot(a - i, b - j) < 5) return false;
      return true;
    };
    const add = (i, j) => { placed.push([i, j]); const k = key(i, j); if (!cell.has(k)) cell.set(k, []); cell.get(k).push([i, j]); };
    const s = this.spawn;
    const near = cand.filter(([i, j]) => Math.hypot(i - s.i, j - s.j) < 20).sort(() => rand() - 0.5);
    for (const [i, j] of near) { if (placed.length >= 2) break; if (ok(i, j)) add(i, j); }
    for (let k = 0; k < target * 8 && placed.length < target; k++) {
      const [i, j] = cand[(rand() * cand.length) | 0];
      if (ok(i, j)) add(i, j);
    }
    for (const [i, j] of placed) this.addObject(new ResourceNode('fish', i, j, { blocks: false, scale: 1 }));
  }

  /** 3×3 kaynak tesisi: üsten en az 26 karo, diğer tesislerden 34 karo uzakta, çevresi boş kara */
  _placeSite(kind) {
    const rand = this.rand, W = this.width, H = this.height;
    for (let attempt = 0; attempt < 300; attempt++) {
      const oi = 8 + ((rand() * (W - 18)) | 0), oj = 8 + ((rand() * (H - 18)) | 0);
      if (Math.hypot(oi + 1 - this.spawn.i, oj + 1 - this.spawn.j) < 26) continue;
      if ((this._sites ?? []).some((s) => Math.hypot(s.i - oi, s.j - oj) < 34)) continue;
      let ok = true;
      for (let j = oj - 1; ok && j < oj + 4; j++) for (let i = oi - 1; ok && i < oi + 4; i++) ok = this._freeLand(i, j) && this.terrain[j][i] !== TileId.SAND;
      if (!ok) continue;
      (this._sites ??= []).push({ i: oi, j: oj, kind });
      this.addObject(new ResourceNode(kind, oi + 2, oj + 2, { size: 3 }));
      return true;
    }
    return false;
  }

  /** Taşkın doldurma (flood fill) ile su bileşenlerini bulur; minSize'dan küçük olanları kuma çevirir. */
  _removeSmallLakes(minSize) {
    const W = this.width, H = this.height;
    const seen = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (seen[j * W + i] || this.terrain[j][i] !== TileId.WATER) continue;
        const comp = [];
        const stack = [j * W + i];
        seen[j * W + i] = 1;
        while (stack.length) {
          const n = stack.pop();
          comp.push(n);
          const ci = n % W, cj = (n / W) | 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            const k = nj * W + ni;
            if (!seen[k] && this.terrain[nj][ni] === TileId.WATER) { seen[k] = 1; stack.push(k); }
          }
        }
        if (comp.length < minSize) for (const n of comp) this.terrain[(n / W) | 0][n % W] = TileId.SAND;
      }
    }
  }

  /**
   * Belirli bir mesafe halkasında (veya rastgele) küme halinde kaynak yerleştirir.
   *  angle : başlangıç kaynakları için tercih edilen yön (±25°); verilmezse rastgele
   * Kümeler birbirine yaklaşamaz: aynı tür 22, farklı tür 8 karo (başlangıç kümeleri arasında 6).
   */
  _placeCluster(kind, center, rMin, rMax, count, angle = null) {
    const rand = this.rand;
    for (let attempt = 0; attempt < 120; attempt++) {
      let ci, cj;
      if (center) {
        const spread = attempt < 40 ? 0.45 : Math.PI; // önce tercih edilen yön, olmazsa her yön
        const a = angle !== null ? angle + (rand() - 0.5) * 2 * spread : rand() * Math.PI * 2, r = rMin + rand() * (rMax - rMin);
        ci = Math.round(center.i + Math.cos(a) * r);
        cj = Math.round(center.j + Math.sin(a) * r);
      } else {
        ci = 10 + ((rand() * (this.width - 20)) | 0);
        cj = 10 + ((rand() * (this.height - 20)) | 0);
        if (Math.hypot(ci - this.spawn.i, cj - this.spawn.j) < 22) continue;
      }
      if (!this._freeLand(ci, cj)) continue;
      const tooClose = (this._clusters ?? []).some((c) => {
        const d = Math.hypot(c.i - ci, c.j - cj);
        return center ? d < 6 : d < (c.kind === kind ? 36 : 16);
      });
      if (tooClose && attempt < 100) continue;
      // Kümeyi rastgele büyüt (komşu boş karolara yayıl)
      const cells = [[ci, cj]];
      const seen = new Set([`${ci},${cj}`]);
      for (let k = 0; k < 60 && cells.length < count; k++) {
        const [bi, bj] = cells[(rand() * cells.length) | 0];
        // Ağaç dışındaki kaynaklar yan yana değil: aralarında en az bir boş karo (2 adım ötesi)
        const step = kind === 'tree' ? 1 : 2;
        const ni = bi + (((rand() * 3) | 0) - 1) * step, nj = bj + (((rand() * 3) | 0) - 1) * step;
        const key = `${ni},${nj}`;
        if (seen.has(key) || !this._freeLand(ni, nj)) continue;
        if (step > 1 && cells.some(([a, b]) => Math.max(Math.abs(a - ni), Math.abs(b - nj)) < 2)) continue;
        seen.add(key);
        cells.push([ni, nj]);
      }
      (this._clusters ??= []).push({ i: ci, j: cj, kind });
      for (const [i, j] of cells) {
        this.addObject(new ResourceNode(kind, i, j, {
          variant: kind === 'tree' ? ((rand() * 3) | 0) : 0,
          scale: (kind === 'tree' ? 0.85 : 0.8) + rand() * 0.3, flip: rand() < 0.5,
          offX: (rand() - 0.5) * 0.2, offY: (rand() - 0.5) * 0.2,
        }));
      }
      return true;
    }
    return false;
  }

  _freeLand(i, j) {
    if (!this.inBounds(i, j) || this.occupancy[j][i]) return false;
    const t = this.terrain[j][i];
    if (t !== TileId.GRASS && t !== TileId.DIRT && t !== TileId.SAND) return false;
    // Kasaba merkezinin ayak izine ve hemen çevresine kaynak koyma
    const s = this.spawn;
    if (i >= s.i - 2 && i <= s.i + 5 && j >= s.j - 2 && j <= s.j + 5) return false;
    return true;
  }

  /** (ci, cj) etrafında size×size + margin boş arazi arar (halka araması). */
  _findOpenArea(ci, cj, size, margin, maxR = 40) {
    for (let r = 0; r <= maxR; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const oi = ci + di - (size >> 1), oj = cj + dj - (size >> 1);
          let ok = true;
          for (let j = oj - margin; ok && j < oj + size + margin; j++) {
            for (let i = oi - margin; i < oi + size + margin; i++) {
              const t = this.getTile(i, j);
              if (t !== TileId.GRASS && t !== TileId.DIRT) { ok = false; break; }
            }
          }
          if (ok) return { i: oi, j: oj };
        }
      }
    }
    return null;
  }

  /** Su karoları: kıyı maskesi (hangi kenar karaya bakıyor) + kıyıya uzaklık (çok kaynaklı BFS). */
  _analyzeWater() {
    const W = this.width, H = this.height, MAX_DEPTH = 4;
    const isLand = (i, j) => this.inBounds(i, j) && this.terrain[j][i] !== TileId.WATER;
    const queue = [];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        this.waterDepth[j][i] = 0;
        this.shoreMask[j][i] = 0;
        if (this.terrain[j][i] !== TileId.WATER) continue;
        let m = 0;
        if (isLand(i, j - 1)) m |= 1;
        if (isLand(i + 1, j)) m |= 2;
        if (isLand(i, j + 1)) m |= 4;
        if (isLand(i - 1, j)) m |= 8;
        this.shoreMask[j][i] = m;
        if (m) { this.waterDepth[j][i] = 1; queue.push(i, j); }
      }
    }
    for (let q = 0; q < queue.length; q += 2) {
      const i = queue[q], j = queue[q + 1], d = this.waterDepth[j][i];
      if (d >= MAX_DEPTH) continue;
      for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (this.getTile(ni, nj) === TileId.WATER && this.waterDepth[nj][ni] === 0) {
          this.waterDepth[nj][ni] = d + 1;
          queue.push(ni, nj);
        }
      }
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (this.terrain[j][i] === TileId.WATER && this.waterDepth[j][i] === 0) this.waterDepth[j][i] = MAX_DEPTH;
      }
    }
    this._labelWater();
    this.terrainVersion++;
  }

  /** Su kütlelerini numaralar (taşkın doldurma): tekne yalnızca kendi gölündeki balığa/tersaneye gidebilir */
  _labelWater() {
    const W = this.width, H = this.height;
    this.waterRegion = new Int32Array(W * H).fill(-1);
    let id = 0;
    for (let s = 0; s < W * H; s++) {
      const si = s % W, sj = (s / W) | 0;
      if (this.waterRegion[s] >= 0 || this.terrain[sj][si] !== TileId.WATER) continue;
      const stack = [s];
      this.waterRegion[s] = id;
      while (stack.length) {
        const n = stack.pop(), ci = n % W, cj = (n / W) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const k = nj * W + ni;
          if (this.waterRegion[k] < 0 && this.terrain[nj][ni] === TileId.WATER) { this.waterRegion[k] = id; stack.push(k); }
        }
      }
      id++;
    }
  }

  /** Karonun su kütlesi numarası (kara: −1) */
  regionAt(i, j) { return this.inBounds(i, j) ? this.waterRegion[j * this.width + i] : -1; }

  /** Binanın bitişiğindeki su kütleleri (tersane hangi göllere açılıyor) */
  regionsAround(b) {
    const out = new Set();
    for (let j = b.originJ - 1; j <= b.j + 1; j++) for (let i = b.originI - 1; i <= b.i + 1; i++) { const r = this.regionAt(i, j); if (r >= 0) out.add(r); }
    return out;
  }
}
