/**
 * MEVSİMLER ve HAVA DURUMU (oyun zamanına bağlı; sunucu saatinden bağımsız)
 *
 *  Mevsim: İlkbahar → Yaz → Sonbahar → Kış, her biri SEASON_LEN (7,5 dk) saniye. Etkileri:
 *    • Görünüm: renk tonu (Renderer), sonbaharda meşeler kızıla döner; kışın zemin, ağaçlar, dağlar ve çatılar karla örtülür
 *    • Oynanış: kışın çiftlikler %25 yavaş, ilkbaharda %10 hızlı (farmMul)
 *  Hava: her mevsimin kendi olasılıkları; 50–110 sn sürer, yoğunluk yumuşakça artıp azalır.
 *    rain (yağmur) · snow (kar) · fog (sis) · clear (açık)
 */
export const SEASONS = [
  { id: 'spring', name: 'İlkbahar', farmMul: 1.1, weather: { clear: 0.55, rain: 0.35, fog: 0.1 } },
  { id: 'summer', name: 'Yaz', farmMul: 1.0, weather: { clear: 0.85, rain: 0.1, fog: 0.05 } },
  { id: 'autumn', name: 'Sonbahar', farmMul: 1.0, weather: { clear: 0.45, rain: 0.35, fog: 0.2 } },
  { id: 'winter', name: 'Kış', farmMul: 0.75, weather: { clear: 0.3, snow: 0.6, fog: 0.1 } },
];
export const WEATHER_NAMES = { clear: 'Açık', rain: 'Yağmur', snow: 'Kar', fog: 'Sis' };
// 7,5 dk × 4 mevsim = 30 dk: kış (ve mağaradaki yaratık) 30 dakikada bir gelir
export const SEASON_LEN = 450;

export class Weather {
  constructor(seed = 1) {
    this.time = 0;
    this.seasonIndex = 1;           // yazla başla (oyunun ilk dakikaları açık havada)
    this.seasonTime = 0;
    this.kind = 'clear';
    this.target = 0;                // hedef yoğunluk
    this.intensity = 0;             // 0..1 (ekranda yumuşakça hedefe yaklaşır)
    this.timer = 70;                // bu hava ne kadar sürecek
    this.version = 0;               // mevsim değişti → ağaç görünümü (statik katman) yenilenir
    this.snowCover = 0;             // 0..1: kışın zemin ~40 sn'de karla kaplanır, ilkbaharda aynı hızla erir
    this._r = seed >>> 0 || 1;
  }

  _rand() { // küçük deterministik üreteç (kayıt/yüklemede aynı sırayı vermesi gerekmez)
    this._r = (this._r * 1664525 + 1013904223) >>> 0;
    return this._r / 4294967296;
  }

  get season() { return SEASONS[this.seasonIndex]; }
  get farmMul() { return this.season.farmMul; }
  get label() { return `${this.season.name} · ${WEATHER_NAMES[this.intensity > 0.15 ? this.kind : 'clear']}`; }

  update(dt) {
    this.time += dt;
    this.seasonTime += dt;
    if (this.seasonTime >= SEASON_LEN) {
      this.seasonTime -= SEASON_LEN;
      this.seasonIndex = (this.seasonIndex + 1) % SEASONS.length;
      this.version++;
      // Mevsime uymayan hava hemen dağılır (kışın yağmur, yazın kar olmasın)
      if (!(this.kind in this.season.weather)) this.target = 0;
      this.changed = this.season.name;
    }
    const goalSnow = this.season.id === 'winter' ? 1 : 0;
    this.snowCover += Math.sign(goalSnow - this.snowCover) * Math.min(Math.abs(goalSnow - this.snowCover), dt / 40);
    this.timer -= dt;
    if (this.timer <= 0) this._roll();
    // Hava değişirken önce eski hava diner, sonra yenisi bastırır
    const goal = this.target;
    this.intensity += (goal - this.intensity) * (1 - Math.exp(-0.35 * dt));
    if (this.intensity < 0.02 && this._pending) { this.kind = this._pending; this._pending = null; this.target = this._pendingTarget; }
  }

  _roll() {
    const w = this.season.weather;
    let r = this._rand(), kind = 'clear';
    for (const [k, p] of Object.entries(w)) { if ((r -= p) <= 0) { kind = k; break; } }
    this.timer = 50 + this._rand() * 60;
    const strength = kind === 'clear' ? 0 : 0.55 + this._rand() * 0.45;
    if (kind === this.kind || this.intensity < 0.05) { this.kind = kind; this.target = strength; }
    else { this.target = 0; this._pending = kind; this._pendingTarget = strength; }
  }

  serialize() { return { time: this.time, seasonIndex: this.seasonIndex, seasonTime: this.seasonTime, kind: this.kind, target: this.target, timer: this.timer }; }

  restore(s) {
    if (!s) return;
    Object.assign(this, s);
    this.intensity = s.target;
    this.snowCover = this.season.id === 'winter' ? 1 : 0;
    this.version++;
  }
}
