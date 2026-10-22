import { MANIFEST } from '../../assets/manifest.js';
import { HW, HH } from '../render/iso.js';
import { Settings } from '../systems/Settings.js';
import { BUILDINGS, BUILD_MENU, TECHS, UNITS, RESOURCE_NAMES, RESOURCE_TYPES, MARKET, PLAYER, ENEMY } from '../data/gameData.js';

const $ = (sel) => document.querySelector(sel);
const spriteFile = (key) => MANIFEST.sprites[key]?.file;
const iconFile = (key) => MANIFEST.icons[key]?.file;
const UNIT_PORTRAIT = { villager: 'vil_idle', militia: 'mil_idle', archer: 'arc_idle', cavalry: 'cav_idle', ram: 'ram_e', fishingBoat: 'boat_e' };
/** Komut butonlarına sırayla atanan kısayollar (WASD kamera, H/G/L/M/N/B/X/P başka işlere ayrılı) */
const HOTKEYS = ['KeyQ', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyF', 'KeyC', 'KeyV', 'KeyZ', 'KeyJ', 'KeyK'];
const UNIT_DESC = { villager: 'Kaynak toplar, bina inşa eder ve tamir eder.', fishingBoat: 'Balık sürülerinden yiyecek toplar ve tersaneye getirir.' };

function buildingFile(type, tier) {
  if (type === 'farm') return MANIFEST.textures.farm.file;
  type = BUILDINGS[type]?.sprite ?? type;
  for (let t = tier; t >= 0; t--) if (MANIFEST.sprites[`${type}_${t}`]) return MANIFEST.sprites[`${type}_${t}`].file;
  for (let t = tier + 1; t <= 3; t++) if (MANIFEST.sprites[`${type}_${t}`]) return MANIFEST.sprites[`${type}_${t}`].file;
  return spriteFile('foundation');
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
  return 'foundation';
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
      ambBtn: $('#ambBtn'),
      musicBtn: $('#musicBtn'),
      menuBtn: $('#menuBtn'),
      fps: $('#fps'),
      sfxBtn: $('#sfxBtn'),
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
    this.el.ambBtn.addEventListener('click', () => this.toggleAmbient());
    this.el.musicBtn.addEventListener('click', () => this.toggleMusic());
    this.el.menuBtn.addEventListener('click', () => { game.click(); game.menu?.openPause(); });
    this.el.sfxBtn.addEventListener('click', () => this.toggleSfx());
    this.el.panelToggle.addEventListener('click', () => this.togglePanel());
    $('#helpClose')?.addEventListener('click', () => this.toggleHelp(false));
    this.el.dayBtn.addEventListener('click', () => this.cycleDayNight());
    this.el.helpBtn.addEventListener('click', () => { game.click(); this.toggleHelp(); });
    // İlk açılışta görünür; sonra kullanıcının son tercihi hatırlanır
    this.toggleHelp(readPref('mi_help') !== 'closed');
    this.el.cmds.addEventListener('mousemove', (e) => this._hoverCmd(e));
    this.el.cmds.addEventListener('mouseleave', () => { this.el.tooltip.style.display = 'none'; });
    this._applyPanelState(localStorage.getItem('mi_panel') === 'collapsed');
    this._renderSoundBtn();
  }

  // ───────────── Alt panel gizle/göster ─────────────
  togglePanel() {
    this.game.click();
    this._applyPanelState(!document.body.classList.contains('panel-collapsed'));
  }

  _applyPanelState(collapsed) {
    document.body.classList.toggle('panel-collapsed', collapsed);
    this.el.panelToggle.title = collapsed ? 'Menüyü göster (F2)' : 'Menüyü gizle (F2)';
    localStorage.setItem('mi_panel', collapsed ? 'collapsed' : 'open');
    this.el.tooltip.style.display = 'none';
  }

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

  _renderSoundBtn() {
    const a = this.game.audio;
    const amb = a?.ambientOn ?? true, sfx = a?.sfxOn ?? true;
    this.el.ambBtn.classList.toggle('off', !amb);
    this.el.ambBtn.title = amb ? 'Atmosfer sesini kapat (N)' : 'Atmosfer sesini aç (N)';
    const mus = a?.musicOn ?? true;
    this.el.musicBtn.classList.toggle('off', !mus);
    this.el.musicBtn.title = mus ? 'Müziği kapat (B)' : 'Müziği aç (B)';
    this.el.sfxBtn.classList.toggle('off', !sfx);
    this.el.sfxBtn.title = sfx ? 'Olay seslerini kapat (M)' : 'Olay seslerini aç (M)';
  }

  // ───────────── Her UI tick'i ─────────────
  update() {
    const w = this.game.world, p = w.player;
    for (const r of RESOURCE_TYPES) this.el.res[r].textContent = Math.floor(p.resources[r]);
    this.el.pop.textContent = `${p.population}/${p.popCap}`;
    this.el.popBox.classList.toggle('full', p.population >= p.popCap);
    this.el.ageName.textContent = p.ageDef.name;

    let ageItem = null;
    for (const b of w.buildings) if (b.owner === PLAYER) for (const q of b.queue) if (q.kind === 'age') ageItem = q;
    this.el.ageBox.classList.toggle('researching', !!ageItem);
    this.el.ageProg.style.width = ageItem ? `${(1 - ageItem.remaining / ageItem.total) * 100}%` : '0%';

    // Düşman dalga sayacı
    const ai = w.enemyAI;
    if (ai.enabled && w.isAlive(ai.tc)) {
      this.el.waveBox.classList.remove('hidden');
      this.el.waveText.textContent = ai.wave === 0 ? `İlk saldırı ${fmtTime(ai.countdown)}` : `Dalga ${ai.wave + 1}: ${fmtTime(ai.countdown)}`;
      this.el.waveBox.classList.toggle('soon', ai.countdown < 30);
    } else this.el.waveBox.classList.add('hidden');

    const idle = w.units.filter((u) => u.owner === PLAYER && u.type === 'villager' && u.state === 'idle').length;
    this.el.idleCount.textContent = idle;
    this.el.idleBtn.classList.toggle('has', idle > 0);

    this._updatePending();
    this._renderDayNight();

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
        li.innerHTML = `<img src="${buildingFile(b.type, tier)}" alt=""><div class="nm"><span>${b.name}</span><em></em></div><div class="pb"><i></i></div>`;
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
    const base = `${p.age}|${p.techs.size}|`;
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
    const enemy = a.owner === ENEMY;
    let img, title;
    if (a.isUnit) {
      img = enemy ? enemyPortrait(g.sprites, UNIT_PORTRAIT[a.type]) : spriteFile(UNIT_PORTRAIT[a.type]);
      const same = sel.every((u) => u.type === a.type);
      title = sel.length > 1 ? `${same ? a.name : 'Birlik'} × ${sel.length}` : a.name;
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
        <div class="title">${title}${enemy ? ' <span class="foe">Düşman</span>' : ''}</div>
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
        const icon = q.kind === 'unit' ? spriteFile(UNIT_PORTRAIT[q.id]) : q.kind === 'age' ? iconFile('age') : iconFile(TECHS[q.id].icon);
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
        if (a.carry > 0.5) l2 = `${ICON(a.carryType)} Taşıyor: ${Math.floor(a.carry)} ${RESOURCE_NAMES[a.carryType].toLowerCase()}`;
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
      else if (a.type === 'farm') l1 = `${ICON('food')} Kalan yiyecek: ${Math.ceil(a.food)}`;
      else if (a.def.attack) l1 = `<span class="st">${ICON('swords')}${a.def.attack.damage}</span><span class="st">${ICON('quiver')}${a.def.attack.range}</span> Menzildeki düşmana ok atar`;
      else if (a.def.income) {
        const m = g.world.players[a.owner].modifiers.fish ?? 1;
        l1 = `${ICON('food')} Balıkçılar: +${Math.round(a.def.income.food * m * 60)} yiyecek/dk · Kabul eder: ${a.def.dropsite.map((x) => ICON(x)).join(' ')}`;
      } else if (a.def.dropsite) l1 = `Kabul eder: ${a.def.dropsite.map((x) => ICON(x)).join(' ')}`;
      else if (a.def.popProvided) l1 = `${ICON('pop')} Nüfus +${a.def.popProvided}`;
      const q = a.owner === PLAYER ? a.queue[0] : null;
      if (q) {
        const name = q.kind === 'unit' ? UNITS[q.id].name : q.kind === 'age' ? g.world.player.nextAge?.name ?? '' : TECHS[q.id].name;
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
      if (sel.some((u) => u.type === 'villager')) {
        for (const type of BUILD_MENU) {
          const def = BUILDINGS[type];
          specs.push({
            img: buildingFile(type, tier), cls: type === 'farm' ? 'farm' : '', label: def.name, title: def.name,
            cost: def.cost, time: def.buildTime, desc: def.desc,
            check: () => w.checkBuildable(type), onClick: () => g.startPlacement(type),
          });
        }
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
          desc: 'Yeni binalar ve teknolojiler açılır; tüm binalarınızın görünümü yeni çağa geçer.',
          check: () => w.checkQueue(a, 'age'), onClick: () => w.enqueue(a, 'age'),
        });
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
    }
    this.el.cmds.innerHTML = '';
    if (!specs.length && a) {
      let hint = '';
      if (a.owner === ENEMY) hint = 'Düşman birimi. Askerlerinizi seçip sağ tıklayarak saldırın.';
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
