/**
 * GECE / GÜNDÜZ
 * Saat, oyunu sunan sunucunun saatinden alınır: HTTP yanıtındaki `Date` başlığı ile tarayıcı saati arasındaki
 * fark bir kez ölçülür (başlık yoksa tarayıcı saati kullanılır). Saat dilimi oyuncunun yerel saatidir.
 *
 *   16:00 → 17:15  alacakaranlık (kararma)        06:15 → 07:30  şafak (aydınlanma)
 *   17:15 → 06:15  gece: dolunay, kamp ateşi, evlerde ışık
 *
 * Mod: 'auto' (saate göre) · 'night' · 'day'. Üst bardaki düğme veya L tuşu ile değişir; tercih hatırlanır.
 */
const DUSK_START = 16, DUSK_END = 17.25, DAWN_START = 6.25, DAWN_END = 7.5;
const MODES = ['auto', 'night', 'day'];

const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } };

const smooth = (x) => x * x * (3 - 2 * x);

export class DayNight {
  constructor() {
    this.skew = 0;              // sunucu saati − tarayıcı saati (ms)
    this.serverSynced = false;
    this.mode = MODES.includes(readPref('mi_daynight')) ? readPref('mi_daynight') : 'auto';
    this.darkness = this.target(); // 0 = gündüz, 1 = tam gece (ekranda yumuşakça buna yaklaşır)
    this.sync();
  }

  async sync() {
    try {
      const t0 = Date.now();
      const res = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
      const date = res.headers.get('Date');
      if (!date) return;
      // Yanıt yolun ortasında üretilmiş kabul edilir; başlık saniye hassasiyetinde → +500 ms
      this.skew = Date.parse(date) + 500 - (t0 + Date.now()) / 2;
      this.serverSynced = true;
    } catch { /* sunucu saati alınamadı: tarayıcı saati */ }
  }

  get now() { return new Date(Date.now() + this.skew); }

  /** Yerel saat (kesirli: 16.5 = 16:30) */
  get hour() { const d = this.now; return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }

  /** Saate göre hedef karanlık */
  clockDarkness(h = this.hour) {
    if (h >= DUSK_END || h < DAWN_START) return 1;
    if (h >= DUSK_START) return smooth((h - DUSK_START) / (DUSK_END - DUSK_START));
    if (h < DAWN_END) return 1 - smooth((h - DAWN_START) / (DAWN_END - DAWN_START));
    return 0;
  }

  target() {
    if (this.mode === 'night') return 1;
    if (this.mode === 'day') return 0;
    return this.clockDarkness();
  }

  cycleMode() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    writePref('mi_daynight', this.mode);
    return this.mode;
  }

  /** Mod değişince ani geçiş olmasın: ~1,5 sn'de hedefe yaklaşır */
  update(dt) {
    const t = this.target();
    this.darkness += (t - this.darkness) * (1 - Math.exp(-2.5 * dt));
    if (Math.abs(t - this.darkness) < 1e-3) this.darkness = t;
  }

  get isNight() { return this.darkness > 0.5; }

  /**
   * Ayın gökteki ilerleyişi (0 = doğuş, 1 = batış). Gerçek saatte gece 16:00'dan 07:30'a kadar sürer;
   * saat gece dışındayken (sabit gece modu) ay 10 dakikada bir turunu oyun zamanıyla tamamlar.
   */
  moonProgress(gameTime) {
    const h = this.hour, len = 24 - DUSK_START + DAWN_END;
    const into = (h - DUSK_START + 24) % 24;
    if (into <= len && this.clockDarkness(h) > 0) return into / len;
    return (gameTime / 600) % 1;
  }

  get label() {
    const d = this.now;
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const phase = this.darkness > 0.95 ? 'Gece' : this.darkness < 0.05 ? 'Gündüz' : (this.hour < 12 ? 'Şafak' : 'Akşam');
    return { hm, phase, mode: { auto: 'Otomatik', night: 'Gece (sabit)', day: 'Gündüz (sabit)' }[this.mode] };
  }
}
