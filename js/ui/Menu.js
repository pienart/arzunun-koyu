import { DIFFICULTY } from '../data/gameData.js';
import { SaveGame } from '../systems/SaveGame.js';
import { Settings, QUALITY } from '../systems/Settings.js';

const $ = (s) => document.querySelector(s);
const fmtTime = (s) => `${Math.floor(s / 60)} dk ${String(Math.floor(s % 60)).padStart(2, '0')} sn`;
const fmtDate = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Menüler (DOM):
 *  • Ana menü     : Devam Et (otomatik/elle kayıt) · Yeni Oyun (zorluk, harita, savaş sisi) · Ayarlar · Nasıl Oynanır
 *  • Duraklatma   : Esc / F10 / P. Oyun durur; Devam · Kaydet · Yükle · Ayarlar · Ana Menü
 *  • Ayarlar      : grafik kalitesi, hava efektleri, canlılık, otomatik kayıt, FPS, ses seviyeleri (anında uygulanır)
 * onStart(opts) ana menüden oyunu başlatır: { difficulty, seed, fog } veya { save }.
 */
export class Menu {
  constructor(onStart) {
    this.onStart = onStart;
    this.game = null;
    this.root = $('#menu');
    this.isOpen = false;
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div class="mcard">
        <h1>ARZU'NUN KÖYÜ</h1>
        <p class="sub">Küçük bir köyden büyük bir krallığa</p>
        <div class="mview" data-view="main">
          <button data-act="continue" class="primary">Devam Et</button>
          <button data-act="new" class="primary">Yeni Oyun</button>
          <button data-act="load">Kayıtlı Oyunu Yükle</button>
          <button data-act="settings">Ayarlar</button>
          <button data-act="howto">Nasıl Oynanır?</button>
          <p class="saveinfo"></p>
        </div>
        <div class="mview hidden" data-view="new">
          <h2>Yeni Oyun</h2>
          <label>Zorluk</label>
          <div class="seg" data-name="difficulty">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-v="${k}" class="${k === 'normal' ? 'on' : ''}">${d.name}</button>`).join('')}</div>
          <p class="hint" data-hint="difficulty"></p>
          <label>Harita</label>
          <div class="seg" data-name="map"><button data-v="fixed" class="on">Klasik</button><button data-v="random">Rastgele</button></div>
          <label class="chk"><input type="checkbox" data-name="fog" checked> Savaş sisi (keşfedilmemiş alanlar karanlık)</label>
          <div class="row"><button data-act="back">Geri</button><button data-act="start" class="primary">Başla</button></div>
        </div>
        <div class="mview hidden" data-view="pause">
          <h2>Oyun Duraklatıldı</h2>
          <button data-act="resume" class="primary">Devam</button>
          <button data-act="save">Kaydet (F5)</button>
          <button data-act="load">Kaydı Yükle</button>
          <button data-act="settings">Ayarlar</button>
          <button data-act="mainmenu">Ana Menü</button>
        </div>
        <div class="mview hidden" data-view="settings">
          <h2>Ayarlar</h2>
          <label>Grafik kalitesi</label>
          <div class="seg" data-set="quality">${Object.entries(QUALITY).map(([k, q]) => `<button data-v="${k}">${q.name}</button>`).join('')}</div>
          <p class="hint">Düşük: daha az piksel ve parçacık (zayıf bilgisayarlar için). Su efekti kalitesi yeniden yüklemede değişir.</p>
          <label class="chk"><input type="checkbox" data-set="weather"> Hava efektleri (yağmur, kar, sis)</label>
          <label class="chk"><input type="checkbox" data-set="life"> Canlılık (kuşlar, tavuklar, balıklar, baca dumanı)</label>
          <label class="chk"><input type="checkbox" data-set="autosave"> 2 dakikada bir otomatik kayıt</label>
          <label class="chk"><input type="checkbox" data-set="showFps"> FPS göstergesi</label>
          <label class="chk"><input type="checkbox" data-snd="music"> Müzik (B)</label>
          <label class="chk"><input type="checkbox" data-snd="ambient"> Atmosfer sesleri (N)</label>
          <label class="chk"><input type="checkbox" data-snd="sfx"> Olay sesleri / efektler (M)</label>
          <div class="vols">
            ${[['master', 'Ana ses'], ['music', 'Müzik'], ['ambient', 'Atmosfer'], ['sfx', 'Efektler']].map(([k, n]) => `
              <label>${n}<input type="range" min="0" max="100" data-vol="${k}"><b></b></label>`).join('')}
          </div>
          <div class="row"><button data-act="back">Geri</button></div>
        </div>
        <div class="mview hidden" data-view="howto">
          <h2>Nasıl Oynanır?</h2>
          <ul class="howto">
            <li><b>Ekonomi:</b> Köylüleri seçip ağaç, meyve, altın, taş ya da çiftliğe sağ tıklayın. Tersane kurup balıkçı teknesiyle balık toplayın.</li>
            <li><b>İnşaat:</b> Köylü seçiliyken alttaki menüden bina seçin (kısayollar butonların köşesinde). Çiti sürükleyerek çizin, içine kapı koyun.</li>
            <li><b>Savunma:</b> Kasaba Merkezi'nde "Köylüleri Çağır" ile köylüleri sığınağa alın; hasarlı binaya köylülerle sağ tıklayıp tamir edin.</li>
            <li><b>Ordu:</b> Kışla (milis), Okçuluk Alanı, Ahır (atlı), Kuşatma Atölyesi (koçbaşı). Ctrl+1…9 ile grup kaydedin, rakama iki kez basınca kamera gruba gider.</li>
            <li><b>Zafer:</b> Düşman Kasaba Merkezi'ni yıkın ya da Harika inşa edin. Düşman köylülerine baskın yapmak saldırı dalgalarını küçültür.</li>
            <li><b>Dünya:</b> Mevsimler döner (kışın çiftlikler yavaşlar), hava değişir; gece/gündüz sunucu saatine göredir.</li>
          </ul>
          <div class="row"><button data-act="back">Geri</button></div>
        </div>
      </div>`;
    this.views = Object.fromEntries([...this.root.querySelectorAll('.mview')].map((v) => [v.dataset.view, v]));
    this.choice = { difficulty: 'normal', map: 'fixed' };
    this._hint();
    this.root.addEventListener('click', (e) => {
      const seg = e.target.closest('.seg button');
      if (seg) {
        const group = seg.parentElement;
        group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg));
        if (group.dataset.name) { this.choice[group.dataset.name] = seg.dataset.v; this._hint(); }
        if (group.dataset.set) Settings.set(group.dataset.set, seg.dataset.v);
        return;
      }
      const act = e.target.closest('button[data-act]')?.dataset.act;
      if (act) this._act(act);
    });
    this.root.addEventListener('change', (e) => {
      const s = e.target.dataset.set;
      if (s) Settings.set(s, e.target.checked);
      const snd = e.target.dataset.snd, a = this.game?.audio ?? this.audio;
      if (snd && a) {
        if (snd === 'music') a.setMusic(e.target.checked);
        else if (snd === 'ambient') a.setAmbient(e.target.checked);
        else a.setSfx(e.target.checked);
      }
    });
    this.root.addEventListener('input', (e) => {
      const v = e.target.dataset.vol;
      if (v) { Settings.set(`vol.${v}`, e.target.value / 100); e.target.nextElementSibling.textContent = `%${e.target.value}`; }
    });
  }

  _hint() {
    const d = DIFFICULTY[this.choice.difficulty];
    this.root.querySelector('[data-hint="difficulty"]').textContent =
      `İlk 20 dakika saldırı yok; sonra saldırılar rastgele zamanlarda (ortalama ${Math.round(d.interval / 6) / 10} dk arayla) gelir. Düşman ${d.enemyVillagers} köylüyle başlar.`;
  }

  _show(view) {
    this._prev = this._view;
    this._view = view;
    for (const [k, el] of Object.entries(this.views)) el.classList.toggle('hidden', k !== view);
    if (view === 'settings') this._syncSettings();
    if (view === 'main') this._syncMain();
  }

  _syncMain() {
    const a = SaveGame.meta(true), m = SaveGame.meta(false);
    const latest = [a && { ...a, auto: true }, m && { ...m, auto: false }].filter(Boolean).sort((x, y) => y.date - x.date)[0];
    this.views.main.querySelector('[data-act="continue"]').classList.toggle('hidden', !latest);
    this.views.main.querySelector('[data-act="load"]').classList.toggle('hidden', !m);
    this._latest = latest;
    this.views.main.querySelector('.saveinfo').textContent = latest
      ? `Son kayıt: ${fmtDate(latest.date)} · oyun süresi ${fmtTime(latest.time)} · ${DIFFICULTY[latest.difficulty]?.name ?? ''}${latest.auto ? ' (otomatik)' : ''}`
      : '';
  }

  _syncSettings() {
    const d = Settings.data;
    this.views.settings.querySelectorAll('[data-set="quality"] button').forEach((b) => b.classList.toggle('on', b.dataset.v === d.quality));
    for (const k of ['weather', 'life', 'autosave', 'showFps']) this.views.settings.querySelector(`[data-set="${k}"]`).checked = !!d[k];
    const a = this.game?.audio;
    for (const inp of this.views.settings.querySelectorAll('[data-snd]')) {
      inp.disabled = !a;
      inp.checked = a ? !!{ music: a.musicOn, ambient: a.ambientOn, sfx: a.sfxOn }[inp.dataset.snd] : true;
    }
    for (const inp of this.views.settings.querySelectorAll('[data-vol]')) {
      const v = Math.round(d.vol[inp.dataset.vol] * 100);
      inp.value = v; inp.nextElementSibling.textContent = `%${v}`;
    }
  }

  _act(act) {
    const g = this.game;
    g?.click();
    switch (act) {
      case 'new': this._show('new'); break;
      case 'settings': this._show('settings'); break;
      case 'howto': this._show('howto'); break;
      case 'back': this._show(g ? 'pause' : 'main'); break;
      case 'start': {
        const fog = this.root.querySelector('[data-name="fog"]').checked;
        const seed = this.choice.map === 'random' ? (Math.random() * 1e9) | 0 : undefined;
        this._launch({ difficulty: this.choice.difficulty, seed, fog });
        break;
      }
      case 'continue': {
        const s = SaveGame.load(this._latest?.auto);
        if (s) this._launch({ save: s });
        break;
      }
      case 'load': {
        const s = SaveGame.load(false);
        if (!s) { g?.ui.toast('Kayıtlı oyun yok.', 'warn'); break; }
        if (g) { sessionStorage.setItem('mi_boot', 'load'); location.reload(); } else this._launch({ save: s });
        break;
      }
      case 'resume': this.close(); break;
      case 'save': g?.saveGame(); break;
      case 'mainmenu': location.reload(); break;
      default: break;
    }
  }

  _launch(opts) {
    this.root.classList.add('loading');
    // Harita üretimi birkaç yüz ms sürer: önce "hazırlanıyor" yazısı ekrana gelsin.
    // Sekme arka plandaysa requestAnimationFrame çalışmaz → zamanlayıcı yedeği (hangisi önce gelirse).
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      try { this.onStart(opts); } finally { this.root.classList.remove('loading'); }
      this.close();
    };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 150);
  }

  /** Ana menü (oyun yokken) */
  openMain() {
    this.isOpen = true;
    this.root.classList.remove('hidden', 'ingame');
    this._show('main');
  }

  /** Oyun içi duraklatma */
  openPause() {
    if (!this.game) return;
    this.isOpen = true;
    this.game.setPaused(true);
    this.root.classList.remove('hidden');
    this.root.classList.add('ingame');
    this._show('pause');
  }

  close() {
    if (!this.game) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.game.setPaused(false);
  }
}
