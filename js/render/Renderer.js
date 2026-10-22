import { CONFIG } from '../config.js';
import { TileId } from '../world/TileTypes.js';
import { HW, HH, traceDiamond, footprintCorners, ChunkedPath, fillPath } from './iso.js';
import { WaterRenderer, ovCrop } from './WaterRenderer.js';
import { BUILDINGS, PLAYER, ENEMY } from '../data/gameData.js';
import { UNIT_PREFIX } from '../data/animData.js';
import { Ambient } from './Ambient.js';
import { Settings } from '../systems/Settings.js';
import { SEASON_LEN } from '../systems/Weather.js';

const TW = CONFIG.TILE_WIDTH;
/** Zemin çizim sırası: sonra çizilen, öncekinin üzerine "taşar" (çimen toprağı, kaya çimeni örter) */
const TERRAIN_ORDER = [TileId.SAND, TileId.DIRT, TileId.GRASS, TileId.MOUNTAIN];
const TEX_OF = { [TileId.SAND]: 'sand', [TileId.DIRT]: 'dirt', [TileId.GRASS]: 'grass', [TileId.MOUNTAIN]: 'rock' };
const PRIORITY = { [TileId.SAND]: 0, [TileId.DIRT]: 1, [TileId.GRASS]: 2, [TileId.MOUNTAIN]: 3 };
/** Karo kenarları: komşu ofseti, kenar uçları (merkeze göre), komşu merkezine vektör */
const EDGES = [
  { di: 0, dj: -1, ax: 0, ay: -HH, bx: HW, by: 0, nx: HW, ny: -HH },
  { di: 1, dj: 0, ax: HW, ay: 0, bx: 0, by: HH, nx: HW, ny: HH },
  { di: 0, dj: 1, ax: 0, ay: HH, bx: -HW, by: 0, nx: -HW, ny: HH },
  { di: -1, dj: 0, ax: -HW, ay: 0, bx: 0, by: -HH, nx: -HW, ny: -HH },
];

/** Deterministik karma (hash) → [0,1). Geçiş lekeleri her yeniden çizimde aynı yerde kalsın diye. */
function hash3(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Yumuşak 1B gürültü (0..1): komşu tam sayılardaki karma değerler arasında smoothstep geçişi.
 * Alevlerin "mum gibi" titremesi için: sinüsün düzenli nabzı yerine yavaş, rastgele inip çıkan bir parlaklık.
 */
function cnoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash3(i, 17, 3) * (1 - u) + hash3(i + 1, 17, 3) * u;
}
/** Mum alevi: çoğunlukla sakin, arada yavaşça sönükleşip parlayan değer (yaklaşık 0.75..1.05) */
const candle = (t, seed) => 0.78 + 0.2 * cnoise(t * 1.6 + seed) + 0.07 * cnoise(t * 4.1 + seed * 1.7);

// Leke şekli: 7 köşeli çokgen (önceden hesaplanmış birim çember noktaları).
// Neden elips değil? Binlerce eğri içeren yolu doldurmak (özellikle yazılımsal çizimde) çok pahalı;
// dokulu zeminde 7-gen ile elips arasındaki fark görünmez, dolgu maliyeti ise ~3 kat düşer.
const BLOB_N = 7;
const BLOB_PTS = Array.from({ length: BLOB_N }, (_, k) => [Math.cos((k / BLOB_N) * Math.PI * 2), Math.sin((k / BLOB_N) * Math.PI * 2)]);
let BLOBS_PER_EDGE = 3;

/**
 * Ortak kenar boyunca komşu karoya taşan rastgele lekeler ekler (organik sınır).
 * Konum/boyut deterministik karmadan gelir → her yeniden çizimde aynı şekil.
 */
function addEdgeBlobs(path, i, j, cx, cy, E, e, rScale = 1) {
  for (let k = 0; k < BLOBS_PER_EDGE; k++) {
    const seed = e * 7 + k;
    const tt = 0.15 + 0.7 * hash3(i, j, seed);
    const push = 0.06 + 0.22 * hash3(j, i, seed + 3);
    const ox = cx + E.ax + (E.bx - E.ax) * tt + E.nx * push;
    const oy = cy + E.ay + (E.by - E.ay) * tt + E.ny * push;
    const r = HW * (0.16 + 0.17 * hash3(i + 7, j + 3, seed + 5)) * rScale * (BLOBS_PER_EDGE === 2 ? 1.2 : 1);
    const rot = (hash3(i, j, seed + 9) * Math.PI * 2) / BLOB_N; // her leke farklı açıda → çokgen belli olmaz
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (let q = 0; q < BLOB_N; q++) {
      const [ux, uy] = BLOB_PTS[q];
      const px = ox + (ux * c - uy * sn) * r, py = oy + (ux * sn + uy * c) * r * 0.5; // 2:1 izometrik basıklık
      if (q === 0) path.moveTo(px, py); else path.lineTo(px, py);
    }
    path.closePath();
  }
}

/** Önceden çizilmiş alev, parıltı ve duman dokuları (her karede gradyan oluşturmamak için) */
function makeFireSprites() {
  const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); return c; };
  const flame = mk(64, 128, (g) => {
    // Damla biçimi: altta geniş, tepede sivri; içten dışa beyaz-sarı → turuncu → kırmızı → saydam
    const gr = g.createRadialGradient(32, 100, 2, 32, 92, 60);
    gr.addColorStop(0, 'rgba(255,250,215,1)');
    gr.addColorStop(0.25, 'rgba(255,210,90,0.95)');
    gr.addColorStop(0.55, 'rgba(255,120,25,0.8)');
    gr.addColorStop(1, 'rgba(180,30,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(32, 2);
    g.bezierCurveTo(46, 40, 62, 70, 58, 98);
    g.bezierCurveTo(54, 124, 10, 124, 6, 98);
    g.bezierCurveTo(2, 70, 18, 40, 32, 2);
    g.fill();
  });
  const glow = mk(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,170,60,0.9)');
    gr.addColorStop(0.5, 'rgba(255,110,20,0.35)');
    gr.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  const smoke = mk(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(48,45,43,0.95)');
    gr.addColorStop(0.55, 'rgba(62,58,55,0.55)');
    gr.addColorStop(1, 'rgba(80,76,72,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  return { flame, glow, smoke };
}

/** Dışbükey çokgeni eksen hizalı dikdörtgene kırpar (Sutherland–Hodgman). Köşe sırası (dönüş yönü) korunur. */
function clipPolyToRect(poly, R) {
  const edges = [
    (p) => p[0] >= R.l, (p) => p[0] <= R.r, (p) => p[1] >= R.t, (p) => p[1] <= R.b,
  ];
  const cut = [
    (a, b) => { const t = (R.l - a[0]) / (b[0] - a[0]); return [R.l, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (R.r - a[0]) / (b[0] - a[0]); return [R.r, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (R.t - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, R.t]; },
    (a, b) => { const t = (R.b - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, R.b]; },
  ];
  let out = poly;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out, inside = edges[e];
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const a = inp[k], b = inp[(k + 1) % inp.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut[e](a, b));
    }
  }
  return out;
}

/** Gece katmanında ışığın karanlığı oyduğu yumuşak leke (merkez tam, kenar sıfır) */
function makeLightSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

const makeSpans = (rows) => ({ jMin: 0, jMax: -1, i0: new Int32Array(rows), i1: new Int32Array(rows) });

/**
 * GENEL BAKIŞ (overview) ÖNBELLEĞİ — uzak zoom performansı
 * Uzak zoom'da ekrana binlerce karo sığar; zeminin (doku + organik geçiş lekeleri + bulanık su gölgeleri)
 * her yeniden çizimi 200 ms'yi aşıyor ve kaydırırken takılma yapıyordu. Zemin statik olduğundan TÜM harita
 * açılışta bir kez OV_SCALE çözünürlüğünde çizilir; ölçek OV_MAX_S'nin altındayken yeniden çizim yalnızca
 * bu görüntüden bir kopyalamadır. Çiftlikler ve grid değişebildiği için her seferinde üstüne çizilir.
 */
// Harita büyüdükçe çözünürlük düşer → bellek ~70 MB'ta kalır (224×224 harita: 0,36)
const OV_SCALE = Math.min(0.45, 0.45 * 180 / CONFIG.MAP_WIDTH);  // genel bakış görüntüsünün çözünürlüğü (cihaz pikseli / dünya birimi)
const OV_MAX_S = Math.min(0.8, OV_SCALE * 1.8);   // bu ölçeğin altında genel bakış kullanılır (en fazla ~1,8 kat büyütme)
const OV_PAD = 500;     // harita çevresindeki okyanus payı (dünya birimi)

/**
 * Renderer: katmanlı çizim
 *
 * ÖNBELLEK STRATEJİSİ (statik katmanlar):
 *   • Taşma payı (overscan): statik katmanlar ekrandan her yönde M piksel BÜYÜK çizilir.
 *     Kaydırmada yeniden çizim yok; önbellek yalnızca kaydırılmış olarak ekrana kopyalanır.
 *     Kamera M pikselden fazla kayınca tek seferlik yeniden çizim.
 *   • Ölçekli önizleme: yumuşak zoom animasyonu sürerken önbellek ölçeklenerek gösterilir;
 *     keskin yeniden çizim zoom oturunca (veya en geç ~180 ms'de bir) yapılır.
 *
 *   1. groundLayer  (off-screen, opak)  : dokulu zemin + geçişler + çiftlikler   → yalnızca değişince
 *   2. su           (her kare)          : sin/cos dalgalar, kıyı köpüğü
 *   3. objectLayer  (off-screen, şeffaf): gölgeler + ağaç/maden/dağ/bina sprite'ları → yalnızca değişince
 *   4. dinamik      (her kare)          : köylüler, seçim, çubuklar, yerleştirme hayaleti, seçim kutusu
 */
export class Renderer {
  constructor(canvas, world, camera, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.map = world.map;
    this.camera = camera;
    this.sprites = sprites;
    this.water = new WaterRenderer(world.map, sprites);

    this.groundLayer = document.createElement('canvas');
    this.groundCtx = this.groundLayer.getContext('2d', { alpha: false });
    this.objectLayer = document.createElement('canvas');
    this.objectCtx = this.objectLayer.getContext('2d');
    // Arka tampon: keskin çizim burada şeritler halinde hazırlanır, bitince ön tamponla yer değiştirir
    this.groundLayerB = document.createElement('canvas');
    this.groundCtxB = this.groundLayerB.getContext('2d', { alpha: false });
    this.objectLayerB = document.createElement('canvas');
    this.objectCtxB = this.objectLayerB.getContext('2d');
    this.stB = null;
    this.pickListB = [];
    this.job = null;
    this._groundV = -1;

    this.dpr = 1;
    this.pixelW = 1;
    this.pixelH = 1;
    this.showGrid = false;
    this.groundSpans = makeSpans(this.map.height);
    this.objectSpans = makeSpans(this.map.height);
    this._patterns = new Map();
    this._dirty = true;
    this._mapV = -1;
    this.M = 0;          // taşma payı (cihaz pikseli)
    this.st = null;      // son statik çizimin kamerası: { x, y, s, time, rect }
    this.pickList = [];
    this.unitRects = [];
    this.stats = { staticRedraws: 0, staticMs: 0, objects: 0, waterMs: 0, dynMs: 0 };
    this.fx = makeFireSprites();
    this.ambient = new Ambient(this);
    this.rain = [];      // hava parçacıkları (ekran uzayında)
    this._lastFrameT = 0;
    this._lights = [];   // bu karedeki ışık kaynakları (alev, kamp ateşi) → gece katmanı
  }

  resize(cssW, cssH) {
    this.dpr = Math.min(window.devicePixelRatio || 1, Settings.q.maxDpr ?? CONFIG.MAX_DPR);
    this.pixelW = Math.max(1, Math.round(cssW * this.dpr));
    this.pixelH = Math.max(1, Math.round(cssH * this.dpr));
    this.M = Math.round(Math.max(this.pixelW, this.pixelH) * 0.3);
    this.canvas.width = this.pixelW;
    this.canvas.height = this.pixelH;
    this.job = null;
    for (const c of [this.groundLayer, this.objectLayer, this.groundLayerB, this.objectLayerB]) {
      c.width = this.pixelW + 2 * this.M;
      c.height = this.pixelH + 2 * this.M;
    }
    this.water.resize(this.pixelW, this.pixelH, this.M);
    this._patterns.clear();
    this._dirty = true;
  }

  invalidate() { this._dirty = true; }
  toggleGrid() { this.showGrid = !this.showGrid; this._dirty = true; }

  /**
   * frame: { time, alpha, selected:Set, placement, box, cmdMarker }
   *
   * STATİK KATMAN YENİLEME KURALLARI (takılmasız zoom/kaydırma)
   *  • Ekran önbelleğin dışına taştıysa: hemen ucuz çizim (genel bakıştan, ~ms) → ekran asla boş kalmaz.
   *  • Ölçek değiştiyse veya önbellek genel bakıştan geliyorsa: keskin çizim ARKA tamponda, kare başına
   *    ~6 ms'lik şeritler halinde yapılır; bu sırada eski görüntü ölçeklenerek gösterilir, bitince yer değiştirir.
   *  • Kaydırırken taşma payının yarısı tükenince arka tamponda yeni çizim önceden başlar (yer değiştirme fark edilmez).
   *  • Yalnızca nesneler değiştiyse (ağaç kesildi, bina kondu) yalnızca nesne katmanı çizilir; zemin dokunulmaz.
   */
  render(frame) {
    this._lights.length = 0;
    // Kış: karlı nesne görselleri örtü yarıyı geçince devreye girer (statik katman bir kez yenilenir);
    // sonbaharın son 100 sn'sinde karlı sürümler arka planda hazırlanır (kış başında takılma olmasın)
    const wthr = this.world.weather;
    // Hayvan çiftliği: gece hayvanlar içeride (ayrı görsel) → karanlık eşiği geçilince statik katman yenilenir
    const night = (frame.darkness ?? 0) > 0.5;
    if (night !== this._night) { this._night = night; this.map.version++; }
    const snowy = wthr.snowCover > 0.5;
    if (snowy !== this._snowy) { this._snowy = snowy; this.map.version++; }
    if (snowy || (wthr.season.id === 'autumn' && wthr.seasonTime > SEASON_LEN - 100)) this.sprites.prewarmSnow();
    const cam = this.camera, s = cam.zoom * this.dpr, M = this.M;
    const zooming = cam.zoom !== cam.targetZoom;
    if (!this.st || this._dirty) {
      this._cancelJob();
      this._redrawStatic('auto');
    } else {
      const st = this.st, v = this._viewRect(0), R = st.rect;
      const covered = v.l >= R.l && v.t >= R.t && v.r <= R.r && v.b <= R.b;
      if (!covered) {
        this._cancelJob();
        this._redrawStatic(this.ov ? 'overview' : 'auto');
      } else if (this.map.groundVersion !== this._groundV) {
        if (s < OV_MAX_S || !this.ov) this._redrawStatic('auto');
        else if (!this.job) this._startJob();
      } else if (this.map.version !== this._mapV && !this.job) {
        const t0 = performance.now();
        this.stats.objects = this._drawObjects();
        this._mapV = this.map.version;
        this.stats.objectMs = performance.now() - t0;
      }
      const st2 = this.st;
      if (!this.job && st2 === st) {
        const sameScale = Math.abs(s - st.s) < 1e-9;
        const blurry = s / st.s > 1.4 || (st.fromOverview && s >= OV_MAX_S);
        const panFar = Math.abs((cam.x - st.x) * s) > M * 0.5 || Math.abs((cam.y - st.y) * s) > M * 0.5;
        if (s < OV_MAX_S) {
          // Uzak zoom: yeniden çizim zaten ucuz → zoom oturunca ya da pay yarılanınca doğrudan
          if ((!zooming && !sameScale) || (sameScale && panFar)) this._redrawStatic('auto');
        } else if ((!zooming && (!sameScale || st.fromOverview)) || (zooming && blurry) || (sameScale && panFar)) {
          this._startJob();
        }
      }
    }
    this._stepJob();

    // Önbellek → ekran eşlemesi: ekran = (dünya − kamera)·s ;  önbellek pikseli P = (dünya − st)·st.s + M
    const r = s / this.st.s;
    const ox = (this.st.x - cam.x) * s - M * r, oy = (this.st.y - cam.y) * s - M * r;
    const blit = { r, ox, oy };
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._blitLayer(ctx, this.groundLayer, blit);
    this._drawSnowGround(ctx);

    let t0 = performance.now();
    this.water.render(ctx, frame.time, { s, e: -cam.x * s, f: -cam.y * s }, blit, this._viewRect(0));
    this.stats.waterMs = performance.now() - t0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._blitLayer(ctx, this.objectLayer, blit);

    t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, frame.time - this._lastFrameT));
    this._lastFrameT = frame.time;
    const life = Settings.data.life;
    if (life) this.ambient.update(dt, frame);
    this._applyCamera(ctx);
    this._drawAnimatedBuildings(ctx, frame);
    if (life) this.ambient.drawWater(ctx, frame);
    this._drawBuildingOverlays(ctx, frame);
    this._drawCampfire(ctx, frame);
    this._drawCorpses(ctx, frame);
    this._drawImpactsAndMeat(ctx);
    this._drawUnits(ctx, frame);
    this._drawProjectiles(ctx);
    if (life) this.ambient.drawSmoke(ctx, frame);
    this._drawFog(ctx);
    this._drawSeason(ctx, frame);
    this._applyCamera(ctx);
    if (life) this.ambient.drawBirds(ctx, frame);
    this._drawPlacement(ctx, frame);
    this._drawCmdMarker(ctx, frame);
    this._drawNight(ctx, frame);
    this._drawWeather(ctx, frame, dt);
    this._drawSelectionBox(ctx, frame);
    this.stats.dynMs = performance.now() - t0;
  }

  // ═════════════════════ STATİK KATMANLAR ═════════════════════
  _blitLayer(ctx, layer, b) {
    if (b.r === 1) ctx.drawImage(layer, Math.round(b.ox), Math.round(b.oy)); // saf kaydırma: tam piksel, bulanıklık yok
    else ctx.drawImage(layer, b.ox, b.oy, layer.width * b.r, layer.height * b.r);
  }

  /** Statik katman dönüşümü: önbellek tuvali, kameranın M piksel solundan/üstünden başlar */
  _applyStatic(ctx) {
    const st = this.st;
    ctx.setTransform(st.s, 0, 0, st.s, -st.x * st.s + this.M, -st.y * st.s + this.M);
  }

  _makeSt() {
    const cam = this.camera, s = cam.zoom * this.dpr, M = this.M;
    return {
      x: cam.x, y: cam.y, s, time: performance.now(),
      // Önbelleğin kapsadığı dünya dikdörtgeni (ekran + her yönde M piksel)
      rect: { l: cam.x - M / s, t: cam.y - M / s, r: cam.x + (this.pixelW + M) / s, b: cam.y + (this.pixelH + M) / s },
    };
  }

  /** Eşzamanlı (aynı karede) yeniden çizim. mode: 'overview' (genel bakıştan, ucuz) | 'auto' (uzak zoom'da genel bakış) */
  _redrawStatic(mode = 'auto') {
    const t0 = performance.now();
    this.st = this._makeSt();
    const useOv = !!this.ov && (mode === 'overview' || this.st.s < OV_MAX_S);
    this.st.fromOverview = useOv;
    if (useOv) this._drawGroundOverview();
    else this._drawGroundFull(false);
    this.stats.objects = this._drawObjects();
    this._mapV = this.map.version;
    this._groundV = this.map.groundVersion;
    this._dirty = false;
    this.stats.staticRedraws++;
    this.stats.staticMs = performance.now() - t0;
  }

  // ───────── Arka tamponda şeritli (kare başına bütçeli) keskin çizim ─────────
  /** Ön ve arka tamponları (zemin, nesne, su maskesi/köpüğü, önbellek kamerası, tıklama listesi) değiştirir */
  _swapBuffers() {
    [this.groundLayer, this.groundLayerB] = [this.groundLayerB, this.groundLayer];
    [this.groundCtx, this.groundCtxB] = [this.groundCtxB, this.groundCtx];
    [this.objectLayer, this.objectLayerB] = [this.objectLayerB, this.objectLayer];
    [this.objectCtx, this.objectCtxB] = [this.objectCtxB, this.objectCtx];
    [this.st, this.stB] = [this.stB, this.st];
    [this.pickList, this.pickListB] = [this.pickListB, this.pickList];
    this.water.swapBuffers();
  }

  _startJob() {
    const st = this._makeSt();
    const bandH = 200 / st.s; // ~200 cihaz pikseli yüksekliğinde şeritler
    const bands = [];
    // l/r: şeridin yatay sınırları (su maskesi kırpması için; çok büyük kırpma şekilleri yazılımsal çizimde yavaş)
    const l = st.rect.l - 60, r = st.rect.r + 60;
    for (let t = st.rect.t; t < st.rect.b; t += bandH) bands.push({ t, b: Math.min(st.rect.b, t + bandH), l, r });
    this.job = { st, bands, k: 0, sparkles: [], t0: performance.now() };
  }

  _cancelJob() { this.job = null; }

  _stepJob(budget = 6) {
    const job = this.job;
    if (!job) return;
    const t0 = performance.now();
    this._swapBuffers();      // arka tamponu geçici olarak "ön" yap → normal çizim yolu kullanılır
    const front = this.stB;
    this.st = job.st;
    let done = false;
    try {
      while (job.k < job.bands.length) {
        this._drawGroundFull(false, job.bands[job.k++], job.sparkles);
        if (performance.now() - t0 > budget) break;
      }
      if (job.k >= job.bands.length) {
        const level = job.st.s < 0.75 ? 'half' : 'full';
        this._applyStatic(this.groundCtx);
        this._drawFarms(this.groundCtx, level);
        if (this.showGrid) this._strokeGrid(this.groundCtx, this._computeSpans(this.groundSpans, CONFIG.GROUND_PAD, job.st.rect));
        this.stats.objects = this._drawObjects();
        this._mapV = this.map.version;
        this._groundV = this.map.groundVersion;
        this.st.fromOverview = false;
        this.job = null;
        this.stats.staticRedraws++;
        this.stats.staticMs = performance.now() - job.t0;
        done = true; // tamamlandı: arka tampon artık ön tampon (geri değiştirme yok)
      }
    } catch (e) {
      this.job = null;
      throw e;
    } finally {
      // Bitmediyse (veya hata olduysa) ön tamponu geri getir; yarım çizim arka tamponda bekler
      if (!done) { this._swapBuffers(); this.st = front; }
    }
  }

  /**
   * Doku deseni (CanvasPattern) + izometrik dönüşüm.
   * Kare dokuyu grid uzayına (u, v) yayıp izometrik projeksiyona sokuyoruz:
   *   dünyaX = (u − v) · HW / S ,  dünyaY = (u + v) · HH / S     (S = karo başına doku pikseli)
   * Böylece doku zemine "yatırılmış" görünür (perspektifli) ve karolar arasında kesintisiz akar.
   */
  _pattern(texKey, level, tilesPerTexture) {
    const tex = this.sprites.textures[texKey];
    const src = tex[level];
    const key = `${texKey}:${level}`;
    let p = this._patterns.get(key);
    if (!p) {
      p = this.groundCtx.createPattern(src, 'repeat');
      this._patterns.set(key, p);
    }
    const S = src.width / tilesPerTexture;
    p.setTransform(new DOMMatrix([HW / S, HH / S, -HW / S, HH / S, 0, 0]));
    return p;
  }

  /** Tüm haritanın zeminini (ve su maskesi/köpüğünü) bir kez çizer. Açılışta yükleme ekranı sürerken çağrılır. */
  buildOverview() {
    const t0 = performance.now();
    const map = this.map, P = OV_PAD;
    const x0 = -map.height * HW - P, x1 = map.width * HW + P;
    const y0 = -HH - P - 120, y1 = (map.width + map.height) * HH + P;
    const w = Math.ceil((x1 - x0) * OV_SCALE), h = Math.ceil((y1 - y0) * OV_SCALE);
    const ov = { x: x0, y: y0, ww: x1 - x0, wh: y1 - y0, ground: document.createElement('canvas') };
    ov.ground.width = w; ov.ground.height = h;
    const k = this.water.k;
    ov.mask = document.createElement('canvas'); ov.mask.width = Math.ceil(w * k); ov.mask.height = Math.ceil(h * k);
    ov.foam = document.createElement('canvas'); ov.foam.width = ov.mask.width; ov.foam.height = ov.mask.height;

    // Normal çizim yolunu, hedef tuvalleri geçici olarak genel bakış tuvalleriyle değiştirerek kullan
    const wr = this.water;
    const saved = { layer: this.groundLayer, ctx: this.groundCtx, st: this.st, M: this.M, grid: this.showGrid,
      mask: wr.mask, maskCtx: wr.maskCtx, foam: wr.foam, foamCtx: wr.foamCtx };
    this.groundLayer = ov.ground;
    this.groundCtx = ov.ground.getContext('2d', { alpha: false });
    wr.mask = ov.mask; wr.maskCtx = ov.mask.getContext('2d');
    wr.foam = ov.foam; wr.foamCtx = ov.foam.getContext('2d');
    this.st = { x: x0, y: y0, s: OV_SCALE, time: t0, rect: { l: x0, t: y0, r: x1, b: y1 } };
    this.M = 0;
    this.showGrid = false;
    try {
      this._drawGroundFull(true);
    } finally {
      this.groundLayer = saved.layer; this.groundCtx = saved.ctx; this.st = saved.st; this.M = saved.M; this.showGrid = saved.grid;
      wr.mask = saved.mask; wr.maskCtx = saved.maskCtx; wr.foam = saved.foam; wr.foamCtx = saved.foamCtx;
      this._patterns.clear();
    }
    this.ov = ov;
    this._dirty = true;
    this.stats.overviewMs = performance.now() - t0;
  }

  /** Uzak zoom: zemin = genel bakış görüntüsünden kopya + çiftlikler + grid; su maskesi de kopyadan */
  _drawGroundOverview() {
    const g = this.groundCtx, ov = this.ov, st = this.st;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1f6378'; // genel bakışın dışında kalan okyanus (su animasyonu üstünü örter)
    g.fillRect(0, 0, this.groundLayer.width, this.groundLayer.height);
    this._applyStatic(g);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'medium';
    // Yalnızca önbelleğin kapsadığı parça kopyalanır (bütün görüntüyü büyütmek yakın zoom'da çok pahalı)
    const c = ovCrop(ov, st.rect, ov.ground.width / ov.ww);
    if (c) g.drawImage(ov.ground, c.sx, c.sy, c.sw, c.sh, c.x, c.y, c.w, c.h);

    // Dalga parıltıları için görünür derin su karoları (yalnızca sayısal tarama, çizim yok)
    const sparkles = [], spans = this._computeSpans(this.groundSpans, CONFIG.GROUND_PAD, st.rect), map = this.map;
    for (let j = spans.jMin; j <= spans.jMax && sparkles.length < 3000; j++) {
      const depth = map.waterDepth[j];
      for (let i = spans.i0[j], end = spans.i1[j]; i <= end; i++) {
        if (depth[i] >= 2) sparkles.push([(i - j) * HW, (i + j) * HH, i, j]);
      }
    }
    this.water.buildFromOverview(ov, { s: st.s, e: -st.x * st.s + this.M, f: -st.y * st.s + this.M }, sparkles, st.rect);

    this._drawFarms(g, st.s < 0.75 ? 'half' : 'full');
    if (this.showGrid) this._strokeGrid(g, spans);
  }

  _strokeGrid(g, spans) {
    const grid = new Path2D();
    for (let j = spans.jMin; j <= spans.jMax; j++) {
      for (let i = spans.i0[j], end = spans.i1[j]; i <= end; i++) traceDiamond(grid, (i - j) * HW, (i + j) * HH);
    }
    g.lineWidth = 1 / this.camera.zoom;
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.stroke(grid);
  }

  /**
   * Tam zemin çizimi.
   *  forOverview: genel bakış için (çiftlik ve grid hariç; onlar sonradan üstüne çizilir)
   *  band       : { t, b } yalnızca bu yatay dünya şeridini çiz (arka tampon işi). Leke ve bulanıklıklar şerit
   *               sınırını aşabildiği için komşu karolar da yola katılır, sonuç şeride kırpılır → dikiş olmaz.
   */
  _drawGroundFull(forOverview, band = null, sparkleAcc = null) {
    const g = this.groundCtx, map = this.map;
    const SR = this.st.rect;
    if (band) {
      this._applyStatic(g);
      g.save();
      g.beginPath();
      g.rect(SR.l - 4, band.t, SR.r - SR.l + 8, band.b - band.t);
      g.clip();
      g.fillStyle = CONFIG.BACKGROUND;
      g.fillRect(SR.l - 4, band.t, SR.r - SR.l + 8, band.b - band.t);
    } else {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = CONFIG.BACKGROUND;
      g.fillRect(0, 0, this.groundLayer.width, this.groundLayer.height);
      this._applyStatic(g);
    }
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'medium';

    const s = this._computeSpans(this.groundSpans, CONFIG.GROUND_PAD, band ? { l: SR.l, r: SR.r, t: band.t - 70, b: band.b + 70 } : SR);
    // LOD: uzak zoom'da daha az ama biraz büyük leke; genel bakışta (çok küçük ölçek) karo kenarı başına 1 leke yeter
    BLOBS_PER_EDGE = forOverview ? 1 : this.st.s / this.dpr < 0.9 ? 2 : 3;
    const paths = {};
    // Parçalı yollar: tek dev Path2D Chromium'da karesel yavaşlıyor (büyük haritada genel bakış 4,6 sn → ~0,4 sn)
    for (const t of TERRAIN_ORDER) paths[t] = new ChunkedPath();
    const water = new ChunkedPath(), deep = new ChunkedPath(), deeper = new ChunkedPath();
    const sparkles = sparkleAcc ?? [];
    const grid = this.showGrid && !band ? new Path2D() : null;
    const depthGrid = map.waterDepth;

    for (let j = s.jMin; j <= s.jMax; j++) {
      const row = map.terrain[j];
      for (let i = s.i0[j], end = s.i1[j]; i <= end; i++) {
        const t = row[i];
        const cx = (i - j) * HW, cy = (i + j) * HH;
        if (grid) traceDiamond(grid, cx, cy);
        if (t === TileId.WATER) {
          traceDiamond(water, cx, cy, HW + 3, HH + 1.5);
          const d = depthGrid[j][i];
          if (d >= 2) {
            traceDiamond(deep, cx, cy, HW + 3, HH + 1.5);
            if (sparkles.length < 3000 && (!band || (cy >= band.t && cy < band.b))) sparkles.push([cx, cy, i, j]);
          }
          if (d >= 3) traceDiamond(deeper, cx, cy, HW + 3, HH + 1.5);
          // Organik kıyı: su, komşu kara karolarına düzensiz elipslerle taşar
          for (let e = 0; e < 4; e++) {
            const E = EDGES[e];
            const u = map.getTile(i + E.di, j + E.dj);
            if (u >= 0 && u !== TileId.WATER) addEdgeBlobs(water, i, j, cx, cy, E, e, 1.1);
          }
          continue;
        }
        // +3 px taşma: karolar arası anti-aliasing dikişi (seam) oluşmasın
        traceDiamond(paths[t], cx, cy, HW + 3, HH + 1.5);
        // ── ORGANİK GEÇİŞLER ──
        // Komşu karo daha düşük öncelikli bir zeminse, ortak kenar boyunca komşuya taşan
        // rastgele elipsler ekle → düz eşkenar dörtgen sınırlar yerine doğal, düzensiz geçişler.
        for (let e = 0; e < 4; e++) {
          const E = EDGES[e];
          const u = map.getTile(i + E.di, j + E.dj);
          if (u < 0 || u === TileId.WATER || u === t || PRIORITY[t] < PRIORITY[u]) continue;
          addEdgeBlobs(paths[t], i, j, cx, cy, E, e);
        }
      }
    }

    // Harita dışı = sonsuz okyanus. Görünüm dikdörtgeni (saat yönü) + harita elması (ters yön):
    // nonzero sarım kuralında elmasın içi "delik" olur, dışı su olarak dolar.
    // Şerit modunda okyanus dikdörtgeni de şeritle sınırlı: bulanık gölgeler (ıslak kum, derinlik) Canvas'ta
    // kırpmadan ÖNCE şeklin tüm sınırları için hesaplanır; tam ekran dikdörtgen her şeridi tam çizim kadar pahalı yapar.
    const R = band
      ? { l: SR.l - 300, t: band.t - 110, r: SR.r + 300, b: band.b + 110 }
      : { l: SR.l - 300, t: SR.t - 300, r: SR.r + 300, b: SR.b + 300 };
    // Harita elması dikdörtgene kırpılır: yolun sınırları R'yi aşmaz (gölge/bulanıklık maliyeti R ile sınırlı kalır)
    const [mT, mR, mB, mL] = footprintCorners(0, 0, map.width);
    const hole = clipPolyToRect([mT, mL, mB, mR], R);
    // Dikdörtgen tamamen haritanın içindeyse dışarıda okyanus yoktur: boş bir "dikdörtgen eksi aynı dikdörtgen"
    // eklemek hiçbir şey çizmez ama bulanık gölgelerin hesaplandığı alanı tüm ekrana büyütür (çok pahalı)
    const inside = (x, y) => Math.abs(x - mT[0]) / (mR[0] - mT[0]) + Math.abs(y - (mT[1] + mB[1]) / 2) / ((mB[1] - mT[1]) / 2) <= 1;
    const allLand = inside(R.l, R.t) && inside(R.r, R.t) && inside(R.l, R.b) && inside(R.r, R.b);
    if (!allLand) for (const p of [water, deep, deeper]) {
      p.fresh(); // dikdörtgen ve delik aynı Path2D'de olmalı (sarım kuralı)
      p.rect(R.l, R.t, R.r - R.l, R.b - R.t);
      if (hole.length >= 3) {
        p.moveTo(hole[0][0], hole[0][1]);
        for (let q = 1; q < hole.length; q++) p.lineTo(hole[q][0], hole[q][1]);
        p.closePath();
      }
    }

    // Uzak zoom'da yarım çözünürlüklü doku → küçültme titreşimi (aliasing) azalır
    const level = this.st.s < 0.75 ? 'half' : 'full';
    for (const t of TERRAIN_ORDER) {
      g.fillStyle = this._pattern(TEX_OF[t], level, CONFIG.TEXTURE_TILES);
      fillPath(g, paths[t]);
    }

    // Makro varyasyon: dokunun her 6 karoda bir tekrar ettiğini gizleyen büyük ölçekli ton farkları
    g.globalCompositeOperation = 'multiply';
    let noise = this._patterns.get('noise');
    if (!noise) { noise = g.createPattern(this.sprites.noise, 'repeat'); this._patterns.set('noise', noise); }
    const S = 256 / 22;
    noise.setTransform(new DOMMatrix([HW / S, HH / S, -HW / S, HH / S, 0, 0]));
    g.fillStyle = noise;
    if (band) g.fillRect(SR.l - 4, band.t, SR.r - SR.l + 8, band.b - band.t);
    else g.fillRect(SR.l, SR.t, SR.r - SR.l, SR.b - SR.t);
    g.globalCompositeOperation = 'source-over';

    const st = this.st;
    this.water.buildStatic(g, { water, deep, deeper }, { s: st.s, e: -st.x * st.s + this.M, f: -st.y * st.s + this.M }, st.s, sparkles, band);

    if (band) { g.restore(); return; }
    if (forOverview) return;
    this._drawFarms(g, level);

    if (grid) {
      g.lineWidth = 1 / this.camera.zoom;
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.stroke(grid);
    }
  }

  _drawFarms(g, level) {
    const R = this.st.rect, v = { l: R.l - 40, t: R.t - 40, r: R.r + 40, b: R.b + 40 };
    this._drawPaths(g, v);
    for (const b of this.world.buildings) {
      if (b.type !== 'farm') continue;
      const P = footprintCorners(b.originI, b.originJ, b.size);
      if (P[1][0] < v.l || P[3][0] > v.r || P[2][1] < v.t || P[0][1] > v.b) continue;
      const cx = (P[0][0] + P[2][0]) / 2, cy = (P[0][1] + P[2][1]) / 2;
      const Q = P.map(([x, y]) => [cx + (x - cx) * 0.95, cy + (y - cy) * 0.95]);
      g.beginPath();
      g.moveTo(Q[0][0], Q[0][1]);
      for (let k = 1; k < 4; k++) g.lineTo(Q[k][0], Q[k][1]);
      g.closePath();
      if (b.complete) {
        g.fillStyle = this._pattern('farm', level, 2.7); // ~3 sıra / karo
        g.fill();
        const used = 1 - b.food / b.def.farmFood; // tükendikçe sararır
        if (used > 0.45) { g.fillStyle = `rgba(170,140,60,${(used - 0.45) * 0.7})`; g.fill(); }
      } else {
        g.fillStyle = this._pattern('dirt', level, CONFIG.TEXTURE_TILES);
        g.fill();
        g.fillStyle = `rgba(60,35,15,${0.45 - b.progress * 0.25})`;
        g.fill();
      }
      g.lineWidth = 2.5;
      g.strokeStyle = 'rgba(80,52,24,0.85)';
      g.stroke();
    }
  }

  /** Patikalar: zemin katmanında taş döşeli karolar (yapımdayken soluk toprak), kenarı hafif koyu */
  _drawPaths(g, v) {
    const paths = this.world.buildings.filter((b) => b.def.ground);
    if (!paths.length) return;
    const tex = this.sprites.sprites.tex_path?.levels[0];
    let pat = this._pathPat;
    if (!pat && tex) pat = this._pathPat = g.createPattern(tex, 'repeat');
    if (pat) { const S = tex.width / 2; pat.setTransform(new DOMMatrix([HW / S, HH / S, -HW / S, HH / S, 0, 0])); }
    const done = new Path2D(), site = new Path2D();
    for (const b of paths) {
      const cx = (b.i - b.j) * HW, cy = (b.i + b.j) * HH;
      if (cx < v.l || cx > v.r || cy < v.t || cy > v.b) continue;
      traceDiamond(b.complete ? done : site, cx, cy, HW * 0.98, HH * 0.98);
    }
    g.fillStyle = 'rgba(90,70,45,0.45)';
    g.fill(site);
    g.fillStyle = pat ?? '#9a948a';
    g.fill(done);
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(60,50,40,0.35)';
    g.stroke(done);
  }

  _drawObjects() {
    const o = this.objectCtx, map = this.map;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.objectLayer.width, this.objectLayer.height);
    this._applyStatic(o);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'medium';

    const v = this.st.rect;
    const s = this._computeSpans(this.objectSpans, CONFIG.OBJECT_PAD, v);
    const list = [];
    for (let j = s.jMin; j <= s.jMax; j++) {
      const row = map.objects[j];
      for (let i = s.i0[j], end = s.i1[j]; i <= end; i++) {
        const obj = row[i];
        if (!obj || obj.type === 'farm' || obj.def?.ground) continue;
        const L = this.layout(obj);
        if (!L || L.x > v.r || L.y > v.b || L.x + L.w < v.l || L.y + L.h < v.t) continue;
        list.push(L);
      }
    }
    // İzometrik derinlik sıralaması: ayak izi merkezinin (i + j) toplamı; eşitlikte soldan sağa
    list.sort((a, b) => (a.obj.depth - b.obj.depth) || (a.x - b.x));

    // Önce TÜM gölgeler, sonra sprite'lar: gölge hiçbir zaman komşu nesnenin üstüne binmez
    const shadow = this.sprites.shadow;
    for (const L of list) {
      for (const sh of L.shadows ?? []) {
        o.globalAlpha = sh.a;
        o.drawImage(shadow, sh.x - sh.rx, sh.y - sh.ry, sh.rx * 2, sh.ry * 2);
      }
    }
    o.globalAlpha = 1;
    const px = this.camera.zoom * this.dpr;
    for (const L of list) {
      const b = L.obj;
      if (b.isBuilding && !b.complete) {
        // İnşaat: tamamlanana kadar tek, statik iskele görseli (ilerleme yalnızca üstteki sarı çubukta)
        const f = this.sprites.get('foundation');
        const fw = L.baseW / f.baseRatio, fh = fw * f.aspect;
        this._blit(o, f, L.cx - f.anchorX * fw, L.cy + HH - fh + 2, fw, fh, false, px);
      } else if (L.anim) {
        // kanatları dönen değirmen: dinamik katmanda çizilir
      } else {
        this._blit(o, L.s, L.x, L.y, L.w, L.h, L.flip, px);
      }
    }
    this.pickList = list;
    return list.length;
  }

  /** Bir nesnenin ekrandaki sprite dikdörtgeni (dünya birimi) ve gölgesi; kışın karlı görsel */
  layout(obj) {
    const L = this._layout(obj);
    if (L && this._snowy) L.s = this.sprites.snowy(L.s);
    return L;
  }

  _layout(obj) {
    const sp = this.sprites;
    const cx = (obj.i - obj.j + obj.offX - obj.offY) * HW;
    const cy = (obj.i + obj.j + obj.offX + obj.offY) * HH;
    if (obj.isBuilding) {
      const owner = obj.owner ?? PLAYER;
      // Sur/kapı kendi kademesiyle (taş sur, kale suru), diğer binalar sahibinin çağıyla çizilir
      const tier = obj.def?.tiers ? obj.tier : this.world.players[owner].tier;
      const nightKey = obj.def?.dayNight && this._night && obj.progress >= 1 ? sp.get(`${obj.def.sprite}_night`) : null;
      const s = obj.progress !== undefined && obj.progress < 1 ? sp.get('foundation') : nightKey ?? sp.building(obj.type, tier, owner);
      const baseW = obj.size * TW * CONFIG.BUILDING_FIT * (obj.def?.fit ?? 1); // ince tabanlı süsler (fener, heykel) küçültülür
      const w = baseW / s.baseRatio, h = w * s.aspect;
      // Taban merkezi = ayak izi merkezi (x), görselin alt kenarı = ayak izinin ön köşesi (y)
      const x = cx - s.anchorX * w, y = cy + HH - h + 2;
      const fcY = cy + HH - obj.size * HH; // ayak izi merkezinin y'si
      // Animasyonlu bina (yel değirmeni): sprite anahtarına ait kare dizisi varsa
      const bkey = obj.progress !== undefined && obj.progress >= 1 && !nightKey ? sp.buildingKey(obj.type, tier) : null;
      const anim = bkey && sp.anims[bkey] ? bkey : null;
      // İki katmanlı gölge: temas gölgesi (ambient occlusion) + güneşin sol-üstten düşürdüğü sağa uzanan gölge
      return { obj, s, x, y, w, h, cx, cy, baseW, flip: false, anim, shadows: [
        { x: cx, y: fcY + obj.size * HH * 0.1, rx: baseW * 0.58, ry: obj.size * HH * 1.1, a: 0.85 },
        { x: cx + baseW * 0.34, y: fcY - obj.size * HH * 0.05, rx: baseW * 0.52, ry: obj.size * HH * 0.85, a: 0.85 },
      ] };
    }
    let s, w, h, y, shadow = null;
    switch (obj.kind) {
      case 'tree':
        s = sp.tree(obj.variant, this.world.weather.season.id); h = CONFIG.TREE_HEIGHT * obj.scale; w = h / s.aspect; y = cy + HH * 0.35 - h;
        shadow = { x: cx + w * 0.4, y: cy + HH * 0.12, rx: w * 0.62, ry: w * 0.26, a: 1 };
        break;
      case 'berry':
        s = sp.get('berry'); w = TW * 0.62 * obj.scale; h = w * s.aspect; y = cy + HH * 0.5 - h;
        break;
      case 'gold':
      case 'stone':
        s = sp.get(obj.kind); w = TW * 0.95 * obj.scale; h = w * s.aspect; y = cy + HH * 0.62 - h;
        break;
      case 'mountain':
        s = sp.get('mountain'); w = TW * 1.45 * obj.scale; h = w * s.aspect; y = cy + HH * 0.85 - h;
        break;
      case 'campfire': {
        s = sp.get('campfire');
        if (!s) return null;
        w = TW * 1.15; h = w * s.aspect; y = cy + HH * 0.55 - h;
        return { obj, s, x: cx - s.anchorX * w, y, w, h, cx, cy, flip: false, shadows: [] };
      }
      case 'stump':
        s = sp.get('stump'); w = TW * 0.42 * obj.scale; h = w * s.aspect; y = cy + HH * 0.35 - h;
        break;
      case 'portal':
      case 'quarry':
      case 'goldReserve':
      case 'cave': {
        // Mağara ve kaynak tesisleri: 3×3 ayak izine oturur
        s = sp.get(obj.kind);
        if (!s) return null;
        const baseW = obj.size * TW * 1.08;
        w = baseW / s.baseRatio; h = w * s.aspect; y = cy + HH - h + 4;
        return { obj, s, x: cx - s.anchorX * w, y, w, h, cx, cy, flip: false, shadows: [
          { x: cx + baseW * 0.2, y: cy + HH - obj.size * HH, rx: baseW * 0.6, ry: obj.size * HH * 1.0, a: 0.8 },
        ] };
      }
      case 'ruins': {
        // Yıkıntı: binanın ayak izine oturur (bina gibi ölçeklenir)
        s = sp.get('ruins');
        const baseW = obj.size * TW * 0.95;
        w = baseW / s.baseRatio; h = w * s.aspect; y = cy + HH - h + 2;
        return { obj, s, x: cx - s.anchorX * w, y, w, h, cx, cy, flip: false, shadows: [] };
      }
      default:
        return null;
    }
    const ax = obj.flip ? 1 - s.anchorX : s.anchorX;
    const x = cx - ax * w;
    if (!shadow && obj.kind !== 'mountain') shadow = { x: cx + w * 0.18, y: y + h * 0.88, rx: w * 0.62, ry: w * 0.25, a: 0.9 };
    return { obj, s, x, y, w, h, cx, cy, flip: obj.flip, shadows: shadow ? [shadow] : [] };
  }

  _blit(ctx, s, x, y, w, h, flip, px) {
    const lvl = s.pick(w * px);
    if (flip) {
      ctx.save();
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(lvl, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(lvl, x, y, w, h);
    }
  }

  // ═════════════════════ DİNAMİK KATMAN ═════════════════════
  /** Dünya koordinatında nesne seçimi: önden arkaya, piksel hassasiyetinde (alfa maskesi) */
  pickObject(wx, wy) {
    for (let k = this.pickList.length - 1; k >= 0; k--) {
      const L = this.pickList[k];
      if (wx < L.x || wy < L.y || wx > L.x + L.w || wy > L.y + L.h) continue;
      if (L.obj.kind === 'mountain' || L.obj.kind === 'stump' || L.obj.kind === 'ruins' || L.obj.kind === 'campfire' || L.obj.kind === 'cave' || L.obj.kind === 'portal' || L.obj.def?.ground) continue;
      let u = (wx - L.x) / L.w;
      if (L.flip) u = 1 - u;
      if (L.s.hit(u, (wy - L.y) / L.h)) return L.obj;
    }
    return null;
  }

  pickUnit(wx, wy) {
    for (let k = this.unitRects.length - 1; k >= 0; k--) {
      const R = this.unitRects[k];
      // Köylü küçük: kutuyu biraz genişlet → tıklaması kolay olsun
      if (wx >= R.x - 3 && wx <= R.x + R.w + 3 && wy >= R.y - 2 && wy <= R.y + R.h + 2) return R.u;
    }
    return null;
  }

  /** Enterpolasyonlu konum (20 Hz simülasyon → ekran hızı) + görsel ofsetler */
  _unitPos(u, alpha, time) {
    let gx = u.prevX + (u.x - u.prevX) * alpha;
    let gy = u.prevY + (u.y - u.prevY) * alpha;
    let facing = u.facing;
    if (u.state === 'gather' && u.phase === 'work' && u.task?.target?.isBuilding) {
      // Çiftçi tarlanın içinde ileri geri dolaşır
      const a = time * 0.45 + u.id;
      gx += Math.sin(a) * 0.8;
      gy += Math.cos(time * 0.37 + u.id * 1.7) * 0.8;
      facing = Math.cos(a) >= 0 ? 1 : -1;
    }
    // Aynı karodaki birimler üst üste binmesin: kimliğe bağlı sabit küçük ofset (yalnızca görsel)
    gx += (((u.id * 73) % 11) / 10 - 0.5) * 0.12;
    gy += (((u.id * 37) % 7) / 6 - 0.5) * 0.12;
    return { wx: (gx - gy) * HW, wy: (gx + gy) * HH, facing };
  }

  /**
   * Birimler ve süsler (tavuk, ateş başındaki askerler) — binalar/ağaçlar doğru şekilde ÖNDE kalır.
   *
   * Statik katman birimlerden önce çizildiği için arkada kalan birim normalde binanın üstüne binerdi.
   * Çözüm (yalnızca gerekli nesneler için): tüm birimler çizildikten sonra, bir birimi örten her bina/ağaç
   * yeniden basılır ve o nesnenin ÖNÜNDE kalan birimler tekrar çizilir. "Önde" kuralı ayak izine göredir:
   * birim, binanın ön kenarlarından (+i veya +j yüzü) birinin ötesindeyse öndedir — merkez derinliği karşılaştırmasının
   * binanın yanında duran birimde yaptığı titremeyi önler. Örtülen KENDİ birimleriniz soluk siluetle görünür
   * (kaybolmasın); düşman ve süsler tamamen gizlenir. Can çubukları en sonda, her şeyin üstünde çizilir.
   */
  _drawUnits(ctx, frame) {
    const { alpha, time, selected } = frame;
    const sp = this.sprites;
    const v = this._viewRect(40);
    const items = [];
    const fog = this.world.fog;
    for (const u of this.world.units) {
      if (u.owner !== PLAYER && fog && !fog.isVisible(u.x, u.y)) continue; // sisin içindeki düşman görünmez
      const P = this._unitPos(u, alpha, time);
      if (P.wx < v.l || P.wx > v.r || P.wy < v.t || P.wy > v.b + 40) continue;
      items.push({ u, ...P });
    }
    for (const d of this._campfireCrew(frame)) items.push(d);
    if (Settings.data.life) for (const d of this.ambient.chickenItems(frame)) items.push(d);
    items.sort((a, b) => a.wy - b.wy);

    const zoom = this.camera.zoom, px = zoom * this.dpr;
    this.unitRects = [];
    for (const it of items) this._prepareItem(it, time, px);

    // 1) Herkes (gölge + seçim halkası + gövde)
    for (const it of items) { this._drawItemBase(ctx, it, selected, zoom); this._drawItemBody(ctx, it, px); }

    // 2) Örtücüler: birimi gerçekten örten (birim arkasında ve görseli çakışan) binalar/ağaçlar
    const occluders = this.pickList.filter((L) => L.obj.isBuilding || L.obj.kind === 'tree' || L.obj.kind === 'mountain' || L.obj.kind === 'cave' || L.obj.size === 3 && L.obj.isResource);
    const covering = new Map(); // L → örttüğü öğeler
    for (const it of items) {
      for (const L of occluders) {
        if (it.x + it.w < L.x || it.x > L.x + L.w || it.y + it.h < L.y || it.y > L.y + L.h) continue;
        if (!this._behind(it, L.obj)) continue;
        if (!this._spriteOverlap(it, L)) continue;
        let arr = covering.get(L);
        if (!arr) covering.set(L, arr = []);
        arr.push(it);
        it.hidden = true;
      }
    }
    if (covering.size) {
      const list = [...covering.keys()].sort((a, b) => (a.obj.depth - b.obj.depth) || (a.x - b.x));
      for (const L of list) {
        if (L.anim) this._drawAnimatedBuilding(ctx, L, frame, px);
        else if (L.obj.isBuilding && !L.obj.complete) this._drawFoundation(ctx, L, px);
        else this._blit(ctx, L.s, L.x, L.y, L.w, L.h, L.flip, px);
        // Bu nesnenin önünde kalıp görseliyle çakışan öğeler yeniden çizilir
        for (const it of items) {
          if (it.x + it.w < L.x || it.x > L.x + L.w || it.y + it.h < L.y || it.y > L.y + L.h) continue;
          if (!this._behind(it, L.obj)) this._drawItemBody(ctx, it, px);
        }
      }
      // 3) Örtülen kendi birimleriniz: soluk siluet
      ctx.globalAlpha = 0.32;
      for (const it of items) if (it.hidden && it.u && it.u.owner === PLAYER) this._drawItemBody(ctx, it, px);
      ctx.globalAlpha = 1;
    }

    // 4) Can çubukları (seçili veya hasarlı)
    for (const it of items) {
      const u = it.u;
      if (!u || !(selected.has(u) || u.hp < u.maxHp)) continue;
      this._bar(ctx, it.bx, it.y - 4, (u.type === 'yeti' ? 44 : 22) / Math.max(zoom, 0.7), u.hp / u.maxHp, u.owner !== PLAYER ? '#e8483c' : '#4cd964');
    }
  }

  /** Birim/süs ayak izi binanın arkasında mı? (ön kenarlardan birinin ötesindeyse önde sayılır) */
  _behind(it, o) {
    const gx = it.gx, gy = it.gy;
    if (gx === undefined) return false;
    if (o.isBuilding) return gx < o.i + 0.45 && gy < o.j + 0.45;
    // Ağaç/dağ (tek karo, ofsetli): kendi karosunun ön köşesi
    return gx + gy < o.i + o.j + o.offX + o.offY - 0.15;
  }

  /** Öğenin gövde noktası örtücünün dolu pikseline denk geliyor mu (ağacın boşluğundan görünüyorsa örtülmez) */
  _spriteOverlap(it, L) {
    for (const fy of [0.3, 0.6, 0.85]) {
      const px = it.bx, py = it.y + it.h * fy;
      if (px < L.x || px > L.x + L.w || py < L.y || py > L.y + L.h) continue;
      let u = (px - L.x) / L.w;
      if (L.flip) u = 1 - u;
      if (L.s.hit(u, (py - L.y) / L.h)) return true;
    }
    return false;
  }

  /** Öğenin çizim bilgisini bir kez hesapla: sprite, dikdörtgen, ızgara konumu */
  _prepareItem(it, time, px) {
    const sp = this.sprites;
    if (it.deco) {
      it.gx = (it.wy / HH + it.wx / HW) / 2; it.gy = (it.wy / HH - it.wx / HW) / 2;
      if (it.draw) { it.w = 16; it.h = 16; it.x = it.wx - 8; it.y = it.wy - 14; }
      else {
        const k = it.k ?? sp.unitScale.militia, s = it.s;
        it.w = s.levels[0].width * k; it.h = s.levels[0].height * k;
        it.x = it.wx - (it.flip ? 1 - s.anchorX : s.anchorX) * it.w; it.y = it.wy - it.h + 1.5;
      }
      it.bx = it.wx;
      return;
    }
    const u = it.u;
    let { wx, wy } = it;
    const st = u.animState;
    let s, w, h, flip;
    const veh = u.naval || u.def.siege || u.def.vehicle ? sp.vehicle(u) : null;
    it.rot = 0;
    if (veh) {
      // Tekne: dalgada iner-kalkar ve yalpalar (balık tutarken de); koçbaşı yalpalar, vururken öne atılır
      s = veh.s; flip = veh.flip; h = veh.h; w = h / s.aspect;
      if (u.naval) {
        wy += Math.sin(time * 2.1 + u.id) * 2 + 6;
        it.rot = Math.sin(time * 1.4 + u.id * 1.7) * 0.05;
        it.wake = u.moving;
      } else {
        if (u.moving) wy -= Math.abs(Math.sin(u.walkDist * 6)) * 1.2;
        if (u.engaged) { const ph = Math.max(0, Math.sin(((u.def.reload - Math.max(0, u.cooldown)) / u.def.reload) * Math.PI)); wx += u.hx * ph * 9; wy += u.hy * ph * 9; }
      }
    } else {
      s = sp.unitSprite(u, st);
      const k = sp.unitScale[u.type] ?? sp.villagerScale;
      if (u.def.animal && u.moving) wy -= Math.abs(Math.sin(u.walkDist * (u.type === 'rabbit' ? 9 : 5))) * (u.type === 'rabbit' ? 4 : 2.5);
      w = s.levels[0].width * k; h = s.levels[0].height * k;
      // Yürürken yön dilimi aynalamayı belirler (batı = doğunun aynası); dururken hedefe bakış (facing)
      flip = st?.flip !== undefined ? st.flip : it.facing < 0;
    }
    const ax = flip ? 1 - s.anchorX : s.anchorX;
    Object.assign(it, { s, w, h, flip, veh: !!veh, bx: wx, by: wy, x: wx - ax * w, y: wy - h + (veh && u.naval ? h * 0.18 : 1.5) });
    it.gx = u.x; it.gy = u.y;
    this.unitRects.push({ u, x: it.x, y: it.y, w, h });
  }

  _drawItemBase(ctx, it, selected, zoom) {
    if (it.deco) return;
    const u = it.u, sp = this.sprites;
    if (it.wake) this._drawWake(ctx, u, it.bx, it.by, this._lastFrameT);
    const big = u.type === 'yeti' ? 2.6 : u.type === 'cavalry' || it.veh ? 1.7 : 1;
    if (!u.naval) ctx.drawImage(sp.shadow, it.bx - 10 * big, it.by - 5 * big, 24 * big, 10 * big); // temas gölgesi
    if (selected.has(u)) {
      ctx.beginPath();
      ctx.ellipse(it.bx, it.by, 10 * big, 5 * big, 0, 0, Math.PI * 2);
      ctx.lineWidth = 1.6 / zoom;
      ctx.strokeStyle = u.owner !== PLAYER ? 'rgba(255,90,80,0.95)' : 'rgba(255,255,255,0.95)';
      ctx.stroke();
    }
  }

  _drawItemBody(ctx, it, px) {
    if (it.deco) { if (it.draw) it.draw(ctx); else this._drawDeco(ctx, it, px); return; }
    if (it.rot) {
      ctx.save();
      ctx.translate(it.bx, it.by);
      ctx.rotate(it.rot);
      ctx.translate(-it.bx, -it.by);
      this._blit(ctx, it.s, it.x, it.y, it.w, it.h, it.flip, px);
      ctx.restore();
    } else this._blit(ctx, it.s, it.x, it.y, it.w, it.h, it.flip, px);
  }

  /** İnşaat iskelesi (statik katmandaki ile aynı) */
  _drawFoundation(ctx, L, px) {
    const f = this.sprites.get('foundation');
    const fw = L.baseW / f.baseRatio, fh = fw * f.aspect;
    this._blit(ctx, f, L.cx - f.anchorX * fw, L.cy + HH - fh + 2, fw, fh, false, px);
  }

  /** Kanatları dönen yel değirmenleri (kareler kaynak sprite'ın dikdörtgenine oturtulur: meta.ref) */
  _drawAnimatedBuildings(ctx, frame) {
    const px = this.camera.zoom * this.dpr, v = this._viewRect(80);
    for (const L of this.pickList) {
      if (!L.anim) continue;
      if (L.x > v.r || L.x + L.w < v.l || L.y > v.b || L.y + L.h < v.t) continue;
      this._drawAnimatedBuilding(ctx, L, frame, px);
    }
  }

  _drawAnimatedBuilding(ctx, L, frame, px) {
    const sp = this.sprites;
    const frames = sp.anims[L.anim], meta = sp.animMeta[L.anim], ref = meta.ref ?? [0, 0, 1, 1];
    const key = frames[Math.floor(((frame.time / 2.2) % 1) * frames.length) % frames.length];
    const s = L.obj.owner === ENEMY ? sp.recolored(key) : sp.sprites[key];
    const W = L.w / ref[2], H = L.h / ref[3];
    this._blit(ctx, s, L.x - ref[0] * W, L.y - ref[1] * H, W, H, false, px);
  }

  /**
   * Savaş sisi: karo başına bir piksellik görüntü, izometrik matrisle ve yumuşatılarak çizilir.
   * piksel (u, v) → dünya: x = (u − v)·HW, y = (u + v − 1)·HH  (karo merkezi = piksel merkezi)
   */
  _drawFog(ctx) {
    const fog = this.world.fog;
    if (!fog?.enabled) return;
    const s = this.camera.zoom * this.dpr;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, -this.camera.x * s, -this.camera.y * s);
    ctx.transform(HW, HH, -HW, HH, 0, -HH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fog.canvas, 0, 0);
    ctx.restore();
  }

  /**
   * KAR ÖRTÜSÜ: zemin katmanının üstüne, suyun ALTINA dünya koordinatına sabit kar dokusu (kaydırınca kaymaz).
   * Örtü weather.snowCover ile ~40 sn'de gelir/erir. Su her karede üstüne çizildiğinden göller açık kalır;
   * sığ kıyılarda hafifçe beyaz görünür (buz). Çiftlikler de karla örtülür.
   */
  _drawSnowGround(ctx) {
    const cover = this.world.weather.snowCover;
    if (cover < 0.01) return;
    const pat = this._snowPat ?? (this._snowPat = ctx.createPattern(this.sprites.snowCanvas, 'repeat'));
    const S = 256 / 5; // doku 5 karoda bir tekrar eder
    pat.setTransform(new DOMMatrix([HW / S, HH / S, -HW / S, HH / S, 0, 0]));
    ctx.save();
    this._applyCamera(ctx);
    ctx.globalAlpha = 0.86 * cover;
    ctx.fillStyle = pat;
    const v = this._viewRect(4);
    ctx.fillRect(v.l, v.t, v.r - v.l, v.b - v.t);
    ctx.restore();
  }

  /** Mevsim renk tonu (ekran uzayında). Kışın soğuk beyazımsı, sonbaharda sıcak turuncu, ilkbaharda taze yeşil. */
  _drawSeason(ctx, frame) {
    const wthr = this.world.weather, id = wthr.season.id, I = wthr.intensity;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tint = { spring: 'rgba(170,255,160,0.10)', summer: 'rgba(255,215,140,0.08)', autumn: 'rgba(255,160,80,0.16)', winter: 'rgba(200,220,255,0.14)' }[id];
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, this.pixelW, this.pixelH);
    ctx.globalCompositeOperation = 'source-over';
    // Yağmur/kar sırasında hava kararır, sis beyazlatır
    if (wthr.kind === 'rain' && I > 0.02) { ctx.fillStyle = `rgba(25,35,55,${0.22 * I})`; ctx.fillRect(0, 0, this.pixelW, this.pixelH); }
    // Kar yağarken ekranı beyaz bir perdeyle örtme (sis gibi görünüyordu): yalnızca taneler (_drawWeather) yağar
    ctx.restore();
  }

  /** Yağmur damlası / kar tanesi / sis bulutları (ekran uzayında; adet kalite ayarına bağlı) */
  _drawWeather(ctx, frame, dt) {
    const wthr = this.world.weather, I = wthr.intensity;
    if (!Settings.data.weather || I < 0.02 || wthr.kind === 'clear') return;
    const W = this.pixelW, H = this.pixelH, t = frame.time, q = Settings.q.particles;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (wthr.kind === 'fog') {
      for (let k = 0; k < 6; k++) {
        const x = ((t * (12 + k * 3) + k * W * 0.31) % (W * 1.6)) - W * 0.3, y = H * (0.15 + 0.14 * k);
        const r = W * (0.35 + 0.05 * k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(225,230,235,${0.32 * I})`);
        g.addColorStop(1, 'rgba(225,230,235,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
      return;
    }
    const n = Math.round((wthr.kind === 'rain' ? 260 : 200) * I * q);
    const P = this.rain;
    while (P.length < n) P.push({ x: Math.random() * W, y: Math.random() * H, z: 0.5 + Math.random() * 0.5, ph: Math.random() * 6 });
    P.length = n;
    const d = this.dpr;
    if (wthr.kind === 'rain') {
      const vx = -90 * d, vy = 900 * d;
      ctx.strokeStyle = `rgba(200,215,240,${0.35 + 0.2 * I})`;
      ctx.lineWidth = 1.1 * d;
      ctx.beginPath();
      for (const p of P) {
        p.x += vx * p.z * dt; p.y += vy * p.z * dt;
        if (p.y > H) { p.y -= H + 20; p.x = Math.random() * W; }
        if (p.x < 0) p.x += W;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + vx * 0.02 * p.z, p.y + vy * 0.02 * p.z);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      for (const p of P) {
        p.y += 55 * d * p.z * dt;
        p.x += (Math.sin(t * 1.3 + p.ph) * 25 - 10) * d * p.z * dt;
        if (p.y > H) { p.y -= H + 10; p.x = Math.random() * W; }
        if (p.x < 0) p.x += W; else if (p.x > W) p.x -= W;
        const r = (1 + p.z * 1.4) * d;
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // ═════════════════════ GECE ═════════════════════
  /**
   * Kamp ateşi alevleri. Gündüz söndürülmüş odunlardan ince bir duman yükselir; gece büyük, titrek alevler,
   * kıvılcımlar ve geniş sıcak bir ışık halkası.
   */
  /** Ateşler: Kasaba Merkezi yanındaki kamp ateşi + köylülerin kurduğu ateş çukurları (big: daha geniş ışık) */
  _fireList() {
    const out = [];
    if (this.world.campfire) out.push({ obj: this.world.campfire, big: false, seed: 1 });
    for (const b of this.world.buildings) if (b.def.light && b.complete && b.owner === PLAYER) out.push({ obj: b, big: true, seed: b.id * 3.7 });
    return out;
  }

  _drawCampfire(ctx, frame) {
    const v = this._viewRect(260);
    for (const f of this._fireList()) {
      const L = this.layout(f.obj);
      if (!L || L.cx < v.l || L.cx > v.r || L.cy < v.t || L.cy > v.b) continue;
      this._drawCampfireAt(ctx, frame, L, f.big, f.seed);
    }
  }

  _drawCampfireAt(ctx, frame, L, big, seed) {
    const d = frame.darkness ?? 0;
    const x = L.cx, y = L.y + L.h * 0.55, t = frame.time, fx = this.fx;
    const lit = Math.min(1, d * 1.6); // akşam olurken yakılır
    // duman: gündüz ince, gece daha yoğun
    for (let q = 0; q < 5; q++) {
      const ph = (t * 0.25 + q / 5) % 1, sz = 6 + ph * 22;
      ctx.globalAlpha = Math.sin(Math.PI * ph) * (0.18 + 0.25 * lit);
      ctx.drawImage(fx.smoke, x + ph * ph * 18 - sz / 2, y - 10 - ph * 70 - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    if (lit < 0.02) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * lit;
    ctx.drawImage(fx.glow, x - 34, y - 26, 68, 46);
    for (let k = 0; k < 5; k++) {
      // Mum alevi gibi: yavaş ve düzensiz büyüyüp küçülür, hafifçe salınır
      const fl = candle(t, seed + k * 7.3);
      const h = (16 + 6 * hash3(k, 3, 7)) * fl * lit, w = 9 + 3 * hash3(k, 5, 1);
      const ox = (k - 2) * 3.2, sway = (cnoise(t * 0.9 + seed + k * 5.1) - 0.5) * 5;
      ctx.globalAlpha = 0.9;
      ctx.save();
      ctx.translate(x + ox, y + 3);
      ctx.transform(1, 0, sway / Math.max(h, 1), 1, 0, 0);
      ctx.drawImage(fx.flame, -w / 2, -h, w, h);
      ctx.restore();
    }
    // Kıvılcımlar: yukarı süzülüp sönen küçük noktalar
    ctx.fillStyle = '#ffd27a';
    for (let k = 0; k < 9; k++) {
      const ph = (t * (0.5 + hash3(k, 1, 2) * 0.4) + hash3(k, 9, 9)) % 1;
      ctx.globalAlpha = (1 - ph) * lit;
      ctx.fillRect(x + (hash3(k, 4, 4) - 0.5) * 14 + Math.sin(ph * 9 + k) * 4, y - 6 - ph * 46, 1.4, 1.4);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const glowF = 0.94 + 0.08 * cnoise(t * 1.2 + seed);
    this._lights.push({ x, y: y - 6, r: big ? 250 : 190, warm: true, flicker: glowF, strength: lit * (big ? 1.1 : 1) });
    // Ateş çukuru: merkezde ikinci, daha parlak bir halka → çevresi diğer yerlerden belirgin şekilde aydınlık
    if (big) this._lights.push({ x, y: y - 4, r: 120, warm: true, flicker: glowF, strength: lit });
  }

  /** Ateşin başındaki askerler (yalnızca gece): kupalarından içki içer, ateşe bakarlar */
  _campfireCrew(frame) {
    const cf = this.world.campfire, d = frame.darkness ?? 0;
    if (d < 0.35) return [];
    const out = [];
    // Ateş çukurlarının başında ısınan iki köylü
    const vil = this.sprites.sprites.vil_idle, vk = this.sprites.villagerScale;
    for (const b of this.world.buildings) {
      if (!b.def.light || !b.complete || b.owner !== PLAYER) continue;
      const fireX = (b.i - b.j) * HW;
      for (const [di, dj] of [[-0.95, 0.55], [0.6, -0.95]]) {
        const gi = b.i + di, gj = b.j + dj;
        if (!this.map.isWalkable(Math.round(gi), Math.round(gj))) continue;
        const wx = (gi - gj) * HW, wy = (gi + gj) * HH;
        out.push({ deco: true, s: vil, k: vk, wx, wy, flip: fireX < wx, alpha: Math.min(1, (d - 0.35) / 0.3) });
      }
    }
    if (!cf) return out;
    const frames = this.sprites.anims.mil_drink;
    const spots = [[-1.25, 0.15, 0.0], [0.2, -1.3, 0.37], [1.15, 0.85, 0.71]];
    for (const [di, dj, ph] of spots) {
      const gi = cf.i + di, gj = cf.j + dj;
      const wx = (gi - gj) * HW, wy = (gi + gj) * HH;
      const fireX = (cf.i - cf.j) * HW;
      let s;
      if (frames) {
        const p = (frame.time / 3.2 + ph) % 1;
        s = this.sprites.sprites[frames[Math.floor(p * frames.length) % frames.length]];
      } else s = this.sprites.unit('militia', 'idle', PLAYER);
      out.push({ deco: true, s, wx, wy, flip: fireX < wx, alpha: Math.min(1, (d - 0.35) / 0.3) });
    }
    return out;
  }

  _drawDeco(ctx, it, px) {
    const s = it.s, k = it.k ?? this.sprites.unitScale.militia;
    const w = s.levels[0].width * k, h = s.levels[0].height * k;
    const ax = it.flip ? 1 - s.anchorX : s.anchorX;
    ctx.globalAlpha = it.alpha;
    ctx.drawImage(this.sprites.shadow, it.wx - 10, it.wy - 5, 24, 10);
    this._blit(ctx, s, it.wx - ax * w, it.wy - h + 1.5, w, h, it.flip, px);
    ctx.globalAlpha = 1;
  }

  /**
   * Gece katmanı (ekran uzayında, yarım çözünürlük):
   *   1) mavi-lacivert karanlık   2) ışık kaynaklarında karanlık 'destination-out' ile oyulur
   *   3) ışıklar 'lighter' ile sıcak bir parıltı ekler
   * Işıklar: yangınlar, kamp ateşi ve geceleri pencerelerinden ışık sızan kendi binalarınız.
   */
  _drawNight(ctx, frame) {
    const d = frame.darkness ?? 0;
    if (d < 0.01) return;
    const t = frame.time;
    // Evlerin pencereleri (yalnızca ekrandaki tamamlanmış kendi binaları)
    const v = this._viewRect(80);
    for (const b of this.world.buildings) {
      if (!b.complete || b.type === 'farm' || b.owner !== PLAYER || b.def.ground || b.def.wall) continue;
      const cx = (b.centerI - b.centerJ) * HW, cy = (b.centerI + b.centerJ) * HH;
      if (cx < v.l || cx > v.r || cy < v.t || cy > v.b) continue;
      if (b.def.lamp) { this._lights.push({ x: cx, y: cy - 40, r: 125, warm: true, flicker: 0.96 + 0.04 * cnoise(t * 0.7 + b.id), strength: 0.9 }); continue; }
      if (b.def.decor) continue;
      this._lights.push({ x: cx, y: cy - b.size * 6, r: 40 + b.size * 26, warm: true, flicker: 0.95 + 0.05 * cnoise(t * 0.8 + b.id), strength: 0.55 });
    }

    const W = this.pixelW, H = this.pixelH, k = 0.5;
    if (!this.nightLayer) { this.nightLayer = document.createElement('canvas'); this.nightCtx = this.nightLayer.getContext('2d'); }
    const nl = this.nightLayer, n = this.nightCtx;
    if (nl.width !== Math.ceil(W * k) || nl.height !== Math.ceil(H * k)) { nl.width = Math.ceil(W * k); nl.height = Math.ceil(H * k); }
    n.setTransform(1, 0, 0, 1, 0, 0);
    n.globalCompositeOperation = 'source-over';
    n.clearRect(0, 0, nl.width, nl.height);
    n.fillStyle = `rgba(6,12,38,${0.66 * d})`;
    n.fillRect(0, 0, nl.width, nl.height);
    // Işıkların karanlığı oyması (dünya → ekran → yarım çözünürlük)
    const cam = this.camera, s = cam.zoom * this.dpr;
    const toScreen = (L) => [((L.x - cam.x) * s) * k, ((L.y - cam.y) * s) * k, L.r * s * k * (L.flicker ?? 1)];
    n.globalCompositeOperation = 'destination-out';
    const light = this.fx.light ?? (this.fx.light = makeLightSprite());
    for (const L of this._lights) {
      const [x, y, r] = toScreen(L);
      n.globalAlpha = Math.min(1, 0.95 * (L.strength ?? 1));
      n.drawImage(light, x - r, y - r * 0.62, r * 2, r * 1.24);
    }
    n.globalAlpha = 1;
    n.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(nl, 0, 0, W, H);
    // Sıcak ışık parıltısı
    ctx.globalCompositeOperation = 'lighter';
    for (const L of this._lights) {
      if (!L.warm) continue;
      const [x, y, r] = toScreen(L);
      ctx.globalAlpha = 0.22 * d * (L.strength ?? 1);
      ctx.drawImage(this.fx.glow, x / k - r / k * 0.7, y / k - r / k * 0.45, r / k * 1.4, r / k * 0.9);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /** Tekne izi: geri yöndeki iki açılan köpük çizgisi */
  _drawWake(ctx, u, wx, wy, time) {
    const bx = -u.hx, by = -u.hy * 0.5 - 0.0, len = 26;
    ctx.save();
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const px = -by * side, py = bx * side;
      ctx.strokeStyle = 'rgba(235,248,255,0.45)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(wx + bx * 10, wy + by * 10);
      ctx.lineTo(wx + bx * len + px * 9 + Math.sin(time * 6) * 1.5, wy + by * len + py * 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Ölen birimler: üretilmiş ölüm animasyonu (varsa) bir kez oynar ve son karede kalır; 4,5 sn'den sonra solar.
   * Tekne batar (aşağı kayıp solar), koçbaşı yerinde solar. Animasyonu olmayanlar devrilerek düşer.
   */
  _drawCorpses(ctx, frame) {
    const sp = this.sprites, px = this.camera.zoom * this.dpr, fog = this.world.fog;
    for (const c of this.world.corpses) {
      if (c.owner !== PLAYER && fog && !fog.isVisible(c.x, c.y)) continue;
      const wx = (c.x - c.y) * HW, wy = (c.x + c.y) * HH;
      const fade = c.t < 4.5 ? 1 : Math.max(0, 1 - (c.t - 4.5) / 1.5);
      if (c.naval || c.type === 'ram') {
        const veh = sp.vehicle({ type: c.type, owner: c.owner, dir: c.dir ?? 0 });
        if (!veh) continue;
        const h = veh.h, w = h / veh.s.aspect, sink = c.naval ? Math.min(1, c.t / 2.5) : 0;
        ctx.save();
        ctx.globalAlpha = Math.min(fade, c.naval ? 1 - sink : 1);
        ctx.beginPath(); ctx.rect(wx - w, wy - h * 2, w * 2, h * 2 + 4); ctx.clip(); // su çizgisinin altını kes
        ctx.translate(wx, wy + sink * h * 0.8);
        ctx.rotate((c.naval ? 0.25 : 0) * sink * (veh.flip ? -1 : 1));
        if (veh.flip) ctx.scale(-1, 1);
        ctx.drawImage(veh.s.pick(w * px), -veh.s.anchorX * w, -h * 0.82, w, h);
        ctx.restore();
        continue;
      }
      const prefix = UNIT_PREFIX[c.type] ?? 'vil';
      const frames = sp.anims[`${prefix}_death`];
      const k = sp.unitScale[c.type] ?? sp.villagerScale;
      if (frames) {
        const idx = Math.min(frames.length - 1, Math.floor((c.t / 1.1) * frames.length));
        const key = frames[idx];
        const s = c.owner === ENEMY ? sp.recolored(key) : sp.sprites[key];
        const w = s.levels[0].width * k, h = s.levels[0].height * k, flip = c.facing < 0;
        ctx.globalAlpha = fade;
        this._blit(ctx, s, wx - (flip ? 1 - s.anchorX : s.anchorX) * w, wy - h + 1.5, w, h, flip, px);
        ctx.globalAlpha = 1;
        continue;
      }
      const s = sp.unit(c.type, 'idle', c.owner);
      const w = s.levels[0].width * k, h = s.levels[0].height * k;
      const fall = Math.min(1, c.t / 0.35);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(wx, wy);
      ctx.rotate(-fall * 1.35 * c.facing); // yüzünün tersine doğru devrilir
      if (c.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(s.pick(w * px), -s.anchorX * w, -h + 1.5, w, h);
      ctx.restore();
    }
  }

  /**
   * Oklar: yerdeki konum başlangıçtan hedefe doğrusal ilerler, yükseklik ise sin(π·p) ile kavis çizer.
   * Ok gövdesinin yönü, yörüngenin bir sonraki noktasına göre hesaplanır.
   */
  /** Mancınık isabetleri (toz bulutu) ve avlanan hayvanların et yığınları */
  _drawImpactsAndMeat(ctx) {
    const w = this.world, fx = this.fx, fog = w.fog;
    for (const im of w.impacts ?? []) {
      const age = w.time - im.t;
      if (age > 1.2) continue;
      const x = (im.x - im.y) * HW, y = (im.x + im.y) * HH, r = 14 + age * 40;
      ctx.globalAlpha = (1 - age / 1.2) * 0.7;
      ctx.drawImage(fx.smoke, x - r, y - r * 0.6, r * 2, r * 1.2);
    }
    ctx.globalAlpha = 1;
    const v = this._viewRect(40);
    for (const o of w.meat ?? []) {
      if (!w.isAlive(o) || (fog && !fog.isExplored(o.i, o.j))) continue;
      const x = (o.i - o.j) * HW, y = (o.i + o.j) * HH;
      if (x < v.l || x > v.r || y < v.t || y > v.b) continue;
      const k = 0.6 + 0.4 * (o.amount / o.maxAmount);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 12 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7b2f22'; ctx.beginPath(); ctx.ellipse(x, y - 2, 10 * k, 5 * k, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b5523c'; ctx.beginPath(); ctx.ellipse(x - 2, y - 4, 6 * k, 3 * k, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#efe3cf'; ctx.fillRect(x + 4 * k, y - 6 * k, 6 * k, 1.6);
    }
  }

  _drawProjectiles(ctx) {
    const list = this.world.projectiles;
    if (!list.length) return;
    const pos = (pr, p) => {
      const gx = pr.sx + (pr.tx - pr.sx) * p, gy = pr.sy + (pr.ty - pr.sy) * p;
      const z = pr.sz * (1 - p) + 12 * p + Math.sin(Math.PI * p) * Math.min(70, pr.d * 7);
      return [(gx - gy) * HW, (gx + gy) * HH - z];
    };
    ctx.lineCap = 'round';
    for (const pr of list) {
      const p = Math.min(1, pr.p);
      const [x, y] = pos(pr, p);
      if (pr.stone) { // mancınık taşı: gölgeli gri yuvarlak kaya
        ctx.fillStyle = '#4d4a45'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 2, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      const [x2, y2] = pos(pr, Math.min(1, p + 0.04));
      let dx = x2 - x, dy = y2 - y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const z = this.camera.zoom, lw = Math.max(1.6, 1.3 / z); // uzak zoom'da da seçilebilsin
      ctx.lineWidth = lw + 1.2;
      ctx.strokeStyle = 'rgba(255,240,210,0.35)';              // ince açık hale: koyu zeminde görünürlük
      ctx.beginPath(); ctx.moveTo(x - dx * 10, y - dy * 10); ctx.lineTo(x + dx * 7, y + dy * 7); ctx.stroke();
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#3b2a18';
      ctx.beginPath(); ctx.moveTo(x - dx * 10, y - dy * 10); ctx.lineTo(x + dx * 6, y + dy * 6); ctx.stroke();
      ctx.strokeStyle = '#e8e8e8';
      ctx.beginPath(); ctx.moveTo(x + dx * 4, y + dy * 4); ctx.lineTo(x + dx * 8, y + dy * 8); ctx.stroke();
    }
  }

  /**
   * YANGIN: hasar alan (tamamlanmış) binada alevler ve yükselen duman.
   * Alev noktaları binanın kendi sprite'ının alfa maskesinden seçilir (yalnızca çatı/duvar gibi dolu pikseller),
   * bu yüzden her bina boyutuna ve biçimine uyar. Alev boyu sprite genişliğiyle ölçeklenir.
   * Can düştükçe yanan nokta sayısı 1 → 7'ye çıkar. Alev ve duman önceden çizilmiş küçük dokulardır (her karede
   * gradyan oluşturulmaz). Geceleri her alev bir ışık kaynağıdır.
   */
  _firePoints(b, L) {
    if (b._fire?.s === L.s) return b._fire.pts;
    const pts = [];
    for (let k = 0; pts.length < 7 && k < 400; k++) {
      const u = 0.14 + 0.72 * hash3(b.id, k, 11), v = 0.12 + 0.6 * hash3(k, b.id, 12);
      // Nokta ve hemen üstü dolu olmalı (alev boşlukta asılı kalmasın), noktalar birbirinden uzak olmalı
      if (!L.s.hit(u, v) || !L.s.hit(u, v - 0.06)) continue;
      if (pts.some((p) => Math.hypot(p.u - u, (p.v - v) * L.h / L.w) < 0.14)) continue;
      pts.push({ u, v, k: 0.75 + 0.5 * hash3(b.id, k, 13), ph: hash3(k, b.id, 14) * 10 });
    }
    // Önce üstteki (çatı) noktalar tutuşur
    pts.sort((a, c) => a.v - c.v);
    b._fire = { s: L.s, pts };
    return pts;
  }

  _drawFire(ctx, b, L, time) {
    const frac = b.hp / b.maxHp;
    if (!L || !b.complete || frac >= 0.92 || b.def.light) return; // ateş çukuru zaten ateş
    const pts = this._firePoints(b, L);
    const n = Math.min(pts.length, 1 + Math.floor(((0.92 - frac) / 0.92) * 7));
    const fx = this.fx, base = L.w * 0.085;
    // 1) Duman (alevlerin arkasında yükselir, rüzgârla sağa kayar, büyüyüp söner)
    for (let k = 0; k < n; k++) {
      const p = pts[k], x = L.x + L.w * p.u, y = L.y + L.h * p.v, r = base * p.k;
      for (let q = 0; q < 5; q++) {
        const ph = (time * 0.32 + p.ph + q / 5) % 1;
        const sz = r * (0.9 + ph * 3.2);
        ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, ph * 1.4)) * 0.85 * (1 - ph * 0.45);
        ctx.drawImage(fx.smoke, x + ph * ph * r * 3.5 + Math.sin(ph * 5 + p.ph) * r * 0.4 - sz / 2, y - r * 1.4 - ph * L.h * 0.75 - sz / 2, sz, sz);
      }
    }
    // 2) Alevler: iki katman, titreşen boy ve rüzgârda salınım; 'lighter' ile parlayan çekirdek
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < n; k++) {
      const p = pts[k], x = L.x + L.w * p.u, y = L.y + L.h * p.v, r = base * p.k;
      const fl = candle(time, p.ph * 7 + b.id); // yavaş, rastgele (mum alevi gibi)
      ctx.globalAlpha = 0.5;
      ctx.drawImage(fx.glow, x - r * 2.2, y - r * 2.2, r * 4.4, r * 3.6);
      for (let q = 0; q < 2; q++) {
        const h = r * 3.1 * fl * (q ? 0.7 : 1), w = r * 1.15 * (q ? 0.8 : 1);
        const sway = (cnoise(time * 1.1 + p.ph + q * 2.3) - 0.5) * r * 0.5;
        ctx.globalAlpha = q ? 1 : 0.85;
        ctx.save();
        ctx.translate(x + (q ? r * 0.35 : 0), y + r * 0.35);
        ctx.transform(1, 0, sway / h, 1, 0, 0); // tepe rüzgârda salınır
        ctx.drawImage(fx.flame, -w / 2, -h, w, h);
        ctx.restore();
      }
      this._lights.push({ x, y: y - r, r: r * 9, warm: true, flicker: fl });
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  _drawBuildingOverlays(ctx, frame) {
    const zoom = this.camera.zoom, v = this._viewRect(60);
    for (const b of this.world.buildings) {
      const sel = frame.selected.has(b);
      const damaged = b.hp < b.maxHp && b.complete;
      if (!sel && b.complete && !damaged) continue;
      const P = footprintCorners(b.originI, b.originJ, b.size);
      if (P[1][0] < v.l || P[3][0] > v.r || P[2][1] < v.t - 200 || P[0][1] > v.b) continue;
      if (b.owner !== PLAYER && this.world.fog && !this.world.fog.seesObject(b)) continue;
      if (sel) {
        ctx.beginPath();
        ctx.moveTo(P[0][0], P[0][1]);
        for (let k = 1; k < 4; k++) ctx.lineTo(P[k][0], P[k][1]);
        ctx.closePath();
        ctx.lineWidth = 2 / zoom;
        ctx.strokeStyle = b.owner !== PLAYER ? 'rgba(255,100,90,0.9)' : 'rgba(255,255,255,0.85)';
        ctx.setLineDash([8 / zoom, 5 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const L = b.type === 'farm' ? null : this.layout(b);
      if (damaged) this._drawFire(ctx, b, L, frame.time);
      const topY = L ? L.y - 8 / zoom : P[0][1] - 10 / zoom;
      const cx = (P[0][0] + P[2][0]) / 2;
      const bw = Math.min(90, 26 + b.size * 14) / Math.max(zoom, 0.6);
      const hpColor = b.owner === ENEMY ? '#e8483c' : '#4cd964';
      if (!b.complete) this._bar(ctx, cx, topY, bw, b.progress, '#f5c542');
      else if (sel || damaged) {
        this._bar(ctx, cx, topY, bw, b.hp / b.maxHp, hpColor);
        const q = b.queue[0];
        if (q) this._bar(ctx, cx, topY + 8 / zoom, bw, 1 - q.remaining / q.total, '#5ac8fa');
      }
      if (sel && b.rally) this._drawRally(ctx, b);
    }
  }

  _drawRally(ctx, b) {
    let gi, gj;
    if (b.rally.target) { gi = b.rally.target.centerI ?? b.rally.target.i; gj = b.rally.target.centerJ ?? b.rally.target.j; }
    else { gi = b.rally.i; gj = b.rally.j; }
    const x = (gi - gj) * HW, y = (gi + gj) * HH;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3b2a1a';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 22); ctx.stroke();
    ctx.fillStyle = '#2f6fd6';
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x + 12, y - 18); ctx.lineTo(x, y - 14); ctx.closePath(); ctx.fill();
  }

  _drawPlacement(ctx, frame) {
    const p = frame.placement;
    if (!p || p.oi === undefined) return;
    if (p.line) {
      // Çit: sürüklenen hat boyunca her karo (geçerli yeşil, geçersiz kırmızı) + saydam görsel
      for (const t of p.line) {
        const P = footprintCorners(t.i, t.j, 1);
        ctx.beginPath();
        ctx.moveTo(P[0][0], P[0][1]);
        for (let k = 1; k < 4; k++) ctx.lineTo(P[k][0], P[k][1]);
        ctx.closePath();
        ctx.fillStyle = t.ok ? 'rgba(80,220,100,0.3)' : 'rgba(230,60,50,0.35)';
        ctx.fill();
        if (t.ok) {
          const L = this.layout({ isBuilding: true, type: p.type, size: 1, i: t.i, j: t.j, offX: 0, offY: 0 });
          ctx.globalAlpha = 0.55;
          this._blit(ctx, L.s, L.x, L.y, L.w, L.h, false, this.camera.zoom * this.dpr);
          ctx.globalAlpha = 1;
        }
      }
      return;
    }
    const def = BUILDINGS[p.type];
    const P = footprintCorners(p.oi, p.oj, def.size);
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let k = 1; k < 4; k++) ctx.lineTo(P[k][0], P[k][1]);
    ctx.closePath();
    ctx.fillStyle = p.valid ? 'rgba(80,220,100,0.28)' : 'rgba(230,60,50,0.35)';
    ctx.fill();
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.strokeStyle = p.valid ? 'rgba(120,255,140,0.9)' : 'rgba(255,90,80,0.9)';
    ctx.stroke();
    if (p.type !== 'farm') {
      const fake = { isBuilding: true, type: p.type, size: def.size, i: p.oi + def.size - 1, j: p.oj + def.size - 1, offX: 0, offY: 0 };
      const L = this.layout(fake);
      ctx.globalAlpha = 0.6;
      this._blit(ctx, L.s, L.x, L.y, L.w, L.h, false, this.camera.zoom * this.dpr);
      ctx.globalAlpha = 1;
    }
  }

  _drawCmdMarker(ctx, frame) {
    const m = frame.cmdMarker;
    if (!m) return;
    const age = frame.time - m.t;
    if (age > 0.6) return;
    const r = 14 * (1 - age / 0.6) + 4;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.lineWidth = 2 / this.camera.zoom;
    ctx.strokeStyle = m.color ?? 'rgba(120,255,120,0.9)';
    ctx.stroke();
  }

  _drawSelectionBox(ctx, frame) {
    const b = frame.box;
    if (!b) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  /** Ekranda sabit boyutlu durum çubuğu (dünya koordinatında, zoom'a bölünerek) */
  _bar(ctx, cx, y, w, frac, color) {
    const z = this.camera.zoom, h = 4 / Math.max(z, 0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - w / 2 - 1 / z, y - 1 / z, w + 2 / z, h + 2 / z);
    ctx.fillStyle = '#7a1c1c';
    ctx.fillRect(cx - w / 2, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(cx - w / 2, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  // ═════════════════════ YARDIMCILAR ═════════════════════
  _applyCamera(ctx) {
    // ekran = (dünya − kamera) · zoom · dpr  → tek affine matris
    const s = this.camera.zoom * this.dpr;
    ctx.setTransform(s, 0, 0, s, -this.camera.x * s, -this.camera.y * s);
  }

  _viewRect(pad) {
    const c = this.camera;
    return { l: c.x - pad, t: c.y - pad, r: c.x + c.viewW / c.zoom + pad, b: c.y + c.viewH / c.zoom + pad };
  }

  /**
   * Görünür dünya dikdörtgenini her satır (j) için [i0, i1] aralığına çevirir.
   *   L ≤ (i − j)·HW ≤ R   ve   T ≤ (i + j)·HH ≤ B
   */
  _computeSpans(spans, pad, rect) {
    const map = this.map;
    const L = rect.l - HW - pad.x, R = rect.r + HW + pad.x;
    const T = rect.t - HH - pad.top, B = rect.b + HH + pad.bottom;
    spans.jMin = Math.max(0, Math.floor((T / HH - R / HW) / 2));
    spans.jMax = Math.min(map.height - 1, Math.ceil((B / HH - L / HW) / 2));
    for (let j = spans.jMin; j <= spans.jMax; j++) {
      spans.i0[j] = Math.max(0, Math.ceil(Math.max(j + L / HW, T / HH - j)));
      spans.i1[j] = Math.min(map.width - 1, Math.floor(Math.min(j + R / HW, B / HH - j)));
    }
    return spans;
  }
}
