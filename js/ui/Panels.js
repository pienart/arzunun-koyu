import { MANIFEST } from '../../assets/manifest.js';
import { HW, HH } from '../render/iso.js';
import { BUILDINGS, TECHS, TECH_CATEGORIES, ITEMS, AGES, PLAYER } from '../data/gameData.js';

const $ = (s) => document.querySelector(s);
const iconFile = (k) => MANIFEST.icons[k]?.file;
const ICON = (k) => `<img class="ri" src="${iconFile(k)}" alt="">`;
const costHtml = (cost, p) => Object.entries(cost ?? {}).map(([k, v]) => `<span class="${p.resources[k] < v ? 'miss' : ''}">${ICON(k)}${v}</span>`).join(' ');

/**
 * Seçime bağlı yüzen panel (alt menünün üstünde):
 *  • Kasaba Merkezi : binalarınızın sayısı (tıkla → sıradaki o binaya git ve seç) + sonraki çağın şartları
 *                     (eksik binaya tıkla → uygunsa Kasaba Merkezi yakınında inşaat başlar)
 *  • Bilim Merkezi  : başlıklara ayrılmış ARAŞTIRMA AĞACI (Köy · Ordu · Sağlık · Savunma); düğüme tıkla → araştır
 * İçerik 0,3 sn'de bir yeniden üretilir; yalnızca HTML değiştiyse DOM'a yazılır.
 */
export class SidePanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = $('#xpanel');
    this.tab = 'village';
    this._cycle = {};
    this._t = 0;
    this._html = '';
    this.el.addEventListener('click', (e) => this._click(e));
    this.el.addEventListener('mousemove', (e) => this._hover(e));
    this.el.addEventListener('mouseleave', () => ui._hideTip());
  }

  get target() {
    const a = this.game.selection[0];
    if (this.game.selection.length !== 1 || !a?.isBuilding || a.owner !== PLAYER || !a.complete) return null;
    return a.type === 'townCenter' || a.def.research ? a : null;
  }

  update(dt) {
    const b = this.target;
    this.el.classList.toggle('hidden', !b);
    if (!b) { this._html = ''; return; }
    this._t -= dt;
    if (this._t > 0 && this._for === b) return;
    this._t = 0.3;
    this._for = b;
    const html = b.type === 'townCenter' ? this._tcHtml(b) : this._treeHtml(b);
    if (html !== this._html) { this._html = html; this.el.innerHTML = html; }
  }

  // ───────────── Kasaba Merkezi ─────────────
  _tcHtml() {
    const w = this.game.world, p = w.player, tier = p.tier;
    const counts = new Map();
    for (const b of w.buildings) if (b.owner === PLAYER && !b.def.ground && !b.def.wall) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) =>
      `<button class="bc" data-goto="${type}" data-tip="${BUILDINGS[type].name}: tıkla → sıradakine git ve seç"><img src="${this.ui.buildingImg(type, tier)}" alt=""><span>${BUILDINGS[type].name}</span><b>${n}</b></button>`).join('');
    const r = w.ageReq(PLAYER);
    let req = '<div class="sub">Son çağdasınız.</div>';
    if (r.age) {
      const ok = (v) => (v ? '<i class="ok">✓</i>' : '<i class="no">✗</i>');
      const res = p.canAfford(r.age.cost);
      req = `<div class="req ${r.military.have >= r.military.need ? 'done' : ''}">${ICON('swords')}<span>Asker</span><b>${r.military.have}/${r.military.need}</b>${ok(r.military.have >= r.military.need)}</div>` +
        r.buildings.map((x) => {
          const okB = x.have >= x.need;
          const err = okB ? '' : w.checkBuildable(x.type);
          return `<button class="req ${okB ? 'done' : 'todo'}" ${okB ? '' : `data-build="${x.type}"`} data-tip="${okB ? 'Tamam' : err ? `Kurulamıyor: ${err}` : 'Tıkla → yerleştirme modu: yerini haritada siz seçin (boştaki köylü inşa eder)'}">` +
            `<img src="${this.ui.buildingImg(x.type, tier)}" alt=""><span>${BUILDINGS[x.type].name}</span><b>${x.have}/${x.need}</b>${ok(okB)}</button>`;
        }).join('') +
        `<div class="req ${res ? 'done' : ''}">${ICON('age')}<span>Bedel</span><b class="cost">${costHtml(r.age.cost, p)}</b>${ok(res)}</div>`;
    }
    return `<button class="xclose" data-close title="Kapat">×</button>
      <div class="cols"><section><h4>Binalarınız</h4><div class="bcs">${rows || '<div class="sub">Henüz bina yok.</div>'}</div></section>
      <section><h4>${r.age ? `Sonraki çağ: ${r.age.name}` : 'Çağ'}</h4><div class="reqs">${req}</div></section></div>`;
  }

  // ───────────── Araştırma ağacı ─────────────
  _treeHtml(b) {
    const w = this.game.world, p = w.player;
    const tabs = TECH_CATEGORIES.map((c) => {
      const all = Object.values(TECHS).filter((t) => t.cat === c.id);
      const done = Object.entries(TECHS).filter(([id, t]) => t.cat === c.id && p.techs.has(id)).length;
      return `<button class="tab ${c.id === this.tab ? 'on' : ''}" data-tab="${c.id}">${c.name} <small>${done}/${all.length}</small></button>`;
    }).join('');
    const ids = Object.keys(TECHS).filter((id) => TECHS[id].cat === this.tab);
    // Kökler (ön koşulsuz) ve her kökten aşağı zincir
    const roots = ids.filter((id) => !TECHS[id].requires || TECHS[TECHS[id].requires].cat !== this.tab);
    const chain = (id) => { const out = [id]; let cur = id; for (;;) { const nx = ids.find((k) => TECHS[k].requires === cur); if (!nx) break; out.push(nx); cur = nx; } return out; };
    const node = (id) => {
      const t = TECHS[id];
      const researching = w.buildings.some((o) => o.owner === PLAYER && o.queue.some((q) => q.kind === 'tech' && q.id === id));
      const err = w.checkQueue(b, 'tech', id);
      const st = p.techs.has(id) ? 'done' : researching ? 'busy' : !err ? 'avail' : err === 'Yetersiz kaynak' ? 'poor' : 'locked';
      const tip = st === 'done' ? 'Araştırıldı' : st === 'busy' ? 'Araştırılıyor…' : err ?? 'Tıkla → araştır';
      return `<button class="tnode ${st}" data-tech="${id}" data-tip="${t.desc} — ${tip}"><img src="${iconFile(t.icon)}" alt=""><span class="nm">${t.name}</span>` +
        `<span class="ag">${AGES[t.age].short}</span>${st === 'done' ? '<i class="ok">✓</i>' : `<span class="cost">${costHtml(t.cost, p)}</span>`}</button>`;
    };
    const cols = roots.map((r) => `<div class="chain">${chain(r).map(node).join('<div class="arrow">↓</div>')}</div>`).join('');
    return `<button class="xclose" data-close title="Kapat">×</button><div class="tabs">${tabs}</div><div class="tree">${cols}</div>`;
  }

  _click(e) {
    const g = this.game, w = g.world, el = e.target.closest('button');
    if (!el) return;
    g.click();
    if (el.dataset.close !== undefined) { g.select([]); this.ui.closePanel(); return; }
    if (el.dataset.tab) { this.tab = el.dataset.tab; this._t = 0; this.update(0); return; }
    if (el.dataset.tech) {
      const err = w.checkQueue(this.target, 'tech', el.dataset.tech);
      if (err) this.ui.toast(err, 'warn'); else w.enqueue(this.target, 'tech', el.dataset.tech);
      this._t = 0; this.ui._sig = null; return;
    }
    if (el.dataset.build) { // yerleştirme modu: yeri oyuncu seçer; inşaata en yakın boştaki (yoksa herhangi) köylü gider
      const type = el.dataset.build, err = w.checkBuildable(type);
      if (err) { this.ui.toast(err, 'warn'); return; }
      const tc = this.target, vs = w.units.filter((u) => u.owner === PLAYER && u.def.builder);
      if (!vs.length) { this.ui.toast('İnşa edecek köylü yok.', 'warn'); return; }
      const idle = vs.filter((u) => u.state === 'idle'), pool = idle.length ? idle : vs;
      pool.sort((p, q) => Math.hypot(p.x - tc.centerI, p.y - tc.centerJ) - Math.hypot(q.x - tc.centerI, q.y - tc.centerJ));
      g.select([pool[0]]);
      g.startPlacement(type);
      this.ui.toast(`${BUILDINGS[type].name}: yerini haritada seçin (Esc iptal).`, 'info');
      return;
    }
    if (el.dataset.goto) {
      const list = w.buildings.filter((b) => b.owner === PLAYER && b.type === el.dataset.goto);
      if (!list.length) return;
      const k = (this._cycle[el.dataset.goto] = ((this._cycle[el.dataset.goto] ?? -1) + 1) % list.length);
      const b = list[k];
      g.select([b]);
      g.camera.centerOn((b.centerI - b.centerJ) * HW, (b.centerI + b.centerJ) * HH + 40);
    }
  }

  _hover(e) {
    const el = e.target.closest('[data-tip]');
    if (el) this.ui._tip(`<div>${el.dataset.tip}</div>`, e, false); else this.ui._hideTip();
  }
}

/**
 * Envanter (simya iksirleri): üst barın altında küçük ikonlar; sayı rozeti, etkin iksirde kalan süre.
 * Tıkla → iksiri kullan.
 */
export class Inventory {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = $('#items');
    this._html = '';
    this.el.addEventListener('click', (e) => {
      const id = e.target.closest('[data-item]')?.dataset.item;
      if (!id) return;
      this.game.click();
      this.game.world.useItem(id);
    });
    this.el.addEventListener('mousemove', (e) => {
      const id = e.target.closest('[data-item]')?.dataset.item;
      if (id) this.ui._tip(`<b>${ITEMS[id].name}</b><div>${ITEMS[id].desc}</div><div class="sub">Tıkla → kullan</div>`, e, true); else ui._hideTip();
    });
    this.el.addEventListener('mouseleave', () => ui._hideTip());
  }

  update() {
    const w = this.game.world, p = w.player;
    const ids = Object.keys(ITEMS).filter((id) => (p.items[id] ?? 0) > 0 || (p.effects[id] ?? 0) > w.time);
    const html = ids.map((id) => {
      const left = Math.ceil((p.effects[id] ?? 0) - w.time);
      return `<button class="it ${left > 0 ? 'active' : ''}" data-item="${id}"><img src="${iconFile(ITEMS[id].icon)}" alt="">` +
        `${p.items[id] ? `<b>${p.items[id]}</b>` : ''}${left > 0 ? `<em>${left}s</em>` : ''}</button>`;
    }).join('');
    this.el.classList.toggle('hidden', !ids.length);
    if (html !== this._html) { this._html = html; this.el.innerHTML = html; }
  }
}

