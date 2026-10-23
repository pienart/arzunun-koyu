import { CONFIG } from '../config.js';
import { MANIFEST } from '../../assets/manifest.js';
import { BUILDINGS, PLAYER, ENEMY } from '../data/gameData.js';
import { AudioManager } from '../audio/AudioManager.js';
import { World } from '../systems/World.js';
import { Camera } from '../render/Camera.js';
import { Renderer } from '../render/Renderer.js';
import { SpriteFactory } from '../render/SpriteFactory.js';
import { HW, HH, worldToTile } from '../render/iso.js';
import { TileId } from '../world/TileTypes.js';
import { InputHandler } from './InputHandler.js';
import { UIManager } from '../ui/UIManager.js';
import { Minimap } from '../ui/Minimap.js';
import { DayNight } from '../systems/DayNight.js';
import { Fog } from '../systems/Fog.js';
import { SaveGame } from '../systems/SaveGame.js';
import { Settings } from '../systems/Settings.js';

const AUTOSAVE_EVERY = 120; // sn

/**
 * Game: kompozisyon kökü. Sistemleri kurar, girdileri komutlara çevirir ve döngüyü yönetir.
 *
 *  ┌ InputHandler ─▶ Game (seçim / komut / yerleştirme) ─▶ World (kurallar, 20 Hz sabit adım)
 *  └ UIManager (DOM) ◀─────── World durumu ───────▶ Renderer (canvas) + Minimap
 *
 * opts: { seed, difficulty, fog, save }  — save verilirse oyun kayıttan kurulur (SaveGame.apply).
 */
export class Game {
  constructor(assets, opts = {}) {
    this.canvas = document.getElementById('game');
    const save = opts.save ?? null;
    this.world = new World({ seed: save?.seed ?? opts.seed, difficulty: save?.difficulty ?? opts.difficulty, save });
    if (save) SaveGame.apply(this.world, save);
    this.fog = new Fog(this.world.map, save ? save.fog !== false : opts.fog !== false);
    if (save) this.fog.restore(save.world.explored);
    this.world.fog = this.fog;
    this.camera = new Camera(this._worldBounds());
    this.sprites = new SpriteFactory(assets, MANIFEST);
    this.renderer = new Renderer(this.canvas, this.world, this.camera, this.sprites);
    this.input = new InputHandler(this.canvas, this.camera);
    this._setupTouch();
    this.audio = new AudioManager(MANIFEST.sounds, this.camera);
    this.audio.init();
    // Tarayıcılar sesi ancak bir kullanıcı etkileşiminden sonra başlatmaya izin verir
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.dayNight = new DayNight();
    this.ui = new UIManager(this);
    this.minimap = new Minimap(document.getElementById('minimap'), this);

    this.selection = [];
    this.selectedSet = new Set();
    this.placement = null;   // { type, oi, oj, valid, line? }
    this.cmdMarker = null;
    this.groups = Array.from({ length: 10 }, () => []); // Ctrl+0–9 kontrol grupları
    this._groupTap = { n: -1, t: 0 };
    this.paused = false;
    this.menu = null;        // main.js bağlar (duraklatma menüsü)
    this.time = 0;
    this._acc = 0;
    this._lastTs = 0;
    this._uiTimer = 0;
    this._autoT = AUTOSAVE_EVERY;
    this._fps = { frames: 0, time: 0, value: 0 };
    this._idleIndex = 0;
    this._victoryShown = false;
    this._defeatShown = false;
    this._fresh = !save;

    this.input.onLeftClick = (x, y, e) => this._onLeftClick(x, y, e);
    this.input.onDoubleClick = (x, y, e) => this._onDoubleClick(x, y, e);
    this.input.onRightClick = (x, y, e) => this._onRightClick(x, y, e);
    this.input.onBoxSelect = (box, e) => this._onBoxSelect(box, e);
    this.input.onKeyPress = (code, e) => this._onKey(code, e);

    window.addEventListener('resize', () => this._resize());
    Settings.onChange((path) => { if (path === 'quality') this._resize(); });
    this._resize();
    // Uzak zoom için tüm haritanın zemini bir kez çizilir (yükleme ekranı hâlâ görünürken)
    this.renderer.buildOverview();
    if (save?.camera) { this.camera.zoom = this.camera.targetZoom = save.camera.zoom; this.camera.x = save.camera.x; this.camera.y = save.camera.y; this.camera.clamp(); }
    else this.focusTownCenter();
    this.fog.update(1, this.world);
    this.ui.update();
    this.ui.toast(save ? 'Kayıtlı oyun yüklendi.' : 'Köylülerinizi seçip sağ tıkla kaynaklara gönderin!', 'info');
    this._loop = this._loop.bind(this);
  }

  /**
   * Dokunmatik cihaz: ilk dokunuşta (veya kaba işaretçili cihazda açılışta) mobil düzen + dokunmatik araç çubuğu.
   *  Kutu  : tek parmak sürükleme seçim kutusu çizer (kapalıyken haritayı kaydırır)
   *  Komut : dokunuş komut olur (uzun basmaya gerek kalmaz)
   *  İptal : yerleştirmeyi iptal et / seçimi kaldır
   */
  _setupTouch() {
    const bar = document.getElementById('touchbar');
    const on = () => {
      if (document.body.classList.contains('touch')) return;
      document.body.classList.add('touch');
      this.ui?.toggleHelp(false);
    };
    this.input.onTouchDetected = on;
    if (window.matchMedia?.('(pointer: coarse)').matches) on();
    this._touchBoxUser = false;
    bar?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      this.click();
      if (b.dataset.t === 'box') { this._touchBoxUser = !this._touchBoxUser; b.classList.toggle('on', this._touchBoxUser); }
      else if (b.dataset.t === 'cmd') { this.input.touchCommand = !this.input.touchCommand; b.classList.toggle('on', this.input.touchCommand); }
      else if (b.dataset.t === 'cancel') { if (this.placement) this.placement = null; else { this.select([]); this.ui.closePanel(); } }
    });
  }

  /**
   * Kamera sınırı = kara parçasının (su olmayan karoların) dünya dikdörtgeni + küçük pay. Böylece kamera denize
   * kaçmaz ve en uzak zoom karayı ekrana sığdırır (haritanın dışındaki açık deniz görünmez).
   */
  _worldBounds() {
    const map = this.world.map;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < map.height; j++) {
      const row = map.terrain[j];
      for (let i = 0; i < map.width; i++) {
        if (row[i] === TileId.WATER) continue;
        const x = (i - j) * HW, y = (i + j) * HH;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (minX === Infinity) {
      const { MAP_WIDTH: W, MAP_HEIGHT: H } = CONFIG;
      return { minX: -H * HW, maxX: W * HW, minY: -HH, maxY: (W + H - 1) * HH };
    }
    const P = HW * 2;
    return { minX: minX - P, maxX: maxX + P, minY: minY - P - 80, maxY: maxY + P };
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
    this.camera.setViewport(r.width, r.height);
    this.minimap.resize();
  }

  focusTownCenter() {
    const tc = this.world.townCenter;
    if (!tc) return;
    // Alt panel ekranın altını kapattığı için merkezi biraz yukarı kaydır
    this.camera.centerOn((tc.centerI - tc.centerJ) * HW, (tc.centerI + tc.centerJ) * HH + 40);
  }

  /** Yükleme ekranı solarken köye uzaktan yumuşakça yaklaş */
  introZoom() {
    const tc = this.world.townCenter;
    if (!tc) return;
    this.camera.introZoom((tc.centerI - tc.centerJ) * HW, (tc.centerI + tc.centerJ) * HH + 40, 0.62, 1.2, 2.2, 0.35);
  }

  // ═════════════════════ DÖNGÜ ═════════════════════
  start() {
    if (this._fresh) this.introZoom();
    this.sprites.prewarm();
    requestAnimationFrame((ts) => {
      this._lastTs = ts;
      requestAnimationFrame(this._loop);
    });
  }

  /**
   * Kare döngüsü. Sonraki kare HER ZAMAN önce istenir ve kare içindeki hata yakalanır: tek bir hata eskiden döngüyü
   * kalıcı olarak durduruyordu (ekran donuk, düğmeler ses çıkarmaya devam ediyordu). Artık oyun sürer, hata bir kez
   * ekranda bildirilir ve konsola yazılır.
   */
  _loop(ts) {
    requestAnimationFrame(this._loop);
    const dt = Math.min((ts - this._lastTs) / 1000, 0.1);
    this._lastTs = ts;
    try {
      this.update(dt);
      this.render();
    } catch (err) {
      console.error('[Arzu\'nun Köyü] Kare hatası:', err);
      const msg = `${err?.message ?? err}`;
      if (this._lastErr !== msg) {
        this._lastErr = msg;
        this.ui?.toast(`Bir hata oluştu ama oyun devam ediyor: ${msg}`, 'warn');
      }
    }
  }

  setPaused(p) {
    this.paused = p;
    document.body.classList.toggle('paused', p);
  }

  update(dt) {
    this.time += dt;
    this.input.update(dt);
    this.camera.update(dt);
    this.dayNight.update(dt);

    // Sabit adımlı simülasyon (20 Hz). Kare başına en fazla 5 adım: yavaş cihazda "ölüm sarmalı" olmasın
    if (!this.paused) {
      this._acc += dt;
      let steps = 0;
      while (this._acc >= CONFIG.SIM_STEP && steps < 5) {
        this.world.update(CONFIG.SIM_STEP);
        this._acc -= CONFIG.SIM_STEP;
        steps++;
      }
      if (steps === 5) this._acc = 0;
      this.fog.update(dt, this.world, this.dayNight.darkness);
      this._autosave(dt);
    }

    this._updatePlacement();
    this._pruneSelection();
    this._hoverT = (this._hoverT ?? 0) - dt;
    const m = this.input.mouse;
    if (this._hoverT <= 0 && !this.input.drag && !this.placement && m.inside && !this.input.isTouch) {
      this._hoverT = 0.15;
      const r = this.canvas.getBoundingClientRect();
      this.ui.hoverWorld(this.pickAt(m.x, m.y), { clientX: m.x + r.left, clientY: m.y + r.top });
    }

    for (const ev of this.world.events.splice(0)) this.ui.toast(ev.text, ev.kind);
    for (const sn of this.world.sounds.splice(0)) this.audio.play(sn.name, sn.i, sn.j, sn.vol);
    this._updateAudioEnv();
    // Oyun bitti (zafer ya da yenilgi): tüm kayıtlar silinir → menüde "Devam Et" çıkmaz, her şey sıfırdan başlar
    if (this.world.victory && !this._victoryShown) { this._victoryShown = true; SaveGame.clear(); this.ui.showVictory(); }
    if (this.world.defeat && !this._defeatShown) { this._defeatShown = true; SaveGame.clear(); this.ui.showDefeat(); }

    this._uiTimer += dt;
    if (this._uiTimer >= CONFIG.UI_INTERVAL) {
      this._uiTimer = 0;
      this.ui.update();
      this.minimap.draw(this.time);
    }
    const f = this._fps;
    f.frames++; f.time += dt;
    if (f.time >= 0.5) {
      f.value = Math.round(f.frames / f.time); f.frames = 0; f.time = 0;
      const s = this.renderer.stats;
      this.ui.updateDebug(
        `FPS ${f.value} · Zoom ${this.camera.zoom.toFixed(2)}x\n` +
        `Statik çizim #${s.staticRedraws} (${s.staticMs.toFixed(1)} ms, ${s.objects} nesne)\n` +
        `Su ${s.waterMs.toFixed(2)} ms · Dinamik ${s.dynMs.toFixed(2)} ms · Genel bakış ${(s.overviewMs ?? 0).toFixed(0)} ms\n` +
        `Birim ${this.world.units.length} · Bina ${this.world.buildings.length} · Ok ${this.world.projectiles.length}`);
      this.ui.updateFps(f.value);
    }
  }

  /** Atmosfer/müzik: karanlık, hava, kamp ateşine uzaklık ve son çatışma */
  _updateAudioEnv() {
    const w = this.world, cam = this.camera;
    const c = cam.screenToWorld(cam.viewW / 2, cam.viewH / 2);
    const ci = (c.y / HH + c.x / HW) / 2, cj = (c.y / HH - c.x / HW) / 2;
    const cf = w.campfire;
    this.audio.updateEnvironment({
      darkness: this.dayNight.darkness, weatherKind: w.weather.kind, weatherIntensity: w.weather.intensity,
      season: w.weather.season.id, campfireDist: cf ? Math.hypot(cf.i - ci, cf.j - cj) / Math.max(0.5, cam.zoom) : 99,
      combat: w.time - w.lastCombatAt < 14 && !w.victory && !w.defeat,
    });
  }

  _autosave(dt) {
    if (!Settings.data.autosave || this.world.victory || this.world.defeat) return;
    this._autoT -= dt;
    if (this._autoT > 0) return;
    this._autoT = AUTOSAVE_EVERY;
    if (SaveGame.save(this, true)) this.ui.toast('Otomatik kayıt alındı.', 'info');
  }

  saveGame() {
    if (this.world.victory || this.world.defeat) { this.ui.toast('Oyun bitti: kayıt yapılamaz.', 'warn'); return false; }
    const ok = SaveGame.save(this, false);
    this.ui.toast(ok ? 'Oyun kaydedildi.' : 'Kayıt başarısız (tarayıcı belleği kapalı veya dolu).', ok ? 'good' : 'warn');
    return ok;
  }

  render() {
    this.renderer.render({
      time: this.time,
      alpha: this.paused ? 1 : this._acc / CONFIG.SIM_STEP,
      selected: this.selectedSet,
      placement: this.placement,
      box: this.placement ? null : this.input.box,
      cmdMarker: this.cmdMarker,
      darkness: this.dayNight.darkness,
      moon: this.dayNight.moonProgress(this.time),
    });
  }

  // ═════════════════════ SEÇİM ═════════════════════
  select(list) {
    this.selection = list;
    this.selectedSet = new Set(list);
    this.ui?._syncPanel(); // alt menü seçimle anında açılır/kapanır
  }

  /** Arayüz tıklama sesi */
  click() { this.audio.play('click'); }

  get myUnits() { return this.selection.filter((s) => s.isUnit && s.owner === PLAYER); }

  _pruneSelection() {
    const w = this.world;
    const alive = this.selection.filter((e) => w.isAlive(e) && (e.owner === PLAYER || !e.isUnit || this.fog.isVisible(e.x, e.y)));
    if (alive.length !== this.selection.length) this.select(alive);
  }

  /** Ekran noktasındaki varlık: önce birimler, sonra sprite'lar (piksel hassas), en son karo. Sis gizlediğini vermez. */
  pickAt(sx, sy, { units = true } = {}) {
    const w = this.camera.screenToWorld(sx, sy);
    if (units) {
      const u = this.renderer.pickUnit(w.x, w.y);
      if (u) return u;
    }
    const known = (o) => o && (o.owner === PLAYER || this.fog.knowsObject(o.isBuilding ? o : { originI: o.i, originJ: o.j, i: o.i, j: o.j }));
    const o = this.renderer.pickObject(w.x, w.y);
    if (o && known(o)) return o;
    const t = worldToTile(w.x, w.y);
    const occ = this.world.map.getObjectAt(t.i, t.j);
    if (occ && (occ.isBuilding || occ.isResource) && known(occ)) return occ;
    return null;
  }

  _onLeftClick(sx, sy, e) {
    if (this.placement) { this._tryPlace(e.shiftKey); return; }
    const ent = this.pickAt(sx, sy);
    // Boşluğa tıklama: seçim kalkar ve alt panel kapanır (sabitlenmiş olsa da)
    if (!ent) { if (!e.shiftKey) { this.select([]); this.ui?.closePanel(); } return; }
    if (ent.isUnit && ent.owner === PLAYER && e.shiftKey && this.selection.every((s) => s.isUnit && s.owner === PLAYER)) {
      const set = new Set(this.selection);
      set.has(ent) ? set.delete(ent) : set.add(ent);
      this.select([...set]);
    } else {
      this.select([ent]);
    }
  }

  /** Çift tık: ekrandaki aynı türden tüm kendi birimlerini seç */
  _onDoubleClick(sx, sy, e) {
    if (this.placement) { this._onLeftClick(sx, sy, e); return; }
    const ent = this.pickAt(sx, sy);
    if (ent?.isUnit && ent.owner === PLAYER) this.select(this.renderer.unitRects.map((r) => r.u).filter((u) => u.owner === PLAYER && u.type === ent.type));
    else this._onLeftClick(sx, sy, e);
  }

  _onBoxSelect(box, e) {
    if (this.placement && BUILDINGS[this.placement.type].line) { this._placeWallLine(); return; }
    if (this.placement) return;
    const a = this.camera.screenToWorld(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
    const b = this.camera.screenToWorld(Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));
    const picked = this.renderer.unitRects
      .filter((r) => r.u.owner === PLAYER && r.x + r.w > a.x && r.x < b.x && r.y + r.h > a.y && r.y < b.y)
      .map((r) => r.u);
    if (e.shiftKey) this.select([...new Set([...this.myUnits, ...picked])]);
    else if (picked.length) this.select(picked);
  }

  // ═════════════════════ KOMUTLAR ═════════════════════
  _onRightClick(sx, sy) {
    if (this.placement) { this.placement = null; return; }
    const w = this.camera.screenToWorld(sx, sy);
    const t = worldToTile(w.x, w.y);
    const units = this.myUnits;
    const world = this.world;

    if (units.length) {
      const ent = this.pickAt(sx, sy, { units: true });
      const villagers = units.filter((u) => u.def.gatherer || u.def.builder || u.def.decorBuilder); // köylü, araba, mimar
      const boats = units.filter((u) => u.naval);
      const soldiers = units.filter((u) => u.isMilitary);
      let color = 'rgba(120,255,120,0.9)';
      if (ent && ent.owner && ent.owner !== PLAYER) { // düşman veya yaratık
        // Düşmana sağ tık → tüm seçili savaşanlar saldırır
        world.commandAttack(units, ent);
        color = 'rgba(255,70,60,0.95)';
      } else if (ent?.isBuilding && ent.owner === PLAYER && ent.def.troops && ent.complete && soldiers.length) {
        world.commandTent(soldiers, ent); // askerler otağa girer
        world.commandMove(units.filter((u) => !u.isMilitary), ent.i + 1, ent.j + 1);
        color = 'rgba(255,220,90,0.95)';
      } else if (ent?.isUnit && ent.owner === PLAYER && ent.def.transport) {
        world.commandBoard(units.filter((u) => u !== ent), ent); // askerler savaş arabasına biner
      } else if (ent?.isResource) {
        world.commandGather(villagers, ent);
        if (ent.kind === 'fish') world.commandFish(boats, ent);
        else if (boats.length) world.commandMove(boats, ent.i, ent.j);
        if (soldiers.length) world.commandMove(soldiers, ent.i + 1, ent.j + 1);
      } else if (ent?.isBuilding && ent.owner === PLAYER) {
        if (!ent.complete) { world.commandBuild(villagers, ent); world.commandMove(villagers.filter((u) => !world.canBuild(u, ent.type)), ent.i + 1, ent.j + 1); }
        else if (ent.def.farmFood) world.commandGather(villagers, ent);
        else if (world.needsRepair(ent)) world.commandRepair(villagers.filter((u) => u.def.builder), ent);
        else if (ent.def.dropsite && villagers.some((u) => u.carry > 0)) world.commandDeposit(villagers, ent);
        else world.commandMove(villagers, ent.i + 1, ent.j + 1);
        if (soldiers.length) world.commandMove(soldiers, ent.i + 1, ent.j + 1);
        if (boats.length) world.commandMove(boats, ent.i + 1, ent.j + 1);
        color = 'rgba(255,220,90,0.95)';
      } else if (world.map.inBounds(t.i, t.j)) {
        world.commandMove(units, t.i, t.j);
      }
      this.cmdMarker = { x: w.x, y: w.y, t: this.time, color };
      return;
    }
    const b = this.selection[0];
    if (b?.isBuilding && b.owner === PLAYER && b.def.trains && b.complete) {
      const ent = this.pickAt(sx, sy, { units: false });
      b.rally = ent && (ent.isResource || ent.isBuilding) ? { target: ent } : { i: t.i, j: t.j };
      this.cmdMarker = { x: w.x, y: w.y, t: this.time, color: 'rgba(90,170,255,0.95)' };
    }
  }

  commandMoveToTile(i, j) {
    const units = this.myUnits;
    if (units.length && this.world.map.inBounds(i, j)) this.world.commandMove(units, i, j);
  }

  stopSelected() { for (const u of this.myUnits) u.stop(); }

  selectNextIdle() {
    const idle = this.world.units.filter((u) => u.owner === PLAYER && u.type === 'villager' && u.state === 'idle');
    if (!idle.length) { this.ui.toast('Boşta köylü yok.', 'info'); return; }
    const u = idle[this._idleIndex++ % idle.length];
    this.select([u]);
    this.camera.centerOn((u.x - u.y) * HW, (u.x + u.y) * HH + 40);
  }

  /** Köylü butonu menüsü: 'idleAll' boştaki tüm köylüler · 'all' tüm köylüler (kamera yerinde kalır) */
  selectVillagers(onlyIdle) {
    const list = this.world.units.filter((u) => u.owner === PLAYER && u.type === 'villager' && !u.garrisoned && (!onlyIdle || u.state === 'idle'));
    if (!list.length) { this.ui.toast(onlyIdle ? 'Boşta köylü yok.' : 'Köylü yok.', 'info'); return; }
    this.select(list);
  }

  // ═════════════════════ KONTROL GRUPLARI ═════════════════════
  /** Ctrl+N: seçimi gruba ata · Shift+N: gruba ekle · N: grubu seç · N'ye iki kez: kamerayı gruba götür */
  _group(n, e) {
    const mine = this.selection.filter((s) => s.owner === PLAYER);
    if (e.ctrlKey || e.metaKey) {
      this.groups[n] = mine;
      this.ui.toast(mine.length ? `Grup ${n}: ${mine.length} seçili` : `Grup ${n} temizlendi`, 'info');
      return;
    }
    if (e.shiftKey) { this.groups[n] = [...new Set([...this.groups[n], ...mine])]; return; }
    const g = this.groups[n] = this.groups[n].filter((o) => this.world.isAlive(o) || o.garrisoned);
    const live = g.filter((o) => this.world.isAlive(o));
    if (!live.length) return;
    this.select(live);
    const now = performance.now();
    if (this._groupTap.n === n && now - this._groupTap.t < 380) {
      let x = 0, y = 0;
      for (const o of live) { x += o.isUnit ? o.x : o.centerI; y += o.isUnit ? o.y : o.centerJ; }
      x /= live.length; y /= live.length;
      this.camera.centerOn((x - y) * HW, (x + y) * HH + 40);
    }
    this._groupTap = { n, t: now };
  }

  // ═════════════════════ İNŞAAT YERLEŞTİRME ═════════════════════
  /** Bina taşıma: yerleştirme hayaleti binanın türüyle açılır, tıklanan yere taşınır */
  startRelocate(b) {
    this.placement = { type: b.type, relocate: b };
    this.ui.toast(`${b.name}: yeni yerini seçin (Esc iptal).`, 'info');
    this._updatePlacement();
  }

  startPlacement(type) {
    if (!this.myUnits.some((u) => this.world.canBuild(u, type))) return;
    const err = this.world.checkBuildable(type);
    if (err) { this.ui.toast(err, 'warn'); return; }
    this.placement = { type };
    if (BUILDINGS[type].line) this.ui.toast(`${BUILDINGS[type].name}: başlangıç karosundan bitişe sürükleyin.`, 'info');
    this._updatePlacement();
  }

  _updatePlacement() {
    const p = this.placement;
    // Dokunmatik: çit/patika çizerken tek parmak sürükleme hattı çizer
    this.input.touchBox = this._touchBoxUser || !!(p && BUILDINGS[p.type]?.line);
    if (!p) return;
    const def = BUILDINGS[p.type];
    const m = this.input.mouse;
    const w = this.camera.screenToWorld(m.x, m.y);
    const t = worldToTile(w.x, w.y);
    // İmleç ayak izinin ortasında olsun
    p.oi = t.i - Math.floor((def.size - 1) / 2);
    p.oj = t.j - Math.floor((def.size - 1) / 2);
    p.valid = p.relocate ? !this.world.checkPlacement(p.type, p.oi, p.oj, p.relocate) : !this.world.checkPlacement(p.type, p.oi, p.oj) && !this.world.checkBuildable(p.type);
    p.line = null;
    // Çit: sürüklenirken başlangıçtan imlece kadar karo hattı
    const d = this.input.drag;
    if (def.line && d && d.mode === 'box' && d.moved) {
      const a = this.camera.screenToWorld(d.sx, d.sy), s = worldToTile(a.x, a.y);
      p.line = this._wallTiles(s.i, s.j, t.i, t.j).map(({ i, j }) => ({ i, j, ok: !this.world.checkPlacement(p.type, i, j) }));
    }
  }

  /** İki karo arası 4-komşulu hat (çapraz adım yok → çitte delik kalmaz) */
  _wallTiles(i0, j0, i1, j1) {
    const out = [];
    let i = i0, j = j0;
    const di = Math.sign(i1 - i0), dj = Math.sign(j1 - j0), ni = Math.abs(i1 - i0), nj = Math.abs(j1 - j0);
    out.push({ i, j });
    let ei = 0, ej = 0;
    for (let k = 0; k < ni + nj && out.length < 60; k++) {
      // Hangi eksende ilerleme payı daha az kaldıysa oraya adım at (Bresenham benzeri)
      if ((ei + 0.5) / Math.max(ni, 1) < (ej + 0.5) / Math.max(nj, 1) && ei < ni) { i += di; ei++; }
      else if (ej < nj) { j += dj; ej++; } else { i += di; ei++; }
      out.push({ i, j });
    }
    return out;
  }

  _placeWallLine() {
    const p = this.placement;
    if (!p?.line?.length) return;
    const builders = this.myUnits.filter((u) => this.world.canBuild(u, p.type));
    const n = this.world.placeWallLine(p.line, builders, p.type);
    if (n) { this.click(); this.ui.toast(`${n} parça ${BUILDINGS[p.type].name.toLocaleLowerCase('tr')} yerleştirildi.`, 'good'); }
    if (!this.input.keys.has('ShiftLeft') && !this.input.keys.has('ShiftRight')) this.placement = null;
  }

  _tryPlace(keep) {
    const p = this.placement;
    if (!p) return;
    if (p.relocate) {
      if (this.world.relocate(p.relocate, p.oi, p.oj)) { this.click(); this.placement = null; }
      return;
    }
    if (!p.valid) {
      const err = this.world.checkBuildable(p.type) ?? this.world.checkPlacement(p.type, p.oi, p.oj);
      this.ui.toast(err ?? 'Buraya inşa edilemez.', 'warn');
      return;
    }
    const builders = this.myUnits.filter((u) => this.world.canBuild(u, p.type));
    const b = BUILDINGS[p.type].line ? (this.world.placeWallLine([{ i: p.oi, j: p.oj }], builders, p.type) ? true : null) : this.world.placeBuilding(p.type, p.oi, p.oj, builders);
    if (b) this.click();
    // Shift basılıysa yerleştirme modunda kal (art arda ev/çiftlik)
    if (b && !keep) this.placement = null;
  }

  // ═════════════════════ KLAVYE ═════════════════════
  _onKey(code, e) {
    if (this.menu?.isOpen) { if (code === 'Escape' || code === 'F10') this.menu.close(); return; }
    if (code.startsWith('Digit')) { this._group(Number(code.slice(5)), e); return; }
    if (!e.ctrlKey && !e.altKey && this.ui.hotkey(code)) return; // seçime göre komut kısayolları (Q, E, R…)
    switch (code) {
      case 'Escape':
        if (this.placement) this.placement = null;
        else if (this.selection.length) this.select([]);
        else this.menu?.openPause();
        break;
      case 'F10': this.menu?.openPause(); break;
      case 'Pause': case 'KeyP': this.menu ? this.menu.openPause() : this.setPaused(!this.paused); break;
      case 'Period': case 'NumpadDecimal': this.selectNextIdle(); break;
      case 'KeyH': this.select([this.world.townCenter]); this.focusTownCenter(); break;
      case 'KeyO': { // köyün ilk görünümüne yumuşakça dön (ilk zoom)
        const tc = this.world.townCenter;
        if (tc) this.camera.flyTo((tc.centerI - tc.centerJ) * HW, (tc.centerI + tc.centerJ) * HH + 40, 1.2, 1.2);
        break;
      }
      case 'KeyE': { // tüm harita (en dıştan)
        const b = this.camera.bounds;
        this.camera.flyTo((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, this.camera.minZoom, 1.3);
        break;
      }
      case 'KeyG': this.renderer.toggleGrid(); break;
      case 'KeyK': this.ui.toggleMinimap(); break;
      case 'F1': case 'KeyX': this.ui.toggleHelp(); break;
      case 'F2': this.ui.togglePanel(); break;
      case 'KeyM': this.ui.toggleSfx(); break;
      case 'KeyN': this.ui.toggleAmbient(); break;
      case 'KeyB': this.ui.toggleMusic(); break;
      case 'KeyL': this.ui.cycleDayNight(); break;
      case 'F3': this.ui.toggleDebug(); break;
      case 'F5': if (e) e.preventDefault?.(); this.saveGame(); break;
      case 'Equal': case 'NumpadAdd': this.camera.zoomAt(this.camera.viewW / 2, this.camera.viewH / 2, 1.25); break;
      case 'Minus': case 'NumpadSubtract': this.camera.zoomAt(this.camera.viewW / 2, this.camera.viewH / 2, 0.8); break;
      default: break;
    }
  }
}
