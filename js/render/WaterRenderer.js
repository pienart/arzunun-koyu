import { HW, HH } from './iso.js';
import { Settings } from '../systems/Settings.js';

const makeCanvas = () => document.createElement('canvas');

/**
 * Genel bakış görüntüsünden dünya dikdörtgenine düşen parça: kaynak pikselleri (sx..) ve hedef dünya dikdörtgeni (x..).
 * px = görüntü pikseli / dünya birimi. Kenarlarda 2 piksel pay (yumuşatma dikişi olmasın).
 */
export function ovCrop(ov, rect, px) {
  const l = Math.max(ov.x, rect.l - 2 / px), t = Math.max(ov.y, rect.t - 2 / px);
  const r = Math.min(ov.x + ov.ww, rect.r + 2 / px), b = Math.min(ov.y + ov.wh, rect.b + 2 / px);
  if (r <= l || b <= t) return null;
  return { sx: (l - ov.x) * px, sy: (t - ov.y) * px, sw: (r - l) * px, sh: (b - t) * px, x: l, y: t, w: r - l, h: b - t };
}


/**
 * WaterRenderer — MASKE TABANLI DİNAMİK SU
 *
 * Neden maske? Su artık karo karo değil; organik kıyı çizgisi (komşu karaya taşan elipsler) ile
 * tek bir Path2D olarak çizilir. Bu şeklin üzerinde her karede animasyonlu doku kaydırmak için
 * suyun ekrandaki şeklini bir kez "maske" tuvaline basıyor, her karede animasyonu ayrı bir
 * tuvale çizip 'destination-in' ile maskeye kırpıyoruz. Böylece:
 *   • kıyı çizgisi geometrisi yalnızca kamera/harita değişince hesaplanır (statik),
 *   • her kare yalnızca birkaç tam ekran GPU işlemi + parıltılar kalır (dinamik).
 *
 * Statik (buildStatic, Renderer zemin katmanını yeniden çizerken):
 *   1) ıslak kum bandı (suyun etrafında yumuşak koyu hâle)
 *   2) su tabanı (doku) + derinlik gölgelendirmesi (bulanık katmanlar)
 *   3) maske + köpük hâlesi (maskenin yalnızca DIŞ kenarı)
 * Dinamik (render, her kare):
 *   4) sin/cos ile salınarak kayan iki doku katmanı + dalga tepesi parıltıları → maske ile kırp
 *   5) köpük katmanı sin(t) ile "nefes alan" opaklıkla (dalgalar kıyıya vurup çekiliyor)
 */
export class WaterRenderer {
  constructor(map, sprites) {
    this.map = map;
    this.sprites = sprites;
    this.mask = makeCanvas();
    this.maskCtx = this.mask.getContext('2d');
    this.foam = makeCanvas();
    this.foamCtx = this.foam.getContext('2d');
    this.scratch = makeCanvas();
    this.scratchCtx = this.scratch.getContext('2d');
    // Arka tampon (Renderer'ın şeritli keskin çizimi için): swapBuffers ile ön tamponla yer değiştirir
    this.maskB = makeCanvas();
    this.maskCtxB = this.maskB.getContext('2d');
    this.foamB = makeCanvas();
    this.foamCtxB = this.foamB.getContext('2d');
    this.sparklesB = [];
    this.sparkles = [];   // görünür derin su karoları: [cx, cy, i, j]
    this._patterns = new Map();
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    // Animasyon katmanları YARIM çözünürlükte bileştirilir: su dokusu zaten yumuşak, büyütme farkı görünmez,
    // ama tam ekran tuval işlemlerinin maliyeti ~4 kat düşer.
    this.k = Settings.q.water; // kalite: düşükte su animasyonu daha düşük çözünürlükte
    this.fullW = 1;
    this.fullH = 1;
    this.cam = { s: 1, e: 0, f: 0 };
  }

  /** mask/foam önbellek boyutunda (ekran + 2M taşma payı), scratch ekran boyutunda; hepsi yarım çözünürlük */
  resize(w, h, M) {
    this.fullW = w;
    this.fullH = h;
    const k = this.k;
    for (const c of [this.mask, this.foam, this.maskB, this.foamB]) { c.width = Math.ceil((w + 2 * M) * k); c.height = Math.ceil((h + 2 * M) * k); }
    this.scratch.width = Math.ceil(w * k);
    this.scratch.height = Math.ceil(h * k);
    this._patterns.clear(); // tuval boyutu değişince bağlam durumu sıfırlanır
  }

  swapBuffers() {
    [this.mask, this.maskB] = [this.maskB, this.mask];
    [this.maskCtx, this.maskCtxB] = [this.maskCtxB, this.maskCtx];
    [this.foam, this.foamB] = [this.foamB, this.foam];
    [this.foamCtx, this.foamCtxB] = [this.foamCtxB, this.foamCtx];
    [this.sparkles, this.sparklesB] = [this.sparklesB, this.sparkles];
  }

  /** Yarım çözünürlüklü tuvallere kamera dönüşümü: piksel = (dünya·s + e) · k */
  _applyCam(ctx, cam) {
    const { s, e, f } = cam, k = this.k;
    ctx.setTransform(s * k, 0, 0, s * k, e * k, f * k);
  }

  /** Su dokusu deseni: kare dokuyu izometrik zemine yatırır; (du, dv) doku pikseli cinsinden kaydırma */
  _pattern(ctx, slot, tilesPerTexture, du, dv) {
    const key = slot;
    let p = this._patterns.get(key);
    const src = this.sprites.textures.water.full;
    if (!p || p._ctx !== ctx) {
      p = ctx.createPattern(src, 'repeat');
      p._ctx = ctx;
      this._patterns.set(key, p);
    }
    const S = src.width / tilesPerTexture;
    // doku (u, v) → dünya:  x = (u − v)·HW/S ,  y = (u + v)·HH/S ; kaydırma da aynı dönüşümden geçer
    p.setTransform(new DOMMatrix([HW / S, HH / S, -HW / S, HH / S, ((du - dv) * HW) / S, ((du + dv) * HH) / S]));
    return p;
  }

  /**
   * @param g          zemin katmanı bağlamı (kamera dönüşümü uygulanmış)
   * @param paths      { water, deep, deeper } dünya koordinatında Path2D'ler
   * @param cam        { s, e, f } statik önbellek matrisi (s = zoom × dpr)
   * @param px         zoom × dpr (gölge bulanıklığı cihaz pikseli cinsindendir, dünya ölçeğine çevirmek için)
   */
  buildStatic(g, paths, cam, px, sparkles, band = null) {
    const { water, deep, deeper } = paths;
    this.sparkles = sparkles;
    const k = this.k;

    // 1) Islak kum: dolgu + gölge; gölgenin dışarı taşan kısmı kıyıda koyu, yumuşak bir bant bırakır
    g.save();
    g.shadowColor = 'rgba(40,30,14,0.85)';
    g.shadowBlur = 22 * px;
    g.fillStyle = '#1f6378';
    g.fill(water);
    g.restore();

    // 2) Su tabanı (statik doku)
    g.fillStyle = this._pattern(g, 'base', 5, 0, 0);
    g.fill(water);

    // Derinlik: "uzak gölge" tekniği → şekli ekran dışına öteleyip yalnızca bulanık gölgesini
    // asıl konuma düşürüyoruz. Sonuç: sığdan derine kenarları tamamen yumuşak renk geçişi.
    const OFF = 20000; // dünya birimi
    const softFill = (path, color, blur) => {
      g.save();
      g.translate(-OFF, 0);
      g.shadowOffsetX = OFF * px;
      g.shadowColor = color;
      g.shadowBlur = blur * px;
      g.fillStyle = '#000';
      g.fill(path);
      g.restore();
    };
    softFill(deep, 'rgba(2,30,62,0.42)', 26);
    softFill(deeper, 'rgba(1,18,44,0.38)', 30);

    // 3) Maske: suyun ekrandaki tam şekli. Şerit modunda köpük bulanıklığı için şerit biraz geniş çizilir.
    const m = this.maskCtx;
    m.save();
    m.setTransform(1, 0, 0, 1, 0, 0);
    if (!band) m.clearRect(0, 0, this.mask.width, this.mask.height);
    this._applyCam(m, cam);
    if (band) {
      const t = band.t - 24, h = band.b - band.t + 48;
      m.beginPath(); m.rect(band.l, t, band.r - band.l, h); m.clip();
      m.clearRect(band.l, t, band.r - band.l, h);
    }
    m.fillStyle = '#fff';
    m.fill(water);
    m.restore();

    // Köpük: maskeyi beyaz gölgeyle çiz, sonra maskenin kendisini sil → yalnızca DIŞ hâle kalır
    const f = this.foamCtx;
    f.save();
    if (band) { this._applyCam(f, cam); f.beginPath(); f.rect(band.l, band.t, band.r - band.l, band.b - band.t); f.clip(); }
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.foam.width, this.foam.height);
    f.shadowColor = 'rgba(255,255,255,1)';
    f.shadowBlur = 7 * px * k;
    f.drawImage(this.mask, 0, 0);
    f.drawImage(this.mask, 0, 0); // iki geçiş → daha yoğun, belirgin köpük
    f.shadowBlur = 0;
    f.shadowColor = 'transparent';
    f.globalCompositeOperation = 'destination-out';
    f.drawImage(this.mask, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.restore();
  }

  /**
   * Uzak zoom: maske ve köpük, açılışta tüm harita için hazırlanmış genel bakış görüntüsünden kopyalanır
   * (yol hesaplama ve bulanıklık yok). Genel bakışın dışı açık okyanustur → maske orada tamamen doludur.
   */
  buildFromOverview(ov, cam, sparkles, rect) {
    this.sparkles = sparkles;
    const m = this.maskCtx, f = this.foamCtx;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.fillStyle = '#fff';
    m.fillRect(0, 0, this.mask.width, this.mask.height);
    this._applyCam(m, cam);
    m.clearRect(ov.x, ov.y, ov.ww, ov.wh);
    m.imageSmoothingEnabled = true;
    const c = ovCrop(ov, rect, ov.mask.width / ov.ww); // yalnızca görünen parça
    if (c) m.drawImage(ov.mask, c.sx, c.sy, c.sw, c.sh, c.x, c.y, c.w, c.h);
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, this.foam.width, this.foam.height);
    this._applyCam(f, cam);
    f.imageSmoothingEnabled = true;
    if (c) f.drawImage(ov.foam, c.sx, c.sy, c.sw, c.sh, c.x, c.y, c.w, c.h);
  }

  /**
   * @param cam  { s, e, f } GÜNCEL kamera matrisi (animasyon her zaman keskin, güncel konumda çizilir)
   * @param blit { r, ox, oy } önbellek → ekran eşlemesi (maske/köpük önbellekten kaydırılıp ölçeklenir)
   * @param vr   görünür dünya dikdörtgeni
   */
  render(ctx, time, cam, blit, vr) {
    const sc = this.scratchCtx, t = time, k = this.k;
    const v = { x: vr.l, y: vr.t, w: vr.r - vr.l, h: vr.b - vr.t };
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.clearRect(0, 0, this.scratch.width, this.scratch.height);
    this._applyCam(sc, cam);

    // 4a) Kayan doku katmanları. Sürüklenme (t·hız) + sin/cos salınımı → akıntı ve dalgalanma hissi.
    //     İki katman farklı ölçek/yönde: girişim (interference) deseni, tekrar eden doku belli olmaz.
    sc.globalAlpha = 0.55;
    sc.fillStyle = this._pattern(sc, 'l1', 5, t * 9 + Math.sin(t * 0.6) * 14, t * 4 + Math.cos(t * 0.45) * 10);
    sc.fillRect(v.x, v.y, v.w, v.h);
    sc.globalAlpha = 0.35;
    sc.fillStyle = this._pattern(sc, 'l2', 8.5, -t * 6 + Math.sin(t * 0.37) * 20, t * 7 + Math.cos(t * 0.29) * 16);
    sc.fillRect(v.x, v.y, v.w, v.h);

    // 4b) Dalga tepesi parıltıları: iki sinüs dalgasının süperpozisyonu  w = Σ A·sin(k·r − ω·t)
    //     Yalnızca tepe bölgesinde (w > 0.72) kısa beyaz çizgi; boyu (w − 0.72) ile orantılı → yumuşak belirip kaybolur
    sc.globalAlpha = 1;
    const crest = new Path2D();
    for (const [cx, cy, i, j] of this.sparkles) {
      if (cx < vr.l || cx > vr.r || cy < vr.t || cy > vr.b) continue; // taşma payındakiler ekranda değil
      const w = 0.6 * Math.sin(i * 0.55 + j * 0.3 - t * 1.7) + 0.4 * Math.sin(-i * 0.25 + j * 0.65 - t * 1.1 + 1.7);
      if (w < 0.72) continue;
      const len = (w - 0.72) * 3.6 * HW * 0.35;
      const ox = Math.sin(t * 0.9 + i * 1.3 + j * 0.7) * HW * 0.3;
      const oy = Math.cos(t * 0.7 + i * 0.4 + j * 1.1) * HH * 0.3;
      crest.moveTo(cx + ox - len, cy + oy - len * 0.5); // eğim 1:2 → izometrik eksene paralel
      crest.lineTo(cx + ox + len, cy + oy + len * 0.5);
    }
    sc.lineCap = 'round';
    sc.lineWidth = 1.3;
    sc.strokeStyle = 'rgba(235,250,255,0.5)';
    sc.stroke(crest);

    // Maskeye kırp: yalnızca su alanı kalsın
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(this.mask, blit.ox * k, blit.oy * k, this.mask.width * blit.r, this.mask.height * blit.r);
    sc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.scratch, 0, 0, this.fullW, this.fullH); // yarım çözünürlük → tam ekran (yumuşak büyütme)
    // 5) Köpük: dalganın kıyıya vurup çekilmesi → opaklık iki farklı frekanslı sinüsle "nefes alır"
    ctx.globalAlpha = Math.min(1, 0.7 + 0.22 * Math.sin(t * 1.6) + 0.08 * Math.sin(t * 3.7));
    ctx.drawImage(this.foam, blit.ox, blit.oy, (this.foam.width / k) * blit.r, (this.foam.height / k) * blit.r);
    ctx.restore();
  }
}
