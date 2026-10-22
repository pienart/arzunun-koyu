import { CONFIG } from '../config.js';
import { ValueNoise2D } from '../world/Noise.js';
import { ENEMY, BUILDINGS } from '../data/gameData.js';
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
      cavalry: manifest.sprites.cav_idle ? (CONFIG.VILLAGER_HEIGHT * 1.55) / manifest.sprites.cav_idle.h : 1,
    };
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
  buildingKey(type, tier) {
    type = BUILDINGS[type]?.sprite ?? type;
    for (let t = tier; t >= 0; t--) if (this.sprites[`${type}_${t}`]) return `${type}_${t}`;
    for (let t = tier + 1; t <= 3; t++) if (this.sprites[`${type}_${t}`]) return `${type}_${t}`;
    return null;
  }

  building(type, tier, owner) {
    type = BUILDINGS[type]?.sprite ?? type; // görsel adı tür adından farklı olabilir (çit → palisade)
    let key = null;
    for (let t = tier; t >= 0 && !key; t--) if (this.sprites[`${type}_${t}`]) key = `${type}_${t}`;
    for (let t = tier + 1; t <= 3 && !key; t++) if (this.sprites[`${type}_${t}`]) key = `${type}_${t}`;
    if (!key) return this.sprites.foundation;
    return owner === ENEMY ? this.recolored(key) : this.sprites[key];
  }

  /** Ağaç: sonbahar ve kışın meşeler kızıl yapraklı görünür (mevsim değişince statik katman yenilenir) */
  tree(variant, season = 'summer') {
    let v = variant % 3;
    if (v === 0 && (season === 'autumn' || season === 'winter')) v = 2;
    return this.sprites[['tree_oak', 'tree_pine', 'tree_autumn'][v]];
  }

  villager(pose) { return this.sprites[`vil_${pose}`] ?? this.sprites.vil_idle; }

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
    g.addColorStop(0, 'rgba(0,0,0,0.78)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.82, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return c;
  }
}
