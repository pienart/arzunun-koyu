/**
 * Oyuncu ayarları (tarayıcıda hatırlanır). Değişiklik dinleyicileri anında uygular (ses seviyesi, grafik kalitesi).
 *
 *  quality : 'low' | 'medium' | 'high'  → çözünürlük (DPR), hava parçacık sayısı, canlılık efektleri
 */
const KEY = 'mi_settings';
const DEFAULTS = {
  quality: 'high',
  weather: true,        // yağmur/kar/sis parçacıkları
  life: true,           // kuşlar, tavuklar, zıplayan balıklar, baca dumanı
  autosave: true,       // 2 dakikada bir otomatik kayıt
  showFps: false,
  vol: { master: 0.9, music: 0.45, ambient: 0.8, sfx: 0.9 },
};

export const QUALITY = {
  low: { name: 'Düşük', maxDpr: 1, particles: 0.4, water: 0.35 },
  medium: { name: 'Orta', maxDpr: 1.5, particles: 0.7, water: 0.5 },
  high: { name: 'Yüksek', maxDpr: 2, particles: 1, water: 0.5 },
};

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s ? { ...DEFAULTS, ...s, vol: { ...DEFAULTS.vol, ...(s.vol ?? {}) } } : structuredClone(DEFAULTS);
  } catch { return structuredClone(DEFAULTS); }
}

class SettingsStore {
  constructor() {
    this.data = read();
    this._fns = [];
  }

  get q() { return QUALITY[this.data.quality] ?? QUALITY.high; }

  set(path, value) {
    const keys = path.split('.');
    let o = this.data;
    for (let k = 0; k < keys.length - 1; k++) o = o[keys[k]];
    o[keys[keys.length - 1]] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* yalnızca bu oturum */ }
    for (const fn of this._fns) fn(path, value);
  }

  onChange(fn) { this._fns.push(fn); }
}

export const Settings = new SettingsStore();
