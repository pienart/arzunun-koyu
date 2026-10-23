import { MANIFEST } from '../../assets/manifest.js';
import { HW, HH } from '../render/iso.js';
import { Settings } from '../systems/Settings.js';
import { BUILDINGS, BUILD_MENU, DECOR_MENU, TECHS, UNITS, ITEMS, RESOURCE_NAMES, RESOURCE_TYPES, MARKET, PLAYER, LEVELS } from '../data/gameData.js';
import { SidePanel, Inventory } from './Panels.js';

const $ = (sel) => document.querySelector(sel);
const spriteFile = (key) => MANIFEST.sprites[key]?.file;
const iconFile = (key) => MANIFEST.icons[key]?.file;
const UNIT_PORTRAIT = { villager: 'vil_idle', militia: 'mil_idle', archer: 'arc_idle', cavalry: 'cav_idle', ram: 'ram_e', fishingBoat: 'boat_e', commander: 'mil_idle', yeti: 'yeti_idle', architect: 'arch_idle', cart: 'cart_e', catapult: 'catapult_e', warWagon: 'warWagon_e' };
/** Komut butonlarına sırayla atanan kısayollar (WASD kamera, H/G/L/M/N/B/X/P başka işlere ayrılı) */
const HOTKEYS = ['KeyQ', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyF', 'KeyC', 'KeyV', 'KeyZ', 'KeyJ', 'KeyK']; // E ve O kamera kısayolu
const UNIT_DESC = {
  villager: 'Kaynak toplar, bina inşa eder ve tamir eder.', fishingBoat: 'Balık sürülerinden yiyecek toplar ve tersaneye getirir.',
  architect: 'Patika, çiçek tarhı ve süs ağacı yapar: şehri güzelleştirir. Patikada birimler %35 hızlı yürür.',
  commander: 'Tek olur; ölürse buradan yenisi atanır. "Devriye At" ile çitle çevrili köyü sürekli dolaşır, içeri giren düşmanı, çitteki gedikleri ve ağır hasarı ekranda uyarır.',
  catapult: 'Kale Çağı. Uzaktan (9 karo) taş atar; isabet noktasındaki herkese ve binalara alan hasarı verir (binalara ×3).',
  warWagon: 'İmparatorluk Çağı. İçine 50 asker alır, yayalardan hızlı gider. Askerleri seçip arabaya sağ tıklayın; "İndir" ile indirin.',
  cart: 'İmparatorluk Çağı. Kaynağa gider, 60 birim yük alır ve yalnızca Kasaba Merkezi\'ne boşaltır.',
};

function buildingFile(type, tier) {
  if (type === 'farm') return MANIFEST.textures.farm.file;
  type = BUILDINGS[type]?.sprite ?? type;
  for (let t = tier; t >= 0; t--) if (MANIFEST.sprites[`${type}_${t}`]) return MANIFEST.sprites[`${type}_${t}`].file;
  for (let t = tier + 1; t <= 3; t++) if (MANIFEST.sprites[`${type}_${t}`]) return MANIFEST.sprites[`${type}_${t}`].file;
  return spriteFile(type) ?? spriteFile('foundation');
}

const ICON = (k, cls = 'ri') => `<img class="${cls}" src="${iconFile(k)}" alt="">`;
const portraitCache = new Map();

/** Düşman portresi: oyun içindeki kırmızı takım rengi sürümünden küçük bir görüntü üretir (önbellekli) */
function enemyPortrait(sprites, key) {
  if (!portraitCache.has(key)) {
    let url = spriteFile(key);
    try { url = sprites.recolored(key).pick(140).toDataURL('image/png'); } catch { /* orijinali kullan */ }
    portraitCache.set(key, url);
  }
  return portraitCache.get(key);
}

function buildingKey(type, tier) {
  type = BUILDINGS[type]?.sprite ?? type;
  for (let t = tier; t >= 0; t--) if (MANIFEST.sprites[`${type}_${t}`]) return `${type}_${t}`;
  for (let t = tier + 1; t <= 3; t++) if (MANIFEST.sprites[`${type}_${t}`]) return `${type}_${t}`;
  return MANIFEST.sprites[type] ? type : 'foundation';
}
// localStorage gizli pencerede hata fırlatabilir → tercih yalnızca hatırlanmaz
const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * UIManager: DOM tabanlı oyun arayüzü (üst kaynak barı, alt panel, ipuçları, bildirimler).
 * Canvas yerine DOM: metin keskinliği, erişilebilirlik ve CSS ile hızlı stil.
 * Performans: yapı yalnızca seçim "imzası" değiştiğinde kurulur; her tick'te sadece metin/sınıf güncellenir.
 */
export class UIManager {
  constructor(game) {
    this.game = game;
    this.el = {
      res: Object.fromEntries(RESOURCE_TYPES.map((r) => [r, $(`#res-${r} b`)])),
      popBox: $('#res-pop'),
      pop: $('#res-pop b'),
      ageName: $('#ageName'),
      ageProg: $('#ageProg'),
      ageBox: $('#ageBox'),
      waveBox: $('#waveBox'),
      waveText: $('#waveBox b'),
      menuBtn: $('#menuBtn'),
      fps: $('#fps'),
      idleBtn: $('#idleBtn'),
      idleCount: $('#idleBtn b'),
      bottom: $('#bottombar'),
      panelToggle: $('#panelToggle'),
      info: $('#selinfo'),
      cmds: $('#commands'),
      tooltip: $('#tooltip'),
      toasts: $('#toasts'),
      debug: $('#debug'),
      pending: $('#pending'),
      pendingList: $('#pendingList'),
      pendingCount: $('#pendingCount'),
      help: $('#help'),
      helpBtn: $('#helpBtn'),
      dayBtn: $('#dayBtn'),
      dayTime: $('#dayBtn b'),
      dayMode: $('#dayBtn i'),
      victory: $('#victory'),
      defeat: $('#defeat'),
    };
    this._sig = null;
    this._pendingSig = null;
    this._pendingRows = [];
    this._buttons = [];
    this._refs = {};
    this.el.idleBtn.addEventListener('click', () => { game.click(); game.selectNextIdle(); });
    // Köylü butonunun altındaki ikonlar: yazı yok, açıklama fare üzerine gelince ipucunda
    // Köylü menüsü açıkken inşaat listesi geri çekilir (ikisi aynı köşede üst üste binmesin)
    const iw = $('#idleWrap');
    iw.addEventListener('mouseenter', () => document.body.classList.add('idlemenu'));
    iw.addEventListener('mouseleave', () => document.body.classList.remove('idlemenu'));
    iw.addEventListener('focusout', () => document.body.classList.remove('idlemenu'));
    const vsel = $('#idleMenu');
    vsel.addEventListener('click', (e) => {
      const k = e.target.closest('button[data-vsel]')?.dataset.vsel;
      if (!k) return;
      game.click();
      if (k === 'nextIdle') game.selectNextIdle(); else game.selectVillagers(k === 'idleAll');
    });
    vsel.addEventListener('mousemove', (e) => {
      const b = e.target.closest('button[data-vsel]');
      if (b) this._tip(`<b>${b.dataset.tip}</b>${b.dataset.vsel === 'idleAll' ? `<div>${this._idleN ?? 0} köylü boşta</div>` : ''}`, e, true);
      else this._hideTip();
    });
    vsel.addEventListener('mouseleave', () => this._hideTip());
    // İnşaat listesi: başlıktaki ok ile katla/aç (tercih hatırlanır)
    this.el.pendingToggle = $('#pendingToggle');
    this.pendingFolded = readPref('mi_pending_fold') === '1';
    this._renderPendingFold();
    this.el.pendingToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      game.click();
      this.pendingFolded = !this.pendingFolded;
      writePref('mi_pending_fold', this.pendingFolded ? '1' : '0');
      this._renderPendingFold();
    });
    // Kasaba Merkezi / Bilim Merkezi paneli ve iksir envanteri
    this.side = new SidePanel(this);
    this.inv = new Inventory(this);
    // Kaynaklar: üzerine gelince saatlik verim
    this._rateHist = [];
    for (const r of RESOURCE_TYPES) {
      const box = $(`#res-${r}`);
      box.addEventListener('mousemove', (e) => { this._resHover = r; this._showRate(r, e); });
      box.addEventListener('mouseleave', () => { this._resHover = null; this._hideTip(); });
    }
    this.el.menuBtn.addEventListener('click', () => { game.click(); game.menu?.openPause(); });
    // Mini harita gizle/göster (K) — tercih hatırlanır
    $('#mapToggle').addEventListener('click', () => this.toggleMinimap());
    if (readPref('mi_map_hidden') === '1') $('#mapbox').classList.add('mini');
    // Huzur: üzerine gelince kalemler
    const hb = $('#res-happy');
    hb.addEventListener('mousemove', (e) => this._showHappy(e));
    hb.addEventListener('mouseleave', () => this._hideTip());
    this.el.panelToggle.addEventListener('click', () => this.togglePanel());
    $('#helpClose')?.addEventListener('click', () => this.toggleHelp(false));
    this.el.dayBtn.addEventListener('click', () => this.cycleDayNight());
    this.el.helpBtn.addEventListener('click', () => { game.click(); this.toggleHelp(); });
    // İlk açılışta görünür; sonra kullanıcının son tercihi hatırlanır
    this.toggleHelp(readPref('mi_help') !== 'closed');
    this.el.cmds.addEventListener('mousemove', (e) => this._hoverCmd(e));
    this.el.cmds.addEventListener('mouseleave', () => { this.el.tooltip.style.display = 'none'; });
    // Alt menü: seçim varken açık (otomatik); sekme/F2 ile sabit açık tutulabilir
    this.pinned = readPref('mi_panel_pin') === '1';
    this._panelOpen = null;
    this._syncPanel();
    this._renderSoundBtn();
  }

  /** Panel resmi (bina türü için) — Panels modülü kullanır */
  buildingImg(type, tier) { return buildingFile(type, tier); }

  /** Boşluğa tıklayınca: sabitlemeyi kaldır ve alt paneli kapat */
  closePanel() {
    if (this.pinned) { this.pinned = false; writePref('mi_panel_pin', '0'); }
    this._syncPanel();
  }

  // ───────────── Alt panel gizle/göster ─────────────
  /** F2 / sekme: alt menüyü sabit açık tut ya da otomatiğe döndür */
  togglePanel() {
    this.game.click();
    this.pinned = !this.pinned;
    writePref('mi_panel_pin', this.pinned ? '1' : '0');
    this.toast(this.pinned ? 'Alt menü sabit açık' : 'Alt menü otomatik (seçim yapınca açılır)', 'info');
    this._syncPanel();
  }

  /** Seçim (veya yerleştirme) varsa ya da sabitlenmişse açık; yoksa kapalı */
  _syncPanel() {
    const g = this.game;
    const open = this.pinned || g.selection?.length > 0 || !!g.placement;
    document.body.classList.toggle('panel-pinned', this.pinned);
    this.el.panelToggle.title = this.pinned ? 'Sabitlemeyi kaldır: menü seçimle açılıp kapansın (F2)' : 'Menüyü sabit aç (F2)';
    if (open === this._panelOpen) return;
    this._panelOpen = open;
    document.body.classList.toggle('panel-collapsed', !open);
    if (!open) this.el.tooltip.style.display = 'none';
  }

  _renderPendingFold() {
    this.el.pending.classList.toggle('folded', this.pendingFolded);
    const t = this.pendingFolded ? 'Listeyi göster' : 'Listeyi gizle';
    this.el.pendingToggle.title = t;
    this.el.pendingToggle.setAttribute('aria-expanded', String(!this.pendingFolded));
  }

  // ───────────── Kaynak verimi (saatlik) ─────────────
  /** Toplanan kaynak geçmişinden 10 sn'lik örnekler: son 5 dk'nın ortalaması saatliğe çevrilir */
  _sampleRates() {
    const w = this.game.world, t = w.time, h = this._rateHist;
    if (h.length && t - h[h.length - 1].t < 10) return;
    if (h.length && t < h[h.length - 1].t) h.length = 0; // kayıt yüklendi → geçmiş geçersiz
    h.push({ t, g: { ...w.player.stats.gathered }, spent: w.player.stats.spent.food });
    while (h.length > 2 && t - h[1].t >= 300) h.shift();
  }

  /** Kaynak türü başına saatlik toplama hızı (oyun saati) ve o kaynakta çalışan sayısı */
  rates() {
    const w = this.game.world, h = this._rateHist, now = { t: w.time, g: w.player.stats.gathered };
    const from = h[0], dt = from ? now.t - from.t : 0;
    const out = {};
    for (const r of RESOURCE_TYPES) out[r] = { perHour: dt >= 5 ? ((now.g[r] ?? 0) - (from.g[r] ?? 0)) / dt * 3600 : 0, workers: 0 };
    out.food.spentHour = dt >= 5 ? (w.player.stats.spent.food - (from.spent ?? 0)) / dt * 3600 : 0;
    for (const u of w.units) {
      if (u.owner !== PLAYER || u.dead || u.garrisoned) continue;
      const tg = u.task?.target;
      if (u.type === 'villager' && u.state === 'gather' && tg) out[tg.isBuilding ? 'food' : tg.resType] && out[tg.isBuilding ? 'food' : tg.resType].workers++;
      else if (u.naval && u.state !== 'idle') out.food.workers++;
    }
    let passive = 0;
    for (const b of w.buildings) if (b.owner === PLAYER && b.complete && b.def.income?.food) passive += b.def.income.food * (w.player.modifiers[b.def.incomeMod] ?? 1) * (w.levelMul?.(b) ?? 1);
    out.food.passive = passive * 3600;
    out.window = dt;
    return out;
  }

  _showRate(r, e) {
    const x = this.rates()[r], w = this.game.world;
    const fmt = (v) => Math.round(v).toLocaleString('tr-TR');
    const win = x && this._rateHist.length ? Math.round(Math.min(300, w.time - this._rateHist[0].t) / 60 * 10) / 10 : 0;
    this._tip(`<b>${RESOURCE_NAMES[r]}</b>
      <div class="rate"><span>Saatlik çıkarım</span><span>${fmt(x.perHour)} / saat</span>
      <span>Dakikalık</span><span>${fmt(x.perHour / 60)} / dk</span>
      <span>Toplayan</span><span>${x.workers} ${r === 'food' ? 'köylü/tekne' : 'köylü'}</span>
      ${r === 'food' && x.passive ? `<span>Yapı geliri (dahil)</span><span>${fmt(x.passive)} / saat</span>` : ''}
      ${r === 'food' ? `<span>Harcanan (halk + şarap)</span><span class="neg">−${fmt(x.spentHour)} / saat</span><span>Net</span><span class="${x.perHour - x.spentHour < 0 ? 'neg' : 'pos'}">${fmt(x.perHour - x.spentHour)} / saat</span>` : ''}
      <span>Toplam toplanan</span><span>${fmt(w.player.stats.gathered[r])}</span></div>
      <div class="sub">${win >= 0.2 ? `Son ${win} dakikanın ortalaması (oyun süresi)` : 'Hesaplanıyor… birkaç saniye bekleyin'}</div>`, e);
  }

  /** Ortak ipucu kutusu; below: imlecin altında aç (üst bar için) */
  _tip(html, e, below = true) {
    const tip = this.el.tooltip;
    tip.innerHTML = html;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, e.clientX + 14))}px`;
    tip.style.top = below ? `${e.clientY + 18}px` : `${e.clientY - r.height - 14}px`;
  }
  _hideTip() { this.el.tooltip.style.display = 'none'; }

  // ───────────── Ses (iki kanal) ─────────────
  /** M: olay sesleri */
  toggleSfx() {
    const a = this.game.audio;
    a.setSfx(!a.sfxOn);
    this._renderSoundBtn();
    if (a.sfxOn) this.game.click();
  }

  /** B: müzik */
  toggleMusic() {
    const a = this.game.audio;
    a.setMusic(!a.musicOn);
    this._renderSoundBtn();
    this.game.click();
  }

  /** N: atmosfer (doğa ambiyansı) */
  toggleAmbient() {
    const a = this.game.audio;
    a.setAmbient(!a.ambientOn);
    this._renderSoundBtn();
    this.game.click();
  }

  /** Ses düğmeleri artık Ayarlar menüsünde (Menu); burada yalnızca bildirim */
  _renderSoundBtn() {
    const a = this.game.audio;
    if (!a || !this._soundInit) { this._soundInit = true; return; }
    this.toast(`Müzik ${a.musicOn ? 'açık' : 'kapalı'} · Atmosfer ${a.ambientOn ? 'açık' : 'kapalı'} · Efektler ${a.sfxOn ? 'açık' : 'kapalı'}`, 'info');
  }

  toggleMinimap() {
    this.game.click();
    const box = $('#mapbox');
    box.classList.toggle('mini');
    writePref('mi_map_hidden', box.classList.contains('mini') ? '1' : '0');
    $('#mapToggle').title = box.classList.contains('mini') ? 'Mini haritayı göster (K)' : 'Mini haritayı gizle (K)';
  }

  _showHappy(e) {
    const p = this.game.world.player, f = p.happyFactors ?? {};
    const names = { base: 'Temel', houses: 'Evler', pop: 'Nüfus', beauty: 'Güzellik (süsler)', tavern: 'Tavernalar', war: 'Savaş', losses: 'Kayıplar / yağma', starving: 'Açlık', winter: 'Kış soğuğu' };
    const rows = Object.entries(f).filter(([, v]) => Math.abs(v) >= 0.5).map(([k, v]) => `<span>${names[k] ?? k}</span><span class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${Math.round(v)}</span>`).join('');
    const mul = 0.8 + 0.4 * (p.happiness / 100);
    this._tip(`<b>Halkın Huzuru: ${Math.round(p.happiness)} / 100</b><div class="rate">${rows}<span>Hedef</span><span>${Math.round(p.happyTarget ?? p.happiness)}</span><span>Şarap stoğu</span><span>${Math.floor(p.wine)}</span><span>Toplama hızı</span><span>×${mul.toFixed(2)}</span></div>
      <div class="sub">Evler, nüfus, süslemeler ve şaraplı tavernalar huzuru artırır; savaş, kayıp, yağma, açlık ve (kürk giysi yoksa) kış düşürür.</div>`, e);
  }

  // ───────────── Her UI tick'i ─────────────
  update() {
    const w = this.game.world, p = w.player;
    for (const r of RESOURCE_TYPES) if (this.el.res[r]) this.el.res[r].textContent = Math.floor(p.resources[r] ?? 0);
    this.el.pop.textContent = `${p.population}/${p.popCap}`;
    this.el.popBox.classList.toggle('full', p.population >= p.popCap);
    this.el.ageName.textContent = p.ageDef.name;

    let ageItem = null;
    for (const b of w.buildings) if (b.owner === PLAYER) for (const q of b.queue) if (q.kind === 'age') ageItem = q;
    this.el.ageBox.classList.toggle('researching', !!ageItem);
    this.el.ageProg.style.width = ageItem ? `${(1 - ageItem.remaining / ageItem.total) * 100}%` : '0%';

    // Düşman dalga sayacı
    const ai = w.enemyAI;
    if (false) { // saldırılar rastgele: geri sayım gösterilmez (yalnızca saldırı başlayınca boru ve uyarı)
      this.el.waveBox.classList.remove('hidden');
      this.el.waveText.textContent = ai.wave === 0 ? `İlk saldırı ${fmtTime(ai.countdown)}` : `Dalga ${ai.wave + 1}: ${fmtTime(ai.countdown)}`;
      this.el.waveBox.classList.toggle('soon', ai.countdown < 30);
    } else this.el.waveBox.classList.add('hidden');

    const idle = this._idleN = w.units.filter((u) => u.owner === PLAYER && u.type === 'villager' && u.state === 'idle' && !u.garrisoned).length;
    this._sampleRates();
    this.el.idleCount.textContent = idle;
    this.el.idleBtn.classList.toggle('has', idle > 0);

    this._updatePending();
    this._renderDayNight();
    this.side.update(0.15);
    this.inv.update();
    const hv = Math.round(p.happiness), hb = $('#res-happy');
    hb.querySelector('b').textContent = hv;
    hb.querySelector('.hbar i').style.width = `${hv}%`;
    hb.classList.toggle('low', hv < 30);
    this._syncPanel();

    const sig = this._signature();
    if (sig !== this._sig) {
      this._sig = sig;
      this._buildInfo();
      this._buildCommands();
    }
    this._refreshInfo();
    this._refreshButtons();
  }

  // ───────────── Bekleyen inşaatlar (sağ üst liste) ─────────────
  /** Liste yalnızca inşaat kümesi değişince yeniden kurulur; her tick'te yalnızca yüzde/işçi sayısı güncellenir */
  _updatePending() {
    const g = this.game, w = g.world, tier = w.player.tier;
    const list = w.buildings.filter((b) => b.owner === PLAYER && !b.complete);
    this.el.pending.classList.toggle('hidden', list.length === 0);
    const sig = list.map((b) => b.id).join(',') + '|' + tier;
    if (sig !== this._pendingSig) {
      this._pendingSig = sig;
      this.el.pendingCount.textContent = list.length;
      this.el.pendingList.innerHTML = '';
      this._pendingRows = list.map((b) => {
        const li = document.createElement('li');
        li.className = b.type === 'farm' ? 'farm' : '';
        li.title = 'Göster ve seç';
        li.innerHTML = `<img src="${buildingFile(b.type, tier)}" alt=""><div class="nm"><span>${b.name}</span><em></em></div>` +
          `<button class="call" title="İşçi Çağır: en yakın boştaki ${BUILDINGS[b.type].decor ? 'mimar' : 'köylü'} gelsin"><img src="${spriteFile(BUILDINGS[b.type].decor ? 'arch_idle' : 'vil_idle')}" alt=""></button><div class="pb"><i></i></div>`;
        li.querySelector('.call').addEventListener('click', (e) => { e.stopPropagation(); g.click(); w.callWorker(b); });
        li.addEventListener('click', () => {
          g.click();
          g.select([b]);
          g.camera.centerOn((b.centerI - b.centerJ) * HW, (b.centerI + b.centerJ) * HH + 40);
        });
        this.el.pendingList.appendChild(li);
        return { b, em: li.querySelector('em'), bar: li.querySelector('.pb i') };
      });
    }
    for (const r of this._pendingRows) {
      const pct = Math.floor(r.b.progress * 100);
      const txt = `%${pct} · ${r.b.builders ? `${r.b.builders} işçi` : 'işçi yok'}`;
      if (r.em.textContent !== txt) {
        r.em.textContent = txt;
        r.em.classList.toggle('none', !r.b.builders);
      }
      r.bar.style.width = `${pct}%`;
    }
  }

  _signature() {
    const g = this.game, sel = g.selection, p = g.world.player;
    const base = `${p.age}|${p.techs.size}|${p.tools.size}|`;
    if (!sel.length) return base + 'none';
    const a = sel[0];
    if (a.isUnit) return base + 'u' + sel.map((u) => u.id).join(',');
    if (a.isBuilding) return base + `b${a.id}|${a.complete}|${a.queue.map((q) => q.kind + q.id).join(',')}|${g.world.needsRepair(a)}`;
    return base + `r${a.kind}${a.i},${a.j}`;
  }

  // ───────────── Seçim bilgisi ─────────────
  _buildInfo() {
    const g = this.game, sel = g.selection, tier = g.world.player.tier;
    const info = this.el.info;
    if (!sel.length) {
      info.innerHTML = `<div class="empty"><b>Seçim yok</b><span>Birim seçmek için sol tıklayın ya da sürükleyerek kutu çizin.
        Sağ tık: kaynak topla, inşa et, saldır veya yürü.</span></div>`;
      this._refs = {};
      return;
    }
    const a = sel[0];
    const enemy = !!a.owner && a.owner !== PLAYER; // düşman veya yaratık
    let img, title;
    if (a.isUnit) {
      img = a.type === 'yeti' ? spriteFile('yeti_idle') : enemy ? enemyPortrait(g.sprites, UNIT_PORTRAIT[a.type]) : spriteFile(UNIT_PORTRAIT[a.type]);
      const same = sel.every((u) => u.type === a.type);
      title = sel.length > 1 ? `${same ? a.name : 'Birlik'} × ${sel.length}` : a.name;
      if (a.def.animal) { img = spriteFile(`${a.type}_idle`); title = a.name; }
    } else if (a.isBuilding) {
      const tierA = g.world.players[a.owner].tier;
      img = enemy ? enemyPortrait(g.sprites, buildingKey(a.type, tierA)) : buildingFile(a.type, tierA);
      title = a.name;
    } else {
      img = a.kind === 'tree' ? spriteFile(['tree_oak', 'tree_pine', 'tree_autumn'][a.variant % 3]) : spriteFile(a.kind);
      title = a.name;
    }
    const farm = a.isBuilding && a.type === 'farm';
    info.innerHTML = `
      <div class="portrait ${farm ? 'farm' : ''} ${enemy ? 'enemy' : ''}"><img src="${img}" alt=""></div>
      <div class="details">
        <div class="title">${title}${enemy ? ` <span class="foe">${a.type === 'yeti' ? 'Yaratık' : 'Düşman'}</span>` : ''}${a.isBuilding && a.def.levels && a.complete ? ` <span class="lvl">Sv. ${a.level}</span>` : ''}</div>
        <div class="hp ${a.isResource ? 'res' : ''} ${enemy ? 'foe' : ''}"><i></i><span></span></div>
        <div class="line l1"></div>
        <div class="line l2"></div>
        <div class="queue"></div>
      </div>`;
    this._refs = {
      hp: info.querySelector('.hp i'), hpText: info.querySelector('.hp span'),
      l1: info.querySelector('.l1'), l2: info.querySelector('.l2'), queue: info.querySelector('.queue'),
    };
    if (a.isBuilding && a.queue.length && !enemy) {
      this._refs.queue.innerHTML = a.queue.map((q, k) => {
        const icon = q.kind === 'unit' ? spriteFile(UNIT_PORTRAIT[q.id]) : q.kind === 'age' ? iconFile('age') : q.kind === 'level' ? iconFile('build') : iconFile(TECHS[q.id].icon);
        return `<button class="qi ${k === 0 ? 'active' : ''}" data-k="${k}" title="İptal et"><img src="${icon}" alt=""><i></i></button>`;
      }).join('');
      this._refs.queue.querySelectorAll('.qi').forEach((btn) => btn.addEventListener('click', () => {
        g.click();
        g.world.cancelQueue(a, Number(btn.dataset.k));
      }));
      this._refs.qbar = this._refs.queue.querySelector('.qi.active i');
    }
  }

  _unitStats(u) {
    const w = this.game.world;
    const atk = w.stat(u, 'attack'), m = w.stat(u, 'melee'), pr = w.stat(u, 'pierce'), rng = w.stat(u, 'range');
    return `<span class="st">${ICON('swords')}${atk}</span><span class="st">${ICON('shield')}${m}/${pr}</span>` +
      (rng > 0 ? `<span class="st">${ICON('quiver')}${rng}</span>` : '');
  }

  _refreshInfo() {
    const g = this.game, sel = g.selection, r = this._refs;
    if (!sel.length || !r.hp) return;
    const a = sel[0];
    let frac = 1, text = '', l1 = '', l2 = '';
    if (a.isUnit) {
      const hp = sel.reduce((s, u) => s + Math.max(0, u.hp), 0), max = sel.reduce((s, u) => s + u.maxHp, 0);
      frac = hp / max; text = `${Math.ceil(hp)}/${max}`;
      if (sel.length === 1) {
        l1 = a.activity;
        if (a.def.transport) l2 = `Yolcu: ${a.cargo.length} / ${a.def.transport} asker`;
        else if (a.def.animal) l2 = `Yabani hayvan: köylülerle sağ tıklayıp avlayın (${a.def.meat} et, ${a.def.hide} deri).`;
        else if (a.type === 'yeti') l2 = 'Surları kolayca yıkar; binalara karşı yavaştır. Yalnızca kışın mağarasından çıkar.';
        else if (a.carry > 0.5) l2 = `${ICON(a.carryType)} Taşıyor: ${Math.floor(a.carry)} ${RESOURCE_NAMES[a.carryType].toLowerCase()}`;
        else l2 = this._unitStats(a);
      } else {
        const busy = sel.filter((u) => u.state !== 'idle').length;
        l1 = `${busy} meşgul · ${sel.length - busy} hazır`;
        if (sel.every((u) => u.type === a.type)) l2 = this._unitStats(a);
      }
    } else if (a.isBuilding) {
      frac = a.hp / a.maxHp; text = `${Math.ceil(a.hp)}/${a.maxHp}`;
      if (a.complete && a.def.garrison && a.owner === PLAYER) l2 = `İçeride: ${a.garrison.length}/${a.def.garrison} köylü${a.repairers ? ` · ${a.repairers} köylü tamir ediyor` : ''}`;
      else if (a.repairers) l2 = `${a.repairers} köylü tamir ediyor`;
      if (!a.complete) l1 = `İnşa ediliyor: %${Math.floor(a.progress * 100)}${a.builders ? ` · ${a.builders} işçi` : ' · işçi yok'}`;
      else if (a.def.farmFood) l1 = `${ICON('food')} Kalan yiyecek: ${Math.ceil(a.food)}${a.level > 1 ? ` · ürün +%${Math.round((g.world.levelMul(a) - 1) * 100)}` : ''}`;
      else if (a.def.attack) l1 = `<span class="st">${ICON('swords')}${a.def.attack.damage}</span><span class="st">${ICON('quiver')}${a.def.attack.range}</span> Menzildeki düşmana ok atar`;
      else if (a.def.income) {
        const m = g.world.players[a.owner].modifiers[a.def.incomeMod] ?? 1;
        l1 = `${ICON('food')} ${a.type === 'dock' ? 'Balıkçılar' : 'Süt ve peynir'}: +${Math.round(a.def.income.food * m * g.world.levelMul(a) * 60)} yiyecek/dk${a.def.dropsite ? ` · Kabul eder: ${a.def.dropsite.map((x) => ICON(x)).join(' ')}` : ''}`;
      } else if (a.def.dropsite) l1 = `Kabul eder: ${a.def.dropsite.map((x) => ICON(x)).join(' ')}${a.level > 1 ? ` · bırakılan +%${Math.round((g.world.levelMul(a) - 1) * 100)}` : ''}`;
      else if (a.def.light) l1 = 'Geceleri köylüler ateşi yakar; çevresi daha aydınlık olur.';
      else if (a.def.tiers) l1 = `<span class="st">${ICON('shield')}${a.armor.melee}/${a.armor.pierce}</span> Çağ atladıkça kalınlaşır ve güçlenir`;
      else if (a.def.popProvided) l1 = `${ICON('pop')} Nüfus +${g.world.popOf(a)} (çağla artar)`;
      const q = a.owner === PLAYER ? a.queue[0] : null;
      if (q) {
        const name = q.kind === 'unit' ? UNITS[q.id].name : q.kind === 'age' ? g.world.player.nextAge?.name ?? '' : q.kind === 'level' ? `Seviye ${q.id}` : TECHS[q.id].name;
        l2 = q.kind === 'unit' && !q.started ? `${name}: nüfus bekleniyor` : `${name}: %${Math.floor((1 - q.remaining / q.total) * 100)}`;
        if (r.qbar) r.qbar.style.height = `${(1 - q.remaining / q.total) * 100}%`;
      }
      if (a.def.trains && a.complete && !q && a.owner === PLAYER && !l2) l2 = 'Sağ tık: toplanma noktası';
    } else if (a.isResource) {
      frac = a.amount / a.maxAmount;
      text = `${Math.ceil(a.amount)}`;
      l1 = `${ICON(a.resType)} ${RESOURCE_NAMES[a.resType]}: ${Math.ceil(a.amount)} / ${a.maxAmount}`;
    }
    r.hp.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    r.hpText.textContent = text;
    if (r.l1.innerHTML !== l1) r.l1.innerHTML = l1;
    if (r.l2.innerHTML !== l2) r.l2.innerHTML = l2;
  }

  // ───────────── Komut butonları ─────────────
  _buildCommands() {
    const g = this.game, w = g.world, p = w.player, sel = g.selection, tier = p.tier;
    const specs = [];
    const a = sel[0];
    const mine = a && a.owner === PLAYER;
    if (a?.isUnit && mine) {
      const menu = sel.some((u) => u.def.builder) ? BUILD_MENU : sel.some((u) => u.def.decorBuilder) ? DECOR_MENU : [];
      {
        for (const type of menu) {
          const def = BUILDINGS[type];
          specs.push({
            img: buildingFile(type, tier), cls: type === 'farm' ? 'farm' : '', label: def.tiers?.[Math.min(def.tiers.length - 1, tier)].name ?? def.name, title: def.tiers?.[Math.min(def.tiers.length - 1, tier)].name ?? def.name,
            cost: w.costOf(type), time: def.buildTime, desc: def.desc,
            check: () => w.checkBuildable(type), onClick: () => g.startPlacement(type),
          });
        }
      }
      const cmdr = sel.find((u) => u.def.patrol);
      if (cmdr) {
        specs.push({
          img: iconFile('banner'), label: 'Devriye', title: 'Devriye At',
          desc: 'Komutan çitle çevrili köyün içinde sürekli devriye atar: içeri giren düşmanı, çitteki gedikleri ve ağır hasarı ekranda uyarı olarak bildirir; gördüğü düşmanla savaşır.',
          check: () => (w.enclosure ? null : 'Çitle çevrili alan yok'), onClick: () => { if (cmdr.startPatrol(w)) this.toast('Komutan devriyeye çıktı.', 'good'); },
        });
      }
      const wagon = sel.find((u) => u.def.transport);
      if (wagon) {
        specs.push({
          img: spriteFile('warWagon_e'), label: 'İndir', title: 'Askerleri İndir',
          desc: `Arabadaki askerler (${wagon.cargo.length}/${wagon.def.transport}) çevreye iner. Bindirmek için askerleri seçip arabaya sağ tıklayın.`,
          check: () => (wagon.cargo.length ? null : 'Araba boş'), onClick: () => w.unload(wagon),
        });
      }
      specs.push({ text: 'DUR', label: 'Dur', title: 'Dur', desc: 'Seçili birimler mevcut işini bırakır.', check: () => null, onClick: () => g.stopSelected() });
    } else if (a?.isBuilding && a.complete && mine) {
      const def = a.def;
      for (const u of def.trains ?? []) {
        const ud = UNITS[u];
        specs.push({
          img: spriteFile(UNIT_PORTRAIT[u]), cls: 'unit', label: ud.name, title: `${ud.name} Üret`,
          cost: ud.cost, time: ud.trainTime,
          desc: UNIT_DESC[u] ?? `Can ${ud.hp} · Saldırı ${ud.attack}${ud.siege ? ` (binalara ×${ud.bldgMul})` : ''}${ud.range ? ` · Menzil ${ud.range}` : ''} · Zırh ${ud.armor.melee}/${ud.armor.pierce} · Hız ${ud.speed}`,
          check: () => w.checkQueue(a, 'unit', u), onClick: () => w.enqueue(a, 'unit', u),
        });
      }
      if (def.canAdvanceAge) {
        const next = p.nextAge;
        specs.push({
          img: iconFile('age'), label: next ? next.name : 'Son çağ', title: next ? `Çağ Atla: ${next.name}` : 'Son çağdasınız',
          cost: next?.cost, time: next?.time,
          desc: 'Kaynak yetmez: asker sayısı ve gerekli binalar da tamamlanmalı (yukarıdaki panelde liste). Yeni binalar ve araştırmalar açılır; binalarınızın görünümü yeni çağa geçer.',
          check: () => w.checkQueue(a, 'age'), onClick: () => w.enqueue(a, 'age'),
        });
      }
      if (def.research) {
        specs.push({
          img: iconFile('age'), label: 'Ağaç', title: 'Araştırma Ağacı',
          desc: 'Tüm araştırmalar yukarıdaki panelde: Köy, Ordu, Sağlık ve Savunma başlıkları. Bir düğüme tıklayarak araştırın.',
          check: () => null, onClick: () => { this.side._t = 0; },
        });
      }
      if (def.alchemy) {
        for (const [id, it] of Object.entries(ITEMS)) {
          specs.push({
            img: iconFile(it.icon), label: it.name, title: `${it.kind === 'tool' ? 'Alet' : 'İksir'}: ${it.name}`,
            cost: it.cost, time: it.time, desc: it.desc + (it.kind === 'potion' ? ` (Envanterde: ${p.items[id] ?? 0})` : p.tools.has(id) ? ' (Üretildi)' : ''),
            check: () => w.checkQueue(a, 'craft', id), onClick: () => w.enqueue(a, 'craft', id),
          });
        }
      }
      for (const id of def.techs ?? []) {
        const t = TECHS[id];
        if (p.techs.has(id)) continue;
        specs.push({
          img: iconFile(t.icon), label: t.name, title: t.name, cost: t.cost, time: t.time, desc: t.desc,
          check: () => w.checkQueue(a, 'tech', id), onClick: () => w.enqueue(a, 'tech', id),
        });
      }
      if (def.garrison) {
        specs.push({
          img: iconFile('horn'), label: 'Köylüleri Çağır', title: 'Köylüleri Çağır',
          desc: `Çan çalar: en yakın köylüler koşup içeri sığınır (en fazla ${def.garrison}). İçeride saldırılardan korunur ve yavaşça iyileşirler; her 3 köylü binaya bir ok daha attırır.`,
          check: () => (w.units.some((u) => u.owner === PLAYER && u.type === 'villager') ? (a.garrison.length >= def.garrison ? 'Bina dolu' : null) : 'Köylü yok'),
          onClick: () => w.ringBell(a),
        });
        specs.push({
          img: iconFile('banner'), label: 'Herkes Dışarı', title: 'Herkes Dışarı',
          desc: 'Sığınan köylüler dışarı çıkar ve en son topladıkları kaynağa geri döner.',
          check: () => (a.garrison.length ? null : 'İçeride kimse yok'), onClick: () => w.ungarrison(a),
        });
      }
      if (def.wall) {
        specs.push({
          img: buildingFile('gate', tier), label: 'Kapı Aç', title: 'Kapıya Çevir',
          cost: w.costOf('gate'), desc: 'Bu çit parçası kapıya dönüşür: birimleriniz buradan geçer, düşman geçemez.',
          check: () => (p.canAfford(w.costOf('gate')) ? null : 'Yetersiz kaynak'),
          onClick: () => { const gt = w.wallToGate(a); if (gt) g.select([gt]); },
        });
      }
      if (def.wall || def.gate) {
        specs.push({
          img: iconFile('build'), label: 'Yık', title: def.gate ? 'Kapıyı Yık' : 'Çiti Yık',
          desc: 'Bu parça yıkılır (geri ödeme yok). Bilerek açtığınız gedik için komutan uyarı vermez.',
          check: () => null, onClick: () => { w.demolishWall(a); g.select([]); },
        });
      }
      if (!def.wall && !def.gate && !def.ground && a.type !== 'townCenter' && a.type !== 'wonder') {
        specs.push({
          img: spriteFile('arch_idle'), label: 'Taşı', title: 'Binayı Taşı (Mimar)',
          cost: w.relocateCost(a), desc: 'Bir mimar binayı söküp yeni yerine kurar. Bedel: bina maliyetinin %30\'u. Kuyruk ve seviye korunur.',
          check: () => (w.units.some((u) => u.owner === PLAYER && u.type === 'architect') ? (p.canAfford(w.relocateCost(a)) ? null : 'Yetersiz kaynak') : 'Mimar gerekli (Üniversite)'),
          onClick: () => g.startRelocate(a),
        });
      }
      if (def.levels) {
        const max = a.level >= LEVELS.MAX_LEVEL;
        specs.push({
          img: iconFile('build'), label: max ? 'En Yüksek' : `Seviye ${a.level + 1}`, title: max ? 'En yüksek seviye' : `Yükselt: Seviye ${a.level + 1}`,
          cost: max ? null : w.upgradeCost(a), time: max ? null : LEVELS.time * a.level,
          desc: `Seviye ${a.level}/${LEVELS.MAX_LEVEL}. Her seviye üretimi %${LEVELS.bonus * 100} artırır (${a.type === 'farm' ? 'çiftlik daha hızlı ürün verir ve yiyeceği tazelenir' : a.type === 'dock' ? 'balıkçı geliri ve tekne avı artar' : 'bu binaya bırakılan kaynak artar'}).`,
          check: () => w.checkQueue(a, 'level'), onClick: () => w.enqueue(a, 'level'),
        });
      }
      if (w.needsRepair(a)) {
        specs.push({
          img: iconFile('build'), label: 'Tamir Ettir', title: 'Tamir Ettir',
          desc: 'En yakın 4 köylü (önce boşta olanlar) binayı tamir etmeye gelir. Tamir, onarılan cana göre biraz kaynak harcar. Köylüleri seçip binaya sağ tıklayarak da tamir ettirebilirsiniz.',
          check: () => null, onClick: () => w.callRepairers(a),
        });
      }
      if (def.trade) {
        for (const r of ['wood', 'food', 'stone']) {
          specs.push({
            img: iconFile(r), label: `${RESOURCE_NAMES[r]} Sat`, title: `${MARKET.lot} ${RESOURCE_NAMES[r]} sat`,
            cost: { [r]: MARKET.lot }, desc: `Karşılığında ${MARKET.sell} altın alırsınız.`,
            check: () => (p.resources[r] >= MARKET.lot ? null : 'Yetersiz kaynak'), onClick: () => w.trade('sell', r),
          });
          specs.push({
            img: iconFile(r), cls: 'buy', label: `${RESOURCE_NAMES[r]} Al`, title: `${MARKET.lot} ${RESOURCE_NAMES[r]} al`,
            cost: { gold: MARKET.buy }, desc: `${MARKET.buy} altına ${MARKET.lot} ${RESOURCE_NAMES[r].toLowerCase()} alırsınız.`,
            check: () => (p.resources.gold >= MARKET.buy ? null : 'Yetersiz kaynak'), onClick: () => w.trade('buy', r),
          });
        }
      }
    } else if (a?.isBuilding && !a.complete && mine) {
      const half = Object.entries(a.cost ?? a.def.cost).map(([k, v]) => [k, Math.floor(v / 2)]);
      specs.push({
        img: iconFile('build'), label: 'İnşaatı Yık', title: 'Yarım inşaatı yık',
        desc: `İnşaat iptal edilir ve kaynağın YARISI geri verilir: ${half.map(([k, v]) => `${ICON(k)}${v}`).join(' ')}`,
        check: () => null, onClick: () => { w.demolishSite(a); g.select([]); },
      });
      specs.push({
        img: spriteFile(BUILDINGS[a.type].decor ? 'arch_idle' : 'vil_idle'), label: 'İşçi Çağır', title: 'İşçi Çağır',
        desc: `En yakın BOŞTAKİ ${BUILDINGS[a.type].decor ? 'mimar' : 'köylü'} bu inşaata gelir (her tıklamada bir tane; çalışanlara dokunulmaz).`,
        check: () => (w.units.some((u) => u.owner === PLAYER && u.state === 'idle' && w.canBuild(u, a.type)) ? null : 'Boşta işçi yok'),
        onClick: () => w.callWorker(a),
      });
    }
    this.el.cmds.innerHTML = '';
    if (!specs.length && a) {
      let hint = '';
      if (a.type === 'yeti') hint = 'Mağaranın yaratığı Koca Ayak! Kış boyunca hem size hem düşmana saldırır. Askerlerinizi toplayıp sağ tıklayarak saldırın; öldürene ödül var.';
      else if (a.owner !== PLAYER && a.owner) hint = 'Düşman birimi. Askerlerinizi seçip sağ tıklayarak saldırın.';
      else if (a.isBuilding && !a.complete) hint = 'İnşaat sürüyor. Köylüleri seçip temele sağ tıklayarak hızlandırın.';
      else if (a.isBuilding) hint = a.def.desc ?? '';
      else if (a.isResource) hint = 'Köylüleri seçip bu kaynağa sağ tıklayarak toplatın.';
      this.el.cmds.innerHTML = `<div class="hint">${hint}</div>`;
    }
    this._buttons = specs.map((spec) => {
      const el = document.createElement('button');
      el.className = `cmd ${spec.cls ?? ''}`;
      const hk = HOTKEYS[specs.indexOf(spec)];
      const key = hk ? `<span class="hk">${hk.slice(3)}</span>` : '';
      el.innerHTML = (spec.img ? `<img src="${spec.img}" alt=""><span class="lbl">${spec.label}</span>` : `<span class="txt">${spec.text}</span>`) + key;
      if (hk) el.title = `${spec.title} (${hk.slice(3)})`;
      el.addEventListener('click', () => {
        const err = spec.check();
        if (err) { this.toast(err, 'warn'); return; }
        this.game.click();
        spec.onClick();
        this._sig = null; // kuyruk değişti → panel yeniden kurulsun
      });
      el._spec = spec;
      this.el.cmds.appendChild(el);
      return { el, spec };
    });
  }

  /** Klavye kısayolu: görünen komut butonlarından sıradakine karşılık gelir */
  hotkey(code) {
    const k = HOTKEYS.indexOf(code);
    if (k < 0 || !this._buttons[k]) return false;
    this._buttons[k].el.click();
    return true;
  }

  updateFps(v) {
    const on = Settings.data.showFps;
    this.el.fps.classList.toggle('hidden', !on);
    if (on) this.el.fps.textContent = `${v} FPS`;
  }

  _refreshButtons() {
    for (const { el, spec } of this._buttons) {
      const err = spec.check();
      el.classList.toggle('poor', err === 'Yetersiz kaynak');
      el.classList.toggle('locked', !!err && err !== 'Yetersiz kaynak');
    }
  }

  _hoverCmd(e) {
    const btn = e.target.closest('.cmd');
    const tip = this.el.tooltip;
    if (!btn?._spec) { tip.style.display = 'none'; return; }
    const s = btn._spec, p = this.game.world.player;
    const err = s.check();
    const cost = s.cost ? Object.entries(s.cost).map(([k, v]) =>
      `<span class="${p.resources[k] < v ? 'miss' : ''}">${ICON(k)}${v}</span>`).join(' ') : '';
    tip.innerHTML = `<b>${s.title}</b>${cost ? `<div class="cost">${cost}${s.time ? ` <span class="time">${s.time} sn</span>` : ''}</div>` : ''}
      <div>${s.desc ?? ''}</div>${err && err !== 'Yetersiz kaynak' ? `<div class="err">${err}</div>` : ''}`;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, e.clientX + 14)}px`;
    tip.style.top = `${e.clientY - r.height - 14}px`;
  }

  // ───────────── Bildirimler & paneller ─────────────
  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.el.toasts.appendChild(el);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
    setTimeout(() => el.remove(), kind === 'age' ? 6000 : 4200);
  }

  cycleDayNight() {
    const mode = this.game.dayNight.cycleMode();
    this.game.click();
    this.toast({ auto: 'Gece/gündüz: sunucu saatine göre', night: 'Gece modu', day: 'Gündüz modu' }[mode], 'info');
    this._renderDayNight();
  }

  _renderDayNight() {
    const dn = this.game.dayNight, l = dn.label;
    this.el.dayBtn.classList.toggle('night', dn.isNight);
    if (this.el.dayTime.textContent !== l.hm) this.el.dayTime.textContent = l.hm;
    const sub = `${dn.mode === 'auto' ? l.phase : l.mode} · ${this.game.world.weather.label}`;
    if (this.el.dayMode.textContent !== sub) this.el.dayMode.textContent = sub;
    this.el.dayBtn.title = `${l.phase} · ${l.mode}${dn.serverSynced ? ' (sunucu saati)' : ''} — değiştir (L)`;
  }

  toggleHelp(force) {
    const open = force ?? this.el.help.classList.contains('hidden');
    this.el.help.classList.toggle('hidden', !open);
    this.el.helpBtn.classList.toggle('on', open);
    writePref('mi_help', open ? 'open' : 'closed');
  }
  toggleDebug() { this.el.debug.classList.toggle('hidden'); }

  showVictory() {
    const p = this.game.world.player;
    this.el.victory.querySelector('.stats').textContent = `Öldürülen düşman: ${p.stats.kills} · Kayıp: ${p.stats.losses}`;
    this.el.victory.classList.remove('hidden');
  }

  showDefeat() {
    const p = this.game.world.player;
    this.el.defeat.querySelector('.stats').textContent = `Öldürülen düşman: ${p.stats.kills} · Kayıp: ${p.stats.losses}`;
    this.el.defeat.classList.remove('hidden');
  }

  updateDebug(text) {
    if (!this.el.debug.classList.contains('hidden')) this.el.debug.textContent = text;
  }
}
