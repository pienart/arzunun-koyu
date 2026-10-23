import { CONFIG } from '../config.js';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * Camera: dünya ↔ ekran dönüşümünün tek sahibi.
 *   (x, y) = ekranın SOL-ÜST köşesine denk gelen dünya koordinatı
 *   zoom   = 1 dünya biriminin kaç CSS pikseline karşılık geldiği
 *
 *   ekran = (dünya − kamera) · zoom          dünya = ekran / zoom + kamera
 */
export class Camera {
  constructor(bounds) {
    this.bounds = bounds; // { minX, minY, maxX, maxY } (dünya birimi)
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.viewW = 1;
    this.viewH = 1;
    this.vx = 0; // atalet hızı (ekran px/sn)
    this.vy = 0;
    this.dragging = false;
    this._anchor = { x: 0, y: 0 };
    this.version = 0; // her görünüm değişiminde artar → Renderer statik katmanı buna bakarak yeniler
    this._last = { x: NaN, y: NaN, zoom: NaN, w: NaN, h: NaN };
  }

  setViewport(w, h) {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.clamp();
  }

  screenToWorld(sx, sy) { return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y }; }
  worldToScreen(wx, wy) { return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom }; }

  centerOn(wx, wy) {
    this.x = wx - this.viewW / (2 * this.zoom);
    this.y = wy - this.viewH / (2 * this.zoom);
    this.vx = this.vy = 0;
    this.clamp();
  }

  // ───────────── PAN ─────────────
  panBy(dsx, dsy) {
    // Ekran deltası zoom'a bölünerek dünya birimine çevrilir:
    // 2x zoom'da fareyi 100 px sürüklemek dünyada 50 birim demektir → harita imlece "yapışık" kalır.
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
    this.clamp();
  }

  beginDrag() { this.dragging = true; this.vx = this.vy = 0; this.intro = null; }

  /**
   * Açılış yaklaşması: (wx, wy) dünya noktası ekranın ortasında kalırken zoom `from` → `to`
   * (yavaş başlayıp yavaş biten eğri). Kullanıcı sürükler veya tekerleği çevirirse hemen bırakılır.
   */
  introZoom(wx, wy, from, to, duration, delay = 0) {
    this.zoom = this.targetZoom = from;
    this.centerOn(wx, wy);
    this.intro = { wx, wy, from, to, duration, t: -delay };
  }
  endDrag() { this.dragging = false; }

  /** Sürükleme bırakıldığında son hızla "fırlatma" (inertia). */
  /**
   * Yumuşak uçuş: ekran merkezi (wx, wy)'ye ve `zoom`a `duration` sn'de, ease-in-out ile. Konum doğrusal,
   * zoom logaritmik ara değerlenir (O: köye dön · E: tüm haritayı göster).
   */
  flyTo(wx, wy, zoom, duration = 1.1) {
    const cx = this.x + this.viewW / (2 * this.zoom), cy = this.y + this.viewH / (2 * this.zoom);
    this.vx = this.vy = 0;
    this.intro = null;
    this.fly = { fx: cx, fy: cy, tx: wx, ty: wy, fz: this.zoom, tz: zoom, t: 0, duration };
  }

  /**
   * En uzak zoom: haritanın tamamının ekrana sığdığı ölçek (bundan uzağa gidilmez; harita dışı boşluk görünmez).
   * Ekran haritadan büyükse yine de CONFIG.ZOOM_MIN'den uzaklaşılmaz.
   */
  get minZoom() { return Math.min(CONFIG.ZOOM_MIN, this.fitZoom(1)); }

  /** Kıstırma (dokunmatik): imleç/parmak ortası sabit kalarak anında ölçekle */
  zoomInstant(sx, sy, factor) {
    this.intro = null; this.fly = null;
    const z = clamp(this.zoom * factor, this.minZoom, CONFIG.ZOOM_MAX);
    this.targetZoom = z;
    this._zoomAround(z, sx, sy);
  }

  /** Tüm haritanın ekrana sığdığı zoom */
  fitZoom(margin = 0.94) {
    const b = this.bounds;
    return Math.min(this.viewW / (b.maxX - b.minX), this.viewH / (b.maxY - b.minY)) * margin;
  }

  fling(vx, vy) {
    const MAX = 3500;
    this.vx = clamp(vx, -MAX, MAX);
    this.vy = clamp(vy, -MAX, MAX);
  }

  // ───────────── ZOOM ─────────────
  zoomAt(sx, sy, factor) {
    if (this.intro || this.fly) { this.targetZoom = this.zoom; this.intro = null; this.fly = null; }
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, CONFIG.ZOOM_MAX);
    this._anchor.x = sx;
    this._anchor.y = sy;
  }

  _zoomAround(newZoom, sx, sy) {
    // ZOOM-TO-MOUSE: imlecin altındaki dünya noktası (wx, wy), zoom'dan sonra da AYNI ekran pikselinde kalmalı.
    //   Önce:   wx = sx / z0 + x0
    //   Sonra:  sx = (wx − x1) · z1    ⇒    x1 = wx − sx / z1
    const wx = sx / this.zoom + this.x;
    const wy = sy / this.zoom + this.y;
    this.zoom = newZoom;
    this.x = wx - sx / newZoom;
    this.y = wy - sy / newZoom;
    this.clamp();
  }

  update(dt) {
    // --- Açılış yaklaşması ---
    const it = this.intro;
    if (it) {
      it.t += dt;
      const p = Math.min(1, Math.max(0, it.t / it.duration));
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2; // ease-in-out (kübik)
      // Logaritmik ölçekte ara değer: yaklaşma hızı göze sabit görünür
      this.zoom = this.targetZoom = Math.exp(Math.log(it.from) + (Math.log(it.to) - Math.log(it.from)) * e);
      this.centerOn(it.wx, it.wy);
      if (p >= 1) this.intro = null;
    }

    // --- Yumuşak uçuş (flyTo) ---
    const f = this.fly;
    if (f) {
      f.t += dt;
      const p = Math.min(1, f.t / f.duration);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      this.zoom = this.targetZoom = Math.exp(Math.log(f.fz) + (Math.log(f.tz) - Math.log(f.fz)) * e);
      this.x = f.fx + (f.tx - f.fx) * e - this.viewW / (2 * this.zoom);
      this.y = f.fy + (f.ty - f.fy) * e - this.viewH / (2 * this.zoom);
      this.clamp();
      if (p >= 1) this.fly = null;
    }

    // --- Yumuşak zoom ---
    if (this.zoom !== this.targetZoom) {
      // Kare hızından bağımsız üstel yaklaşım: t = 1 − e^(−k·dt)
      // (60 FPS'te de 144 FPS'te de hedefe aynı sürede yaklaşır)
      const t = 1 - Math.exp(-CONFIG.ZOOM_SMOOTHING * dt);
      // Logaritmik uzayda interpolasyon: 0.5→1 ile 1→2 geçişi göze aynı hızda görünür
      const lz = Math.log(this.zoom);
      let z = Math.exp(lz + (Math.log(this.targetZoom) - lz) * t);
      if (Math.abs(z / this.targetZoom - 1) < 1e-3) z = this.targetZoom;
      this._zoomAround(z, this._anchor.x, this._anchor.y);
    }

    // --- Atalet (sürükleme bırakıldıktan sonra kayma) ---
    if (!this.dragging && (this.vx || this.vy)) {
      this.panBy(this.vx * dt, this.vy * dt);
      // Üstel sönüm: v(t) = v0 · e^(−f·t) → kare hızından bağımsız, doğal yavaşlama
      const decay = Math.exp(-CONFIG.PAN_FRICTION * dt);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) < 8) this.vx = this.vy = 0;
    }

    // --- Değişim tespiti: Renderer statik katmanı yalnızca version değişince yeniden çizer ---
    const l = this._last;
    if (l.x !== this.x || l.y !== this.y || l.zoom !== this.zoom || l.w !== this.viewW || l.h !== this.viewH) {
      l.x = this.x; l.y = this.y; l.zoom = this.zoom; l.w = this.viewW; l.h = this.viewH;
      this.version++;
    }
  }

  /** Kamerayı harita sınırlarında durdurur (clamp). */
  clamp() {
    const b = this.bounds;
    const visW = this.viewW / this.zoom, visH = this.viewH / this.zoom; // görünür alan (dünya birimi)
    const worldW = b.maxX - b.minX, worldH = b.maxY - b.minY;
    // Görünür alan dünyadan genişse haritayı ortala; değilse kamerayı [min, max − görünür] aralığına kilitle.
    const nx = visW >= worldW ? b.minX - (visW - worldW) / 2 : clamp(this.x, b.minX, b.maxX - visW);
    const ny = visH >= worldH ? b.minY - (visH - worldH) / 2 : clamp(this.y, b.minY, b.maxY - visH);
    if (nx !== this.x) this.vx = 0; // sınıra çarpan eksende ataleti sıfırla
    if (ny !== this.y) this.vy = 0;
    this.x = nx;
    this.y = ny;
  }
}
