import { CONFIG } from '../config.js';
import { ValueNoise2D } from '../world/Noise.js';
import { ENEMY, PLAYER, BUILDINGS } from '../data/gameData.js';
import { UNIT_PREFIX, WALK_DIRS, VEHICLE_HEIGHT } from '../data/animData.js';

/** Takım rengi taşıyan (düşman sürümü kırmızıya boyanan) görseller */
const TEAM = /^(townCenter|barracks|archeryRange|watchTower|house|dock|stable|siegeWorkshop|gate|palisade|mil_|arc_|vil_|cav_|ram_|boat_)/;

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
};

/**
 * Sprite: yüklenen bir görselin çok seviyeli (mipmap benzeri) kopyaları + seçim maskesi.
 *
 * Neden mipmap? 640 px'lik bir bina görselini ekranda 120 px çizmek 5 kat küçültme demektir.
 * Canvas drawImage tek adımda bilinear örnekleme yapar → ince detaylar "karıncalanır".
 * Görseli önceden yarıya, çeyreğe... indirip hedef boyuta en yakın (büyük) seviyeden çizmek
 * hem daha keskin hem daha hızlıdır.
 */
export class Sprite {
  constructor(img, meta = {}) {
    this.aspect = img.height / img.width;
    this.anchorX = meta.anchorX ?? 0.5;                        // taban merkezinin yatay oranı
    this.baseRatio = (meta.baseW ?? img.width) / img.width;    // taban genişliği / görsel genişliği
    this.levels = [img];
    let src = img, w = img.width, h = img.height;
    while (w > 40) {
      w = Math.round(w / 2);
      h = Math.round(h / 2);
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      this.levels.push(c);
      src = c;
    }
    this._buildMask(img);
  }

  /** Hedef piksel genişliğinden büyük/eşit en küçük seviye */
  pick(destPx) {
    let best = this.levels[0];
    for (const l of this.levels) {
      if (l.width >= destPx) best = l;
      else break;
    }
    return best;
  }

  /** Düşük çözünürlüklü alfa maskesi: tıklama testinde saydam alanlar (ağacın etrafı vb.) seçmesin */
  _buildMask(img) {
    const mw = 48, mh = Math.max(1, Math.round(48 * this.aspect));
    const c = makeCanvas(mw, mh);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, mw, mh);
    try {
      const d = ctx.getImageData(0, 0, mw, mh).data;
      this.mask = new Uint8Array(mw * mh);
      for (let k = 0; k < mw * mh; k++) this.mask[k] = d[k * 4 + 3] > 50 ? 1 : 0;
    } catch {
      this.mask = null; // file:// gibi "tainted" durumlarda kutu testine düş
    }
    this.mw = mw;
    this.mh = mh;
  }

  /** (u, v) ∈ [0,1]² sprite içi oran → opak mı? */
  hit(u, v) {
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
    if (!this.mask) return true;
    return this.mask[((v * this.mh) | 0) * this.mw + ((u * this.mw) | 0)] === 1;
  }
}

/**
 * SpriteFactory: tüm görsel kaynakların tek erişim noktası.
 *  - Bina sprite'ları çağa göre (tier) seçilir; o çağ için görsel yoksa en yakın çağınki kullanılır.
 *  - Zemin dokuları iki çözünürlükte tutulur (uzak zoom'da küçük doku → titreşim yok).
 *  - Gölge ve makro-varyasyon dokusu prosedürel üretilir.
 */
export class SpriteFactory {
  constructor(images, manifest) {
    this.manifest = manifest;
    this.sprites = {};
    for (const [key, meta] of Object.entries(manifest.sprites)) this.sprites[key] = new Sprite(images.sprites[key], meta);
    this.icons = images.icons;

    // Animasyon şeritleri: her kare ayrı bir Sprite olur ('vil_walk#3'). Böylece mipmap, tıklama maskesi
    // ve düşman renk dönüşümü durağan sprite'larla aynı yoldan geçer.
    this.anims = {};
    this.animMeta = {};
    for (const [key, meta] of Object.entries(manifest.anims ?? {})) {
      const img = images.anims?.[key];
      if (!img) continue;
      const frames = [];
      for (let k = 0; k < meta.frames; k++) {
        const fk = `${key}#${k}`;
        // Tembel kurulum: kare (mipmap + tıklama maskesi, ~8 ms) ilk kullanıldığında hazırlanır.
        // 600+ kareyi açılışta hazırlamak oyunun başlamasını saniyelerce geciktiriyordu.
        Object.defineProperty(this.sprites, fk, {
          configurable: true, enumerable: true,
          get: () => {
            const c = makeCanvas(meta.w, meta.h);
            c.getContext('2d').drawImage(img, k * meta.w, 0, meta.w, meta.h, 0, 0, meta.w, meta.h);
            const sprite = new Sprite(c, { anchorX: meta.anchorX });
            Object.defineProperty(this.sprites, fk, { value: sprite, writable: true, configurable: true, enumerable: true });
            return sprite;
          },
        });
        frames.push(fk);
      }
      this.anims[key] = frames;
      this.animMeta[key] = meta;
    }

    this.textures = {};
    for (const [key, img] of Object.entries(images.textures)) {
      const full = makeCanvas(img.width, img.height);
      full.getContext('2d').drawImage(img, 0, 0);
      const half = makeCanvas(img.width >> 1, img.height >> 1);
      const hctx = half.getContext('2d');
      hctx.imageSmoothingQuality = 'high';
      hctx.drawImage(img, 0, 0, half.width, half.height);
      this.textures[key] = { full, half, size: img.width, avg: manifest.textures[key].avg };
    }

    this.noise = this._makeNoise();
    this.shadow = this._makeShadow();
    this._red = new Map();
    // Birim ölçekleri: sayfadaki idle karesi CONFIG.VILLAGER_HEIGHT dünya birimine (askerler %8 daha iri)
    this.unitScale = {
      villager: CONFIG.VILLAGER_HEIGHT / manifest.sprites.vil_idle.h,
      militia: (CONFIG.VILLAGER_HEIGHT * 1.08) / manifest.sprites.mil_idle.h,
      archer: (CONFIG.VILLAGER_HEIGHT * 1.08) / manifest.sprites.mil_idle.h, // aynı sayfa → aynı ölçek
      commander: (CONFIG.VILLAGER_HEIGHT * 1.08) / manifest.sprites.mil_idle.h, // milisle aynı görünür
      cavalry: manifest.sprites.cav_idle ? (CONFIG.VILLAGER_HEIGHT * 1.55) / manifest.sprites.cav_idle.h : 1,
      architect: manifest.sprites.arch_idle ? (CONFIG.VILLAGER_HEIGHT * 1.02) / manifest.sprites.arch_idle.h : 1,
      // Yabani hayvanlar: gerçekçi boy (UNITS[...].height, dünya birimi)
      ...Object.fromEntries(['gazelle', 'deer', 'rabbit', 'horse'].filter((k) => manifest.sprites[`${k}_idle`]).map((k) => [k, ({ gazelle: 26, deer: 33, rabbit: 11, horse: 36 })[k] / manifest.sprites[`${k}_idle`].h])),
      // Koca Ayak: insandan ~2,4 kat iri
      yeti: manifest.sprites.yeti_idle ? (CONFIG.VILLAGER_HEIGHT * 2.4) / manifest.sprites.yeti_idle.h : 1,
    };
    this._snow = new WeakMap();
    this.snowCanvas = this._makeSnow();
    this.villagerScale = this.unitScale.villager;
    // Düşman (kırmızı) sürümleri: sabit görseller açılışta hazırlanır; animasyon kareleri (600+) açılışı
    // uzatmasın diye oyun başladıktan sonra arka planda küçük parçalar halinde (prewarm). Hazır olmayan kare
    // ilk kullanımda hesaplanır.
    this._warm = [];
    for (const key of Object.keys(this.sprites)) {
      if (TEAM.test(key) && !key.includes('#')) this.recolored(key);
    }
    for (const frames of Object.values(this.anims)) this._warm.push(...frames);
  }

  /**
   * Takım rengi: mavi tonları (ton 190°–260°) kırmızıya döndürür. Doygunluk ve parlaklık korunur,
   * böylece gölgelendirme ve doku detayı aynen kalır. Sonuç önbelleğe alınır.
   */
  recolored(key) {
    if (this._red.has(key)) return this._red.get(key);
    const src = this.sprites[key];
    const img = src.levels[0];
    const c = makeCanvas(img.width, img.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    let sprite = src;
    try {
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const d = data.data;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 8) continue;
        const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
        if (max !== b || delta < 0.12 || max < 0.12) continue;      // yalnızca belirgin mavi pikseller
        let h = 60 * (((r - g) / delta) + 4);                        // mavi baskın → ton 180–300
        if (h < 190 || h > 262) continue;
        const sat = delta / max;
        if (sat < 0.28) continue;
        // ton ~225 (mavi) → ~358 (kırmızı); HSV → RGB
        h = (h + 133) % 360;
        const v = max * 0.95, cc = v * sat, x = cc * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - cc;
        let rr, gg, bb;
        if (h < 60) [rr, gg, bb] = [cc, x, 0]; else if (h < 120) [rr, gg, bb] = [x, cc, 0];
        else if (h < 180) [rr, gg, bb] = [0, cc, x]; else if (h < 240) [rr, gg, bb] = [0, x, cc];
        else if (h < 300) [rr, gg, bb] = [x, 0, cc]; else [rr, gg, bb] = [cc, 0, x];
        d[k] = (rr + m) * 255; d[k + 1] = (gg + m) * 255; d[k + 2] = (bb + m) * 255;
      }
      ctx.putImageData(data, 0, 0);
      sprite = new Sprite(c, { anchorX: src.anchorX, baseW: src.baseRatio * img.width });
    } catch { /* tainted canvas: orijinali kullan */ }
    this._red.set(key, sprite);
    return sprite;
  }

  /** Birim karesi: tür + poz + sahip (düşman → kırmızı) */
  unit(type, pose, owner) {
    const prefix = UNIT_PREFIX[type] ?? 'vil';
    let key = `${prefix}_${pose}`;
    if (!this.sprites[key]) key = `${prefix}_idle`;
    return owner === ENEMY ? this.recolored(key) : this.sprites[key];
  }

  /** Animasyon karelerinin düşman sürümlerini arka planda hazırla (kare başına ~6 ms bütçe) */
  prewarm() {
    const step = () => {
      const t0 = performance.now();
      while (this._warm.length && performance.now() - t0 < 6) {
        const key = this._warm.pop();
        void this.sprites[key];      // oyuncu karesi
        if (TEAM.test(key)) this.recolored(key); // düşman (kırmızı) kopyası
      }
      if (this._warm.length) setTimeout(step, 16);
    };
    setTimeout(step, 500);
  }

  /** Birimin o anki karesi: animasyon varsa fazına göre kare dizisinden, yoksa durağan poz */
  unitSprite(u, st = u.animState) {
    // Yönlü animasyon henüz yoksa (ör. yalnızca yan görünüm üretilmişse) temel animasyona düş
    const frames = st && (this.anims[st.name] ?? (st.base && this.anims[st.base]));
    if (!frames) return this.unit(u.type, u.pose, u.owner);
    const key = frames[Math.floor(st.phase * frames.length) % frames.length];
    return u.owner === ENEMY ? this.recolored(key) : this.sprites[key];
  }

  /**
   * Araç/tekne: 8 yönden birinin sabit görseli. Doğu yan görünümü '_e' anahtarındadır; batı yönleri aynadır.
   * Dönüş: { s, flip, h } (h = dünya birimi cinsinden çizim boyu)
   */
  vehicle(u) {
    const prefix = UNIT_PREFIX[u.type], d = WALK_DIRS[u.dir ?? 0];
    const key = `${prefix}${d.suffix || '_e'}`;
    const base = this.sprites[key] ? key : `${prefix}_e`;
    if (!this.sprites[base]) return null;
    return { s: u.owner === ENEMY ? this.recolored(base) : this.sprites[base], flip: d.flip, h: VEHICLE_HEIGHT[u.type] ?? 40 };
  }

  get(key) { return this.sprites[key]; }

  /** Binanın o çağdaki sprite anahtarı (animasyonu var mı diye bakmak için) */
  /**
   * Binanın o çağdaki sprite anahtarı. OYUNCU (Türk köyü) önce kendi setine bakar: `tr_<görsel>_<çağ>`
   * (Oğuz → Selçuklu → Osmanlı); yoksa ortak görsele düşer. DÜŞMAN ortak (Batı tarzı) görseli kırmızıya boyanmış kullanır.
   * O çağ için görsel yoksa en yakın çağınki; hiç kademesi yoksa tek görsel (ör. ateş çukuru → kamp ateşi).
   */
  buildingKey(type, tier, owner = PLAYER) {
    const base = BUILDINGS[type]?.sprite ?? type;
    for (const n of owner === PLAYER ? [`tr_${base}`, base] : [base]) {
      for (let t = tier; t >= 0; t--) if (this.sprites[`${n}_${t}`]) return `${n}_${t}`;
      for (let t = tier + 1; t <= 3; t++) if (this.sprites[`${n}_${t}`]) return `${n}_${t}`;
      if (this.sprites[n] && !this.anims[n]) return n;
    }
    return null;
  }

  building(type, tier, owner) {
    const key = this.buildingKey(type, tier, owner);
    if (!key) return this.sprites.foundation;
    return owner === ENEMY ? this.recolored(key) : this.sprites[key];
  }

  /** Gece görseli (hayvan çiftliği): oyuncu için önce Türk seti */
  buildingNight(type, owner) {
    const base = BUILDINGS[type]?.sprite ?? type;
    if (owner === PLAYER && this.buildingKey(type, 0, owner)?.startsWith('tr_')) return this.sprites[`tr_${base}_night`] ?? null; // Türk yapısına başka üslubun gece görseli karışmasın
    return this.sprites[`${base}_night`] ?? null;
  }

  /**
   * KARLI SÜRÜM (kış): yukarı bakan yüzeylere (her sütunda opak bölgenin ilk birkaç pikseli: çatı, ağaç tepesi,
   * kaya sırtı) kar yığılır, aydınlık yüzeylere kar serpintisi düşer, renkler biraz soğur. Sonuç önbelleğe alınır.
   */
  snowy(s) {
    if (!s) return s;
    let out = this._snow.get(s);
    if (out) return out;
    const img = s.levels[0], W = img.width, H = img.height;
    const c = makeCanvas(W, H), ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    out = s;
    try {
      const data = ctx.getImageData(0, 0, W, H), d = data.data;
      const cap = Math.max(3, Math.round(H * 0.04));
      const run = new Int32Array(W);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = (y * W + x) * 4;
          if (d[k + 3] < 60) { run[x] = 0; continue; }
          run[x]++;
          const r = d[k], g = d[k + 1], b = d[k + 2];
          const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
          let snow = run[x] <= cap ? 0.95 - ((run[x] - 1) / cap) * 0.3 : 0;
          // serpinti: aydınlık yüzeylerde 2×2'lik benekler
          let h = Math.imul((x >> 1) * 374761393 + (y >> 1) * 668265263, 1274126177);
          h = ((h ^ (h >>> 15)) >>> 0) / 4294967296;
          if (lum > 0.38 && h > 0.58) snow = Math.max(snow, 0.35 + 0.5 * (lum - 0.38));
          const grey = lum * 255;
          let R = r * 0.78 + grey * 0.22, G = g * 0.78 + grey * 0.22, B = b * 0.78 + grey * 0.22 + 10;
          R += (236 - R) * snow; G += (243 - G) * snow; B += (252 - B) * snow;
          d[k] = R; d[k + 1] = G; d[k + 2] = B;
        }
      }
      ctx.putImageData(data, 0, 0);
      out = new Sprite(c, { anchorX: s.anchorX, baseW: s.baseRatio * W });
    } catch { /* tainted: karsız kullan */ }
    this._snow.set(s, out);
    return out;
  }

  /** Kış yaklaşırken doğa ve bina görsellerinin karlı sürümlerini arka planda hazırla */
  prewarmSnow() {
    if (this._snowWarm) return;
    this._snowWarm = true;
    const list = Object.keys(this.manifest.sprites).filter((k) => !/^(vil|mil|arc|cav|boat|ram|yeti)_/.test(k));
    // Hareketli binaların kareleri (değirmen kanadı, iskele, ocak ateşi...) de kışın karlı çizilir
    for (const [k, frames] of Object.entries(this.anims)) if (/^(tr_)?[a-zA-Z]+_\d$/.test(k)) list.push(...frames);
    const step = () => {
      const t0 = performance.now();
      while (list.length && performance.now() - t0 < 6) {
        const key = list.pop(), s = this.sprites[key];
        this.snowy(s);
        if (TEAM.test(key)) this.snowy(this.recolored(key));
      }
      if (list.length) setTimeout(step, 30);
    };
    setTimeout(step, 50);
  }

  /** Karla kaplı zemin dokusu (kış örtüsü): hafif mavi gölgeli beyaz, yumuşak benekler */
  _makeSnow() {
    const size = 256, c = makeCanvas(size, size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const n = new ValueNoise2D(777, 8);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = n.fbm((x / size) * 8, (y / size) * 8, 4);
        const k = (y * size + x) * 4;
        const sparkle = Math.random() < 0.004 ? 14 : 0;
        img.data[k] = 226 + v * 22 + sparkle; img.data[k + 1] = 233 + v * 18 + sparkle; img.data[k + 2] = 246 + v * 9; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Ağaç: sonbahar ve kışın meşeler kızıl yapraklı görünür (mevsim değişince statik katman yenilenir) */
  tree(variant, season = 'summer') {
    let v = variant % 3;
    if (v === 0 && (season === 'autumn' || season === 'winter')) v = 2;
    return this.sprites[['tree_oak', 'tree_pine', 'tree_autumn'][v]];
  }

  /** Makro varyasyon: dokunun her 6 karoda bir tekrar ettiğini gizleyen büyük ölçekli, yumuşak ton farkları */
  _makeNoise() {
    const size = 256, c = makeCanvas(size, size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    // Kafes boyutu 8: doku boyunca tam 8 kafes hücresi örneklenir → gürültü periyodik, doku kesintisiz döşenir
    const n = new ValueNoise2D(4242, 8);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = n.fbm((x / size) * 8, (y / size) * 8, 3);
        const g = 200 + v * 55;                       // 200–255: yalnızca hafif koyulaştırır (multiply)
        const k = (y * size + x) * 4;
        img.data[k] = g; img.data[k + 1] = g * 0.98 + 4; img.data[k + 2] = g * 0.95 + 8; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Yumuşak eliptik gölge (radyal gradyan) – her nesne için ölçeklenerek kullanılır */
  _makeShadow() {
    const c = makeCanvas(128, 64), ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 0.5, 0, 0);
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    // Yumuşak gölge: merkez koyu değil, kenarlara doğru uzun ve düzgün sönüm (sert halka görünmesin)
    g.addColorStop(0, 'rgba(0,0,0,0.62)');
    g.addColorStop(0.35, 'rgba(0,0,0,0.45)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.2)');
    g.addColorStop(0.85, 'rgba(0,0,0,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return c;
  }
}
