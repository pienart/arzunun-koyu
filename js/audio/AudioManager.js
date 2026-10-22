import { HW, HH } from '../render/iso.js';
import { Settings } from '../systems/Settings.js';
import { BUILD } from '../build.js';

/** Ses başına ayarlar: minGap = aynı sesin iki çalınışı arası en kısa süre, voices = aynı anda en fazla kopya */
const RULES = {
  chop: { minGap: 0.09, voices: 3, vol: 0.5 }, mine: { minGap: 0.09, voices: 3, vol: 0.45 },
  hammer: { minGap: 0.1, voices: 3, vol: 0.45 }, sword: { minGap: 0.06, voices: 4, vol: 0.55 },
  bow: { minGap: 0.05, voices: 4, vol: 0.45 }, hit: { minGap: 0.05, voices: 3, vol: 0.4 },
  death: { minGap: 0.15, voices: 3, vol: 0.6 }, bell: { minGap: 0.3, voices: 1, vol: 0.6 },
  horn: { minGap: 4, voices: 1, vol: 0.8 }, fanfare: { minGap: 2, voices: 1, vol: 0.75 },
  collapse: { minGap: 0.4, voices: 2, vol: 0.8 }, click: { minGap: 0.04, voices: 2, vol: 0.5 },
  defeat: { minGap: 2, voices: 1, vol: 0.8 }, ram: { minGap: 0.3, voices: 2, vol: 0.8 },
  splash: { minGap: 0.8, voices: 1, vol: 0.5 }, cluck: { minGap: 1.5, voices: 1, vol: 0.4 }, net: { minGap: 0.5, voices: 2, vol: 0.4 },
};

/** Kanal başı temel kazançlar (ayarlardaki seviye bununla çarpılır) */
const BASE = { sfx: 0.9, amb: 0.3, music: 0.55 };

// localStorage gizli pencerede veya engellenmiş site verisinde hata fırlatabilir → tercih yalnızca hatırlanmaz
const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } };

/**
 * AudioManager (Web Audio API)
 *  - Dört kanal: ana · müzik · atmosfer · olay sesleri. Üçü üst bardan ayrı ayrı açılıp kapanır (M, N, B);
 *    seviyeleri Ayarlar penceresinden gelir. Tercihler hatırlanır.
 *  - Atmosfer döngüleri: gündüz kuşları ↔ gece cırcır böcekleri (karanlığa göre), yağmur / kış rüzgârı
 *    (hava yoğunluğuna göre), kamp ateşi çıtırtısı (kameranın ateşe uzaklığına göre). Hepsi yumuşakça kısılıp açılır.
 *  - Müzik: köy teması ↔ savaş teması, son çatışmaya göre çapraz geçişle.
 *  - Konumsal efekt: ekrandaki x konumuna göre stereo; ekran dışındaysa uzaklıkla kısılır.
 *  - Ses enflasyonu koruması ve küçük perde varyasyonu. Ses yüklenemezse oyun sessiz devam eder.
 */
export class AudioManager {
  constructor(sounds, camera) {
    this.defs = sounds ?? {};
    this.camera = camera;
    this.buffers = {};
    const legacy = readPref('mi_sound');
    this.ambientOn = (readPref('mi_amb') ?? legacy) !== 'off';
    this.sfxOn = (readPref('mi_sfx') ?? legacy) !== 'off';
    this.musicOn = readPref('mi_music') !== 'off';
    this.ctx = null;
    this._last = {};
    this._active = {};
    this.loops = {};     // ad → { src, gain, target }
    this.music = null;   // çalan müzik adı
    this.ready = false;
    Settings.onChange((path) => { if (path.startsWith('vol')) this._applyLevels(); });
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.amb = this.ctx.createGain();
      this.mus = this.ctx.createGain();
      for (const g of [this.sfx, this.amb, this.mus]) g.connect(this.master);
      this._applyLevels(true);
    } catch { this.ctx = null; return; }
    await Promise.all(Object.entries(this.defs).map(async ([name, def]) => {
      try {
        const res = await fetch(`${def.file}?v=${BUILD}`);
        if (!res.ok) return;
        this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* tek bir ses eksikse diğerleri çalışmaya devam eder */ }
    }));
    this.ready = true;
  }

  _applyLevels(instant = false) {
    if (!this.ctx) return;
    const v = Settings.data.vol, t = this.ctx.currentTime, tc = instant ? 0.001 : 0.15;
    this.master.gain.setTargetAtTime(v.master, t, tc);
    this.sfx.gain.setTargetAtTime(this.sfxOn ? BASE.sfx * v.sfx : 0, t, tc);
    this.amb.gain.setTargetAtTime(this.ambientOn ? BASE.amb * v.ambient : 0, t, tc * 2);
    this.mus.gain.setTargetAtTime(this.musicOn ? BASE.music * v.music : 0, t, tc * 3);
  }

  /** İlk tıklama/tuş: tarayıcı sesi ancak kullanıcı etkileşiminden sonra başlatmaya izin verir */
  unlock() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  /** En az bir kanal açık mı? */
  get enabled() { return this.ambientOn || this.sfxOn || this.musicOn; }

  setAmbient(on) { this.ambientOn = on; writePref('mi_amb', on ? 'on' : 'off'); this._applyLevels(); if (on) this.unlock(); }
  setSfx(on) { this.sfxOn = on; writePref('mi_sfx', on ? 'on' : 'off'); this._applyLevels(); if (on) this.unlock(); }
  setMusic(on) { this.musicOn = on; writePref('mi_music', on ? 'on' : 'off'); this._applyLevels(); if (on) this.unlock(); }

  // ───────── Döngüler (atmosfer ve müzik) ─────────
  /** Döngünün hedef sesini ayarla (0 → durur). Döngü gerekirse başlatılır; değişim yumuşaktır. */
  setLoop(name, vol, bus = 'amb', ramp = 1.2) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let L = this.loops[name];
    if (!L) {
      if (vol <= 0.001 || !this.buffers[name]) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers[name];
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(bus === 'music' ? this.mus : this.amb);
      // Rastgele noktadan başla: aynı anda başlayan döngüler hep aynı yerden duyulmasın
      src.start(0, Math.random() * this.buffers[name].duration);
      L = this.loops[name] = { src, gain, target: 0 };
    }
    if (Math.abs(L.target - vol) < 0.005) return;
    L.target = vol;
    L.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, ramp / 3);
  }

  /** Müzik çapraz geçişi: istenen parça yükselir, diğerleri kısılır */
  playMusic(name) {
    if (this.music === name) return;
    this.music = name;
    for (const m of ['music_village', 'music_battle']) this.setLoop(m, m === name ? 1 : 0, 'music', m === name ? 3 : 2);
  }

  /**
   * Her karede çağrılır: ortam durumuna göre atmosfer döngülerinin seviyesi.
   *  env = { darkness, weatherKind, weatherIntensity, season, campfireDist (karo, kameraya), combat }
   */
  updateEnvironment(env) {
    if (!this.ready || !this.ctx || this.ctx.state !== 'running') return;
    const d = env.darkness, I = env.weatherIntensity;
    const rain = env.weatherKind === 'rain' ? I : 0;
    this.setLoop('amb_day', (1 - d) * (1 - rain * 0.7) * (env.season === 'winter' ? 0.25 : 1));
    this.setLoop('amb_night', d * (1 - rain * 0.6) * (env.season === 'winter' ? 0.3 : 1));
    this.setLoop('nature', 0.45 * (1 - rain * 0.5));
    this.setLoop('rain', rain * 1.1);
    this.setLoop('wind', env.season === 'winter' ? 0.55 + (env.weatherKind === 'snow' ? I * 0.5 : 0) : 0);
    this.setLoop('fire', Math.max(0, 1 - env.campfireDist / 14) * Math.min(1, d * 1.6) * 1.4, 'amb', 0.6);
    this.playMusic(env.combat ? 'music_battle' : 'music_village');
  }

  /**
   * @param name  ses adı
   * @param i, j  dünya konumu (grid); null → konumsuz (arayüz sesi, her zaman tam ses)
   * @param vol   0..1 çarpan
   */
  play(name, i = null, j = null, vol = 1) {
    if (!this.sfxOn || !this.ctx || this.ctx.state !== 'running') return;
    const buf = this.buffers[name];
    if (!buf) return;
    const rule = RULES[name] ?? { minGap: 0.05, voices: 3, vol: 0.6 };
    const now = this.ctx.currentTime;
    if (now - (this._last[name] ?? -9) < rule.minGap) return;
    if ((this._active[name] ?? 0) >= rule.voices) return;

    let gain = rule.vol * vol, pan = 0;
    if (i !== null && j !== null) {
      // Konumsal: dünya → ekran
      const cam = this.camera;
      const s = cam.worldToScreen((i - j) * HW, (i + j) * HH);
      const dx = Math.max(-s.x, 0, s.x - cam.viewW), dy = Math.max(-s.y, 0, s.y - cam.viewH);
      const off = Math.hypot(dx, dy);
      gain *= Math.max(0, 1 - off / 450);          // ekran dışında uzaklaştıkça kısılır
      if (gain < 0.02) return;
      pan = Math.max(-0.9, Math.min(0.9, (s.x / cam.viewW - 0.5) * 1.5));
      gain *= 0.75 + 0.25 * Math.min(1, cam.zoom); // uzaklaşınca dünya sesleri biraz kısılır
    }
    this._last[name] = now;
    this._active[name] = (this._active[name] ?? 0) + 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.93 + Math.random() * 0.14;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = src.connect(g);
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.sfx);
    src.onended = () => { this._active[name]--; };
    src.start();
  }
}
