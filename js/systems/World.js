import { CONFIG } from '../config.js';
import { BUILDINGS, UNITS, TECHS, AGES, MARKET, RESOURCE_NAMES, RESOURCE_TYPES, START, PLAYER, ENEMY, WILD, REPAIR, DIFFICULTY, LEVELS, ITEMS, HAPPINESS, UPKEEP, PLUNDER, RESOURCE_NODES, formatCost } from '../data/gameData.js';
import { TileId, TileRegistry } from '../world/TileTypes.js';
import { SpatialGrid } from './SpatialGrid.js';
import { Weather } from './Weather.js';
import { Boat } from '../entities/Boat.js';
import { GameMap, StaticObject, ResourceNode } from '../world/GameMap.js';
const StaticObjectNode = (kind, i, j, amount) => new ResourceNode(kind, i, j, { amount, blocks: false });
import { Building } from '../entities/Building.js';
import { Villager } from '../entities/Villager.js';
import { Architect, Cart } from '../entities/Workers.js';
import { Soldier } from '../entities/Soldier.js';
import { Player } from './Player.js';
import { Pathfinder } from './Pathfinder.js';
import { EnemyAI } from './EnemyAI.js';
import { Wild } from './Wild.js';
import { Portals } from './Portals.js';
import { Animals } from './Animals.js';

const CORPSE_TIME = 6; // ceset: ölüm animasyonu + yerde kalma + solma (sn)

/** Bir karonun, dikdörtgen ayak izine Chebyshev uzaklığı (0 = içinde, 1 = bitişik) */
function rectDist(i, j, obj) {
  const dx = Math.max(obj.originI - i, 0, i - obj.i);
  const dy = Math.max(obj.originJ - j, 0, j - obj.j);
  return Math.max(dx, dy);
}

/** Kesirli bir noktanın, binanın ayak izi KENARINA Öklid uzaklığı (karo kenarları ±0.5'te) */
function rectEuclid(x, y, b) {
  const dx = Math.max(b.originI - 0.5 - x, 0, x - (b.i + 0.5));
  const dy = Math.max(b.originJ - 0.5 - y, 0, y - (b.j + 0.5));
  return Math.hypot(dx, dy);
}

/**
 * World: oyun durumunun tamamı ve kuralları (simülasyon katmanı).
 * Render ve DOM'dan bağımsızdır → ileride sunucuda/lockstep'te aynen çalıştırılabilir.
 * Görsel/işitsel tepkiler için yalnızca olay kuyrukları üretir: events (bildirim), sounds (ses), alerts (minimap uyarısı).
 */
export class World {
  /**
   * @param opts { seed, difficulty: 'easy'|'normal'|'hard', save }  save verilirse başlangıç kurulumu yapılmaz;
   *             SaveGame.apply durumu kayıttan geri yükler.
   */
  constructor(opts = {}) {
    this.seed = opts.seed ?? CONFIG.SEED;
    this.difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
    this.diff = DIFFICULTY[this.difficulty];
    this.map = new GameMap(CONFIG.MAP_WIDTH, CONFIG.MAP_HEIGHT, this.seed);
    this.grid = new SpatialGrid(this.map.width, this.map.height, 8);
    this.weather = new Weather(this.seed);
    this.lastCombatAt = -99;   // müzik: son çatışma anı (oyuncu taraflı)
    this._pass = new Map();
    this._navPass = (i, j) => (this.isNavigable(i, j) ? 1 : 0);
    this.fishNodes = this.collectFish();
    this.players = { [PLAYER]: new Player(PLAYER), [ENEMY]: new Player(ENEMY), [WILD]: new Player(WILD) };
    this.player = this.players[PLAYER];
    this.pathfinder = new Pathfinder(this.map);
    this.units = [];
    this.buildings = [];
    this.projectiles = [];
    this.corpses = [];
    this.time = 0;
    this.victory = false;
    this.defeat = false;
    this.events = [];
    this.sounds = [];
    this.alerts = [];
    this._popWarnAt = -99;
    this._attackAlertAt = -99;
    this.enemyAI = new EnemyAI(this);
    this.wild = new Wild(this);
    this.portals = new Portals(this);
    this.animals = new Animals(this);
    if (opts.save) return; // SaveGame.apply gerisini kurar

    // Başlangıç: kasaba merkezi + köylüler
    const s = this.map.spawn;
    this.townCenter = this.addBuilding('townCenter', s.i, s.j, PLAYER, true);
    for (let k = 0; k < START.villagers; k++) this.spawnUnitNear(this.townCenter, 'villager');

    this.campfire = this._placeCampfire();

    // Düşman üssü (haritanın uzak, karadan ulaşılabilir bir köşesi)
    this.enemyAI.setup();
    // Mağara: iki üsten de uzak, rastgele bir yer
    this.wild.setup();
    this.portals.setup();
    this.animals.setup();
    this.recountPopulation();
  }

  /**
   * Kamp ateşi: Kasaba Merkezi'nin 5–8 karo yakınında, çevresindeki 3×3 alan boş ve yürünebilir bir karo.
   * Geceleri yanar; başında askerler içki içer (Renderer süsü — birim değildir, nüfusa sayılmaz).
   */
  _placeCampfire() {
    const tc = this.townCenter, map = this.map;
    const ci = Math.round(tc.centerI), cj = Math.round(tc.centerJ);
    let best = null, bestScore = Infinity;
    for (let j = cj - 9; j <= cj + 9; j++) {
      for (let i = ci - 9; i <= ci + 9; i++) {
        const d = Math.hypot(i - ci, j - cj);
        if (d < 5 || d > 8) continue;
        let ok = true;
        for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1 && ok; di++) ok = map.isWalkable(i + di, j + dj);
        if (!ok) continue;
        const score = d - (i + j - ci - cj) * 0.3; // ekranda TC'nin önü (aşağısı) tercih edilir
        if (score < bestScore) { bestScore = score; best = { i, j }; }
      }
    }
    if (!best) return null;
    return map.addObject(new StaticObject('campfire', best.i, best.j, { blocks: true }));
  }

  // ───────────── Olay kuyrukları ─────────────
  notify(text, kind = 'info') { this.events.push({ text, kind, t: this.time }); }
  sound(name, i = null, j = null, vol = 1) { this.sounds.push({ name, i, j, vol }); }
  alert(i, j) { this.alerts.push({ i, j, t: this.time }); }

  // ───────────── Simülasyon adımı (sabit 20 Hz) ─────────────
  update(dt) {
    if (this.victory || this.defeat) return;
    this.time += dt;
    for (const b of this.buildings) { b.builders = 0; b.repairers = 0; }
    for (const u of this.units) {
      if (u.phase !== 'work' || !u.task?.target) continue;
      if (u.state === 'build') u.task.target.builders++;
      else if (u.state === 'repair') u.task.target.repairers++;
    }
    // İçeride korunan köylüler yavaşça iyileşir
    for (const b of this.buildings) for (const u of b.garrison) u.hp = Math.min(u.maxHp, u.hp + dt);
    // Sağlık araştırmaları: son 5 sn'de hasar almamış, savaşmayan birimler iyileşir
    for (const u of this.units) {
      const regen = this.players[u.owner].modifiers.regen;
      if (regen > 0 && u.hp < u.maxHp && !u.target && this.time - (u._hurtAt ?? -99) > 5) u.hp = Math.min(u.maxHp, u.hp + regen * dt);
    }
    for (const b of this.buildings.slice()) b.update(dt, this);
    this._passiveIncome(dt);
    this.weather.update(dt);
    if (this.weather.changed) { this.notify(`Mevsim değişti: ${this.weather.changed}`, 'info'); this.weather.changed = null; this.map.version++; }
    this.grid.rebuild(this.units);
    this._buildingAttacks(dt);
    for (const u of this.units.slice()) if (!u.dead) u.update(dt, this);
    this.grid.rebuild(this.units);
    this._separate(dt);
    this._updateProjectiles(dt);
    for (const c of this.corpses) c.t += dt;
    if (this.corpses.length && this.corpses[0].t > CORPSE_TIME) this.corpses = this.corpses.filter((c) => c.t <= CORPSE_TIME);
    this.enemyAI.update(dt);
    this.wild.update(dt);
    this.portals.update(dt);
    this.animals.update(dt);
    this._economy(dt);
  }

  // ───────────── Sorgular ─────────────
  isAlive(obj) {
    if (!obj) return false;
    if (obj.isUnit) return !obj.dead && !obj.garrisoned;
    if (obj.isBuilding) return !obj.destroyed;
    if (obj.isResource) return obj.amount > 0 && this.map.objects[obj.j][obj.i] === obj;
    return false;
  }

  /** Birim hedefin "yanında" mı? (yürünebilir çiftlikte: içinde) */
  isAt(unit, obj) {
    const d = rectDist(unit.tileI, unit.tileJ, obj);
    return obj.isBuilding && !obj.blocks ? d === 0 : d <= 1;
  }

  unitsOf(owner) { return this.units.filter((u) => u.owner === owner); }

  recountPopulation() {
    for (const p of Object.values(this.players)) {
      let pop = 0, cap = 0;
      for (const u of this.units) if (u.owner === p.id) pop += 1 + (u.cargo?.length ?? 0);
      for (const b of this.buildings) {
        if (b.owner !== p.id) continue;
        pop += b.garrison.length;
        if (b.queue[0]?.kind === 'unit' && b.queue[0].started) pop++;
        if (b.complete) cap += b.def.popProvided ?? 0;
      }
      p.population = pop;
      p.popCap = Math.min(START.popMax, cap);
      p.version++;
    }
  }

  warnPopCap() {
    if (this.time - this._popWarnAt > 8) {
      this._popWarnAt = this.time;
      this.notify('Nüfus sınırına ulaşıldı! Ev inşa edin.', 'warn');
    }
  }

  /** Birim istatistiği = temel değer + teknoloji/çağ bonusları */
  stat(u, key) {
    const p = this.players[u.owner];
    const base = key === 'melee' || key === 'pierce' ? u.def.armor[key] : u.def[key];
    const v = base + (p.bonus[u.type]?.[key] ?? 0);
    // Güç İksiri: askerlerin saldırısı +%50
    return key === 'attack' && u.isMilitary && (p.effects.strength ?? 0) > this.time ? v * 1.5 : v;
  }

  // ───────────── Geçiş kuralları ─────────────
  /** Tekne: su karosu ve üzerinde engel yok (balık sürüsü engel değildir) */
  isNavigable(i, j) {
    const map = this.map;
    if (!map.inBounds(i, j) || map.terrain[j][i] !== TileId.WATER) return false;
    const o = map.occupancy[j][i];
    return !o || !o.blocks;
  }

  /**
   * Birimin yol bulma maliyet fonksiyonu (Pathfinder pass):
   *   kara birimi : yürünebilir karo 1; kendi kapısı 1; düşman askeri için rakibin çit/kapısı 7 (kırarak geçer)
   *   tekne       : su karosu 1
   */
  passFor(u) {
    if (u.naval) return this._navPass;
    const breach = (u.owner === ENEMY || u.owner === WILD) && u.isMilitary;
    const key = u.owner * 2 + (breach ? 1 : 0);
    let fn = this._pass.get(key);
    if (!fn) {
      const map = this.map, owner = u.owner;
      fn = (i, j) => {
        if (i < 0 || j < 0 || i >= map.width || j >= map.height) return 0;
        if (!TileRegistry.get(map.terrain[j][i]).walkable) return 0;
        const o = map.occupancy[j][i];
        if (!o || !o.blocks) return 1;
        if (o.isBuilding && o.def.gate && o.owner === owner && o.complete) return 1;
        if (breach && o.isBuilding && (o.def.wall || o.def.gate) && o.owner !== owner) return 7;
        return 0;
      };
      this._pass.set(key, fn);
    }
    return fn;
  }

  /** Bir sonraki karo, kırmadan geçilmesi gereken düşman çiti/kapısı mı? (saldırı yürüyüşünde önce onu kır) */
  blockingWall(u, i, j) {
    const o = this.map.getObjectAt(i, j);
    return o && o.isBuilding && (o.def.wall || o.def.gate) && o.owner !== u.owner && !(o.def.gate && o.owner === u.owner) ? o : null;
  }

  /**
   * Birimler birbirini iter: aynı noktada üst üste binmezler. Mekânsal ızgarada yalnızca yakın çiftler denetlenir;
   * itme yalnızca geçilebilir karolara yapılır, çalışan (ağaç kesen vb.) birimler daha az itilir.
   */
  _separate(dt) {
    const R = 0.55, maxStep = 1.4 * dt;
    for (const u of this.units) {
      if (u.naval) continue;
      this.grid.each(u.x, u.y, 1, (o) => {
        if (o.id <= u.id || o.naval || o.dead) return;
        let dx = u.x - o.x, dy = u.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) return;
        let d = Math.sqrt(d2);
        if (d < 1e-4) { const a = (u.id * 2.39996) % (Math.PI * 2); dx = Math.cos(a); dy = Math.sin(a); d = 1; } // tam üst üste: sabit açıyla ayır
        const push = Math.min(R - Math.min(d, R), maxStep) * 0.5;
        const nx = dx / d, ny = dy / d;
        const ku = u.phase === 'work' ? 0.3 : 1, ko = o.phase === 'work' ? 0.3 : 1;
        this._nudge(u, nx * push * ku, ny * push * ku);
        this._nudge(o, -nx * push * ko, -ny * push * ko);
      });
    }
  }

  _nudge(u, dx, dy) {
    const x = u.x + dx, y = u.y + dy;
    if (u.canWalk(this, Math.round(x), Math.round(y))) { u.x = x; u.y = y; }
  }

  // ───────────── Yol bulma yardımcıları ─────────────
  moveToGoal(unit, fn, hi, hj, maxNodes) {
    const path = this.pathfinder.find(unit.tileI, unit.tileJ, fn, hi, hj, maxNodes, this.passFor(unit));
    if (!path) return false;
    unit.path = path;
    unit.goal = { fn, hi, hj };
    return true;
  }

  repath(unit) {
    const g = unit.goal;
    return g ? this.moveToGoal(unit, g.fn, g.hi, g.hj) : false;
  }

  moveToTarget(unit, obj) {
    const walkable = obj.isBuilding && !obj.blocks;
    const fn = walkable ? (i, j) => rectDist(i, j, obj) === 0 : (i, j) => rectDist(i, j, obj) <= 1;
    const ci = obj.centerI ?? obj.i, cj = obj.centerJ ?? obj.j;
    return this.moveToGoal(unit, fn, Math.round(ci), Math.round(cj));
  }

  /** En yakın, bu kaynağı kabul eden (kendi) tamamlanmış binaya gönderir. */
  sendToDropsite(unit) {
    let best = null, bestD = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== unit.owner || !b.complete || !b.def.dropsite?.includes(unit.carryType)) continue;
      if (unit.def.dropTC && b.type !== 'townCenter') continue; // yük arabası yalnızca Kasaba Merkezi'ne boşaltır
      const d = rectDist(unit.tileI, unit.tileJ, b);
      if (d < bestD) { bestD = d; best = b; }
    }
    unit.dropTarget = best;
    return best ? this.moveToTarget(unit, best) : false;
  }

  findNearestResource(kind, ci, cj, maxR = 10, forUnit = null) {
    let best = null, bestD = Infinity;
    if (kind === 'farm') {
      const owner = forUnit?.owner ?? PLAYER;
      for (const b of this.buildings) {
        if (!b.def.farmFood || b.owner !== owner || !b.complete || !this.canGatherNow(b)) continue;
        if (b.farmer && b.farmer !== forUnit && !b.farmer.dead && b.farmer.task?.target === b) continue;
        const d = Math.hypot(b.centerI - ci, b.centerJ - cj);
        if (d < bestD && d <= maxR) { bestD = d; best = b; }
      }
      return best;
    }
    const map = this.map;
    for (let j = Math.max(0, cj - maxR); j <= Math.min(map.height - 1, cj + maxR); j++) {
      for (let i = Math.max(0, ci - maxR); i <= Math.min(map.width - 1, ci + maxR); i++) {
        const o = map.objects[j][i];
        if (!o || !o.isResource || o.kind !== kind) continue;
        const d = Math.hypot(i - ci, j - cj);
        if (d < bestD) { bestD = d; best = o; }
      }
    }
    return best;
  }

  retarget(unit) {
    if (!unit.lastKind || !unit.lastPos) return false;
    const next = this.findNearestResource(unit.lastKind, unit.lastPos.i, unit.lastPos.j, 10, unit);
    if (!next) return false;
    this.assignGather(unit, next, true);
    return true;
  }

  // ───────────── Komutlar ─────────────
  commandMove(units, ti, tj) {
    // Grup hareketi: herkes aynı karoya yığılmasın → hedef çevresinde halka halka farklı karolar
    const land = units.filter((u) => !u.naval), sea = units.filter((u) => u.naval);
    if (land.length && sea.length) { this.commandMove(land, ti, tj); this.commandMove(sea, ti, tj); return; }
    const naval = sea.length > 0;
    const spots = this._spreadSpots(ti, tj, units.length, naval ? (i, j) => this.isNavigable(i, j) : null);
    units.forEach((u, k) => {
      const s = spots[k] ?? { i: ti, j: tj };
      u.stop();
      u.state = 'move';
      if (!this.moveToGoal(u, (i, j) => i === s.i && j === s.j, s.i, s.j)) u.stop();
    });
  }

  commandAttack(units, target) {
    for (const u of units) {
      if (u.naval) continue;
      // Koçbaşı yalnızca binaya saldırır; birime gönderilirse oraya yürür
      if (u.def.siege && target.isUnit) { this.commandMove([u], target.tileI, target.tileJ); continue; }
      u.stop(); u.attack(target);
    }
  }

  // ───────────── Tekneler ─────────────
  commandFish(boats, node) {
    for (const b of boats) {
      if (!b.naval) continue;
      b.stop();
      b.state = 'fish';
      b.phase = 'toNode';
      b.task = { target: node };
      if (!this.moveToTarget(b, node)) b.stop();
    }
  }

  isAtDock(boat, dock) { return rectDist(boat.tileI, boat.tileJ, dock) <= 1; }

  sendBoatToDock(boat) {
    let best = null, bestD = Infinity;
    const region = this.map.regionAt(boat.tileI, boat.tileJ);
    for (const b of this.buildings) {
      if (b.owner !== boat.owner || b.type !== 'dock' || !b.complete) continue;
      if (!this.map.regionsAround(b).has(region)) continue; // başka göldeki tersaneye gidilemez
      const d = rectDist(boat.tileI, boat.tileJ, b);
      if (d < bestD) { bestD = d; best = b; }
    }
    boat.dropTarget = best;
    if (!best) return false;
    return this.moveToGoal(boat, (i, j) => rectDist(i, j, best) <= 1, Math.round(best.centerI), Math.round(best.centerJ), 20000);
  }

  /** Teknenin bulunduğu göldeki en yakın balık sürüsü */
  retargetBoat(boat) {
    const region = this.map.regionAt(boat.tileI, boat.tileJ);
    let node = null, bestD = 40;
    for (const f of this.fishNodes) {
      if (!this.isAlive(f) || this.map.regionAt(f.i, f.j) !== region) continue;
      const d = Math.hypot(f.i - boat.x, f.j - boat.y);
      if (d < bestD) { bestD = d; node = f; }
    }
    if (!node) return false;
    this.commandFish([boat], node);
    return true;
  }

  /** Tersanenin yanındaki bir su karosu (tekne doğma noktası) */
  findWaterSpot(b) {
    for (let r = 1; r <= 4; r++) {
      for (let j = b.originJ - r; j <= b.j + r; j++) {
        for (let i = b.originI - r; i <= b.i + r; i++) {
          if (rectDist(i, j, b) === r && this.isNavigable(i, j)) return { i, j };
        }
      }
    }
    return null;
  }

  _spreadSpots(ci, cj, n, ok = null) {
    ok ??= (i, j) => this.map.isWalkable(i, j);
    const out = [];
    for (let r = 0; r <= 9 && out.length < n; r++) {
      for (let dj = -r; dj <= r && out.length < n; dj++) {
        for (let di = -r; di <= r && out.length < n; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (ok(ci + di, cj + dj)) out.push({ i: ci + di, j: cj + dj });
        }
      }
    }
    return out;
  }

  assignGather(unit, target, keepCarry = false) {
    if (!this.canGatherNow(target)) {
      if (unit.owner === PLAYER && this.time - (this._winterWarnAt ?? -99) > 20) { this._winterWarnAt = this.time; this.notify('Kışın dışarıdan gıda toplanamaz: sera, sebze yatağı, balıkçı teknesi ve av işe yarar.', 'warn'); }
      unit.stop();
      return;
    }
    if (target.isBuilding) {
      // Çiftlikte aynı anda tek köylü çalışır (AoE kuralı)
      if (target.farmer && target.farmer !== unit && !target.farmer.dead && target.farmer.task?.target === target) {
        const other = this.findNearestResource('farm', target.centerI, target.centerJ, 12, unit);
        if (!other) { this.moveToTarget(unit, target); unit.state = 'move'; return; }
        target = other;
      }
      target.farmer = unit;
    }
    const type = target.isBuilding ? 'food' : target.resType;
    if (!keepCarry && unit.carryType !== type) unit.carry = 0;
    unit.state = 'gather';
    unit.task = { target };
    unit.lastKind = target.isBuilding ? 'farm' : target.kind;
    unit.lastPos = { i: target.i, j: target.j };
    const cap = unit.def.carry * this.players[unit.owner].modifiers.carry;
    if (unit.carry >= cap && unit.carryType === type) {
      unit.phase = 'toDrop';
      this.sendToDropsite(unit);
    } else {
      unit.phase = 'toNode';
      if (!this.moveToTarget(unit, target)) unit.stop();
    }
  }

  commandGather(units, target) {
    for (const u of units) {
      if (!u.def.gatherer) continue;
      if (u.def.vehicle && target.isBuilding) continue; // araba tarlada çalışmaz
      u.stop(); this.assignGather(u, target);
    }
  }

  /** Bu birim bu binayı kurabilir mi? Süslemeyi yalnızca mimar, diğerlerini yalnızca köylü kurar */
  canBuild(u, type) { return BUILDINGS[type]?.decor ? !!u.def.decorBuilder : !!u.def.builder; }

  commandBuild(units, building) {
    for (const u of units) {
      if (!this.canBuild(u, building.type)) continue;
      u.stop();
      u.state = 'build';
      u.phase = 'toSite';
      u.task = { target: building };
      if (!this.moveToTarget(u, building)) u.stop();
    }
  }

  commandDeposit(units, building) {
    for (const u of units) {
      if (u.def.gatherer && u.carry > 0 && building.def.dropsite?.includes(u.carryType) && (!u.def.dropTC || building.type === 'townCenter')) {
        const node = u.state === 'gather' ? u.task?.target : null;
        u.stop();
        u.state = 'gather';
        u.task = node ? { target: node } : null;
        u.phase = 'toDrop';
        u.dropTarget = building;
        this.moveToTarget(u, building);
      } else {
        this.commandMove([u], building.i + 1, building.j + 1);
      }
    }
  }

  /** İnşaat bittiğinde köylü ne yapsın? (AoE davranışı) */
  afterBuild(unit, b) {
    unit.stop();
    if (b.def.farmFood && (!b.farmer || b.farmer.dead || b.farmer.task?.target !== b)) {
      this.assignGather(unit, b);
      return;
    }
    let pending = null, pd = 10;
    for (const o of this.buildings) {
      if (o.owner !== unit.owner || o.complete || o.def.farmFood || !this.canBuild(unit, o.type)) continue;
      const d = rectDist(unit.tileI, unit.tileJ, o);
      if (d < pd) { pd = d; pending = o; }
    }
    if (pending) { this.commandBuild([unit], pending); return; }
    const auto = b.def.autoGather;
    if (auto) {
      const kinds = { wood: ['tree'], food: ['berry', 'farm'], gold: ['gold', 'stone'] }[auto];
      for (const kind of kinds) {
        const node = this.findNearestResource(kind, Math.round(b.centerI), Math.round(b.centerJ), 9, unit);
        if (node) { this.assignGather(unit, node); return; }
      }
    }
  }

  // ───────────── Tamir ─────────────
  /** Hasarlı (tamamlanmış) bina mı? Çiftlik tamir edilmez. */
  needsRepair(b) { return b.isBuilding && b.complete && !b.destroyed && b.type !== 'farm' && b.hp < b.maxHp; }

  commandRepair(units, b) {
    for (const u of units) {
      if (u.type !== 'villager') continue;
      u.stop();
      u.state = 'repair';
      u.phase = 'toSite';
      u.task = { target: b };
      if (!this.moveToTarget(u, b)) u.stop();
    }
  }

  /** Binanın yanındaki en yakın köylüleri (önce boşta olanlar) tamire gönderir */
  callRepairers(b, count = 4) {
    const vs = this.units.filter((u) => u.owner === b.owner && u.type === 'villager' && u.state !== 'repair')
      .sort((a, c) => (a.state === 'idle' ? 0 : 50) + rectEuclid(a.x, a.y, b) - ((c.state === 'idle' ? 0 : 50) + rectEuclid(c.x, c.y, b)));
    const picked = vs.slice(0, count);
    if (!picked.length) { this.notify('Tamir edecek köylü yok.', 'warn'); return; }
    this.commandRepair(picked, b);
    this.notify(`${picked.length} köylü ${b.name.toLocaleLowerCase('tr')} tamirine gidiyor.`, 'info');
  }

  /**
   * Bir köylünün bu tick'teki tamir katkısı. İnşaattaki gibi azalan verim: n köylü toplamda (n + 2) / 3 kat hızlı.
   * Bedel, onarılan cana orantılı olarak bina maliyetinden düşülür. Kaynak yetmezse false (köylü durur).
   */
  repairTick(u, b, dt) {
    const n = Math.max(1, b.repairers), factor = (n + 2) / (3 * n);
    const hp = Math.min(b.maxHp - b.hp, (b.maxHp / b.def.buildTime) * REPAIR.HP_RATE * factor * dt);
    if (hp <= 0) return false;
    const p = this.players[b.owner], cost = {};
    for (const [k, v] of Object.entries(b.cost ?? b.def.cost)) cost[k] = (v * REPAIR.COST * hp) / b.maxHp;
    if (!p.spend(cost)) {
      if (b.owner === PLAYER && this.time - (this._repairWarnAt ?? -99) > 6) {
        this._repairWarnAt = this.time;
        this.notify('Tamir için yetersiz kaynak.', 'warn');
      }
      return false;
    }
    b.hp += hp;
    if (b.hp >= b.maxHp - 1e-6) {
      b.hp = b.maxHp;
      if (b.owner === PLAYER) { this.notify(`${b.name} tamir edildi.`, 'good'); this.sound('bell', b.centerI, b.centerJ, 0.5); }
    }
    return true;
  }

  // ───────────── Köylüleri çağır / sığınma ─────────────
  garrisonCap(b) { return b.def.garrison ?? 0; }

  /** Çan çalar: en yakın köylüler binaya koşup içeri sığınır (kapasite kadar). */
  ringBell(b) {
    const cap = this.garrisonCap(b);
    const coming = this.units.filter((u) => u.state === 'garrison' && u.task?.target === b).length;
    let room = cap - b.garrison.length - coming;
    if (room <= 0) { this.notify('Bina dolu.', 'warn'); return; }
    const vs = this.units.filter((u) => u.owner === b.owner && u.type === 'villager' && u.state !== 'garrison')
      .sort((a, c) => rectEuclid(a.x, a.y, b) - rectEuclid(c.x, c.y, b));
    if (!vs.length) { this.notify('Çağrılacak köylü yok.', 'warn'); return; }
    for (const u of vs) {
      if (room-- <= 0) break;
      u.stop();
      u.state = 'garrison';
      u.task = { target: b };
      if (!this.moveToTarget(u, b)) u.stop();
    }
    if (b.owner === PLAYER) { this.notify(`Köylüler ${b.name.toLocaleLowerCase('tr')} içine sığınıyor!`, 'warn'); this.sound('bell'); this.sound('bell', null, null, 0.7); }
  }

  /** Tek köylüyü sığınağa gönder (kayıttan yüklerken) */
  ringBellUnit(u, b) {
    u.stop();
    u.state = 'garrison';
    u.task = { target: b };
    if (!this.moveToTarget(u, b)) u.stop();
  }

  /** Haritadaki balık sürüleri (Renderer'ın su altı çizimi için) */
  collectKind(kind) {
    const out = [], map = this.map;
    for (let j = 0; j < map.height; j++) for (let i = 0; i < map.width; i++) { const o = map.objects[j][i]; if (o?.kind === kind) out.push(o); }
    return out;
  }

  collectFish() {
    const out = [], map = this.map;
    for (let j = 0; j < map.height; j++) for (let i = 0; i < map.width; i++) { const o = map.objects[j][i]; if (o?.kind === 'fish') out.push(o); }
    return out;
  }

  enterGarrison(u, b) {
    if (b.garrison.length >= this.garrisonCap(b) || !b.complete) { u.stop(); return; }
    u.stop();
    u.garrisoned = b;
    u.path = [];
    this.units = this.units.filter((x) => x !== u);
    b.garrison.push(u);
    this.recountPopulation();
  }

  /** Herkesi dışarı çıkar: köylüler binanın çevresine çıkar ve son topladıkları kaynağa geri döner */
  ungarrison(b) {
    if (!b.garrison.length) return;
    for (const u of b.garrison) {
      const spot = this.findSpawnSpot(b);
      u.garrisoned = null;
      if (spot) { u.x = u.prevX = spot.i; u.y = u.prevY = spot.j; }
      u.stop();
      this.units.push(u);
      if (!b.destroyed && u.lastKind) this.retarget(u);
    }
    b.garrison = [];
    this.recountPopulation();
  }

  // ───────────── Kaynak düğümleri ─────────────
  takeFromNode(node, amount) {
    if (node.isBuilding) {
      const got = Math.min(amount, node.food);
      const step = Math.floor((1 - node.food / node.def.farmFood) * 10);
      node.food -= got;
      // Çiftlik tükendikçe sararır: zemin yalnızca %10'luk adımlarda yeniden çizilir
      if (Math.floor((1 - node.food / node.def.farmFood) * 10) !== step) this.map.groundVersion++;
      if (node.food <= 1e-6) {
        this.removeBuilding(node);
        if (node.owner === PLAYER) this.notify('Bir çiftlik tükendi.', 'warn');
      }
      return got;
    }
    const got = Math.min(amount, node.amount);
    node.amount -= got;
    if (node.amount <= 1e-6) {
      this.map.removeObject(node); // biten kaynaktan iz kalmaz (kütük yok): yer dümdüz olur
    }
    return got;
  }

  // ───────────── Bina seviyeleri, çağ kademeleri, maliyet ─────────────
  /** Bu türün sahibin çağındaki maliyeti (sur/kapı çağla taşa döner) */
  costOf(type, owner = PLAYER) {
    const def = BUILDINGS[type];
    return def.tiers ? def.tiers[Math.min(def.tiers.length - 1, this.players[owner].tier)].cost : def.cost;
  }

  /** Üretim çarpanı: seviye başına +%25 (seviyesiz bina / yok → 1) */
  levelMul(b) { return b?.isBuilding && b.def.levels ? 1 + LEVELS.bonus * (b.level - 1) : 1; }

  upgradeCost(b) {
    const cost = {};
    for (const [k, v] of Object.entries(b.def.cost)) cost[k] = Math.round(v * LEVELS.costMul * b.level);
    cost.gold = (cost.gold ?? 0) + LEVELS.gold * b.level;
    return cost;
  }

  /** Sur/kapı: çağ kademesine geç; can oransal korunur (hasarlı sur hasarlı kalır) */
  applyTier(b, tier) {
    const T = b.def.tiers;
    if (!T) return;
    tier = Math.min(T.length - 1, tier);
    if (tier === b.tier && b.maxHp === T[tier].hp) return;
    const frac = b.hp / b.maxHp;
    b.tier = tier;
    b.maxHp = T[tier].hp;
    b.hp = Math.max(1, frac * b.maxHp);
  }

  /** Yarım kalmış inşaatı yık: maliyetin YARISI geri verilir */
  demolishSite(b) {
    if (!b || b.complete || b.destroyed || b.owner !== PLAYER) return;
    const half = {};
    for (const [k, v] of Object.entries(b.cost ?? b.def.cost)) half[k] = Math.floor(v / 2);
    for (const u of this.units) if (u.task?.target === b) u.stop();
    this.removeBuilding(b);
    this.players[b.owner].refund(half);
    this.notify(`${b.name} inşaatı yıkıldı: ${formatCost(half) || 'kaynak'} geri alındı.`, 'info');
    this.sound('collapse', b.centerI, b.centerJ, 0.5);
  }

  // ───────────── Ekonomi: gıda tüketimi, şarap, huzur, hastane, çeşme ─────────────
  /** Ambarların koruduğu pay (0..0,4) */
  protectedShare(owner) {
    let s = 0;
    for (const b of this.buildings) if (b.owner === owner && b.complete && b.def.protect) s += b.def.protect * b.level;
    return Math.min(0.4, s);
  }

  /** Kışın dışarıdaki gıda kaynaklarından (meyve, çiftlik, kıyı balığı) toplanamaz; sera/sebze yatağı ve av eti hariç */
  canGatherNow(node) {
    if (this.weather.season.id !== 'winter') return true;
    const food = node.isBuilding ? !!node.def.farmFood : node.resType === 'food';
    if (!food) return true;
    return node.isBuilding ? !!node.def.winterOk : node.kind === 'carcass';
  }

  /** Köylünün toplama çarpanı: huzur (×0,8–1,2), kuyu yakınlığı (+%10), kış soğuğu (kürk yoksa −%15) */
  gatherMul(u) {
    const p = this.players[u.owner];
    let m = u.owner === PLAYER ? 0.8 + 0.4 * (p.happiness / 100) : 1;
    if (this._wellAt(u.tileI, u.tileJ, u.owner)) m *= 1.1;
    if (this.weather.season.id === 'winter' && !p.modifiers.winterProof) m *= 0.85;
    return m;
  }

  _wellAt(i, j, owner) {
    if (owner !== PLAYER) return false;
    if (this._wellV !== this.map.version) {
      this._wellV = this.map.version;
      this._wells = this.buildings.filter((b) => b.owner === PLAYER && b.complete && b.def.wellBonus).map((b) => [b.i, b.j]);
    }
    for (const [a, c] of this._wells) if (Math.abs(a - i) <= 8 && Math.abs(c - j) <= 8) return true;
    return false;
  }

  _economy(dt) {
    const p = this.player, winter = this.weather.season.id === 'winter';
    // 1) Gıda tüketimi: köylü/asker başına; kışın daha fazla (ambar varsa az)
    let need = 0;
    for (const u of this.units) {
      if (u.owner !== PLAYER || u.def.animal) continue;
      need += (u.isMilitary ? UPKEEP.military : UPKEEP.civil) * (1 + (u.cargo?.length ?? 0) * 0);
      if (u.cargo) need += u.cargo.length * UPKEEP.military;
    }
    for (const b of this.buildings) if (b.owner === PLAYER) need += b.garrison.length * UPKEEP.civil;
    const hasGranary = this.buildings.some((b) => b.owner === PLAYER && b.complete && b.def.protect);
    if (winter) need *= hasGranary ? UPKEEP.winterGranary : UPKEEP.winter;
    const eat = Math.min(p.resources.food, need * dt);
    p.resources.food -= eat;
    p.stats.spent.food += eat;
    p.starving = need > 0 && p.resources.food <= 0.5;
    // 2) Şarap: mahzen yiyecekten şarap yapar, tavernalar tüketir
    for (const b of this.buildings) {
      if (b.owner !== PLAYER || !b.complete) continue;
      if (b.def.wine && p.wine < 500 && p.resources.food > 100) { const f = b.def.wine.food * dt; p.resources.food -= f; p.stats.spent.food += f; p.wine += b.def.wine.make * dt; }
      if (b.def.wineUse) p.wine = Math.max(0, p.wine - b.def.wineUse * dt);
    }
    // 3) Hastane ve çeşme: yakındaki birimleri iyileştir; hastanedeki yaralılar geri döner
    for (const b of this.buildings) {
      if (!b.complete) continue;
      const heal = b.def.heal ?? (b.def.fountain ? { radius: 6, rate: 1 } : null);
      if (heal) {
        this.grid.each(b.centerI, b.centerJ, heal.radius, (u) => {
          if (u.owner !== b.owner || u.dead || u.hp >= u.maxHp) return;
          if (b.def.heal && !u.isMilitary) return;
          u.hp = Math.min(u.maxHp, u.hp + heal.rate * dt);
        });
      }
      if (b.revive?.length) {
        for (const r of b.revive) r.t -= dt;
        while (b.revive.length && b.revive[0].t <= 0) {
          const r = b.revive.shift(), u = this.spawnUnitNear(b, r.type);
          if (u) { u.hp = u.maxHp * 0.6; this.recountPopulation(); if (b.owner === PLAYER) this.notify(`${u.name} hastaneden taburcu oldu.`, 'good'); }
        }
      }
    }
    // 4) Huzur: saniyede bir hedef hesaplanır, değer hedefe yavaşça yaklaşır
    p.grief = Math.max(0, (p.grief ?? 0) - dt * 0.15);
    this._happyT = (this._happyT ?? 0) - dt;
    if (this._happyT <= 0) {
      this._happyT = 1;
      const H = HAPPINESS, f = {};
      let houses = 0, beauty = 0, taverns = 0;
      for (const b of this.buildings) {
        if (b.owner !== PLAYER || !b.complete) continue;
        if (b.type === 'house') houses++;
        if (b.def.beauty) beauty += b.def.beauty;
        if (b.def.happiness) taverns += p.wine > 0.5 ? b.def.happiness : 2;
      }
      f.base = H.base;
      f.houses = Math.min(H.maxHouse, houses * H.perHouse);
      f.pop = Math.min(H.maxPop, p.population * H.perPop);
      f.beauty = Math.min(H.maxBeauty, beauty * H.perBeauty);
      f.tavern = Math.min(H.maxTavern, taverns);
      f.war = this.time - this.lastCombatAt < 40 ? -H.war : 0;
      f.losses = -Math.min(20, p.grief ?? 0);
      f.starving = p.starving ? -H.starving : 0;
      f.winter = winter && !p.modifiers.winterProof ? -H.winter : 0;
      const target = Math.max(0, Math.min(100, Object.values(f).reduce((a, c) => a + c, 0)));
      p.happyFactors = f;
      p.happyTarget = target;
      p.happiness += Math.sign(target - p.happiness) * Math.min(Math.abs(target - p.happiness), target < p.happiness ? 1.5 : 0.6);
      if (p.happiness < 25 && this.time - (this._unrestAt ?? -999) > 90) { this._unrestAt = this.time; this.notify('Halk huzursuz! Toplama yavaşladı: taverna, süsleme ve gıda sağlayın.', 'warn'); }
      if (p.starving && this.time - (this._starveAt ?? -999) > 45) { this._starveAt = this.time; this.notify('Yiyecek bitti! Halk aç: sera, sebze yatağı, balıkçılık veya hayvan çiftliği kurun.', 'warn'); }
    }
  }

  /** Avlanan hayvan: yerinde et kalır; avcının sahibi deri kazanır; avlayan köylüler ete yönelir */
  _onAnimalKilled(u, killerOwner) {
    this.units = this.units.filter((x) => x !== u);
    this.corpses.push({ type: u.type, owner: u.owner, x: u.x, y: u.y, facing: u.facing, dir: u.dir, t: 0, animal: true });
    const p = this.players[killerOwner];
    const bonus = 1 + (p?.modifiers.huntBonus ?? 0);
    if (p) p.add('hide', Math.round(u.def.hide * bonus));
    const spot = this.map.isWalkable(u.tileI, u.tileJ) && !this.map.objects[u.tileJ][u.tileI] ? { i: u.tileI, j: u.tileJ } : this.map.findWalkableNear(u.tileI, u.tileJ, 3);
    if (!spot || this.map.objects[spot.j][spot.i]) return;
    const meat = this.map.addObject(StaticObjectNode('carcass', spot.i, spot.j, Math.round(u.def.meat * bonus)));
    this.meat = (this.meat ?? []).filter((m) => this.isAlive(m)).concat([meat]);
    for (const h of this.units) if (h.target === u && h.def.gatherer) this.assignGather(h, meat);
    if (killerOwner === PLAYER) this.notify(`${u.name} avlandı: +${Math.round(u.def.hide * bonus)} deri, ${Math.round(u.def.meat * bonus)} et.`, 'good');
  }

  // ───────────── Savaş arabası (asker taşıma) ─────────────
  commandBoard(units, wagon) {
    for (const u of units) {
      if (!u.isMilitary || u.def.vehicle || u === wagon) continue;
      u.stop();
      u.state = 'board';
      u.task = { target: wagon };
      u.repathT = 0;
    }
  }

  board(u, wagon) {
    if (!this.isAlive(wagon) || wagon.cargo.length >= wagon.def.transport) { u.stop(); return; }
    u.stop();
    u.boarded = wagon;
    this.units = this.units.filter((x) => x !== u);
    wagon.cargo.push(u);
    this.recountPopulation();
  }

  /** Arabadakileri çevreye indir (hpFrac: araba yıkıldıysa canları azalır) */
  unload(wagon, hpFrac = 1) {
    if (!wagon.cargo?.length) return;
    for (const u of wagon.cargo) {
      const s = this.map.findWalkableNear(wagon.tileI, wagon.tileJ, 6);
      if (!s) continue;
      u.boarded = null;
      u.x = u.prevX = s.i; u.y = u.prevY = s.j;
      u.hp = Math.max(1, u.hp * hpFrac);
      u.stop();
      this.units.push(u);
    }
    wagon.cargo = [];
    this.recountPopulation();
  }

  // ───────────── Bina taşıma (mimar) ─────────────
  relocateCost(b) {
    const c = {};
    for (const [k, v] of Object.entries(b.cost ?? b.def.cost)) c[k] = Math.ceil(v * 0.3);
    return c;
  }

  /** Binayı yeni yere taşı: bir mimar gerekir, bedel maliyetin %30'u. Üretim kuyruğu ve seviye korunur. */
  relocate(b, oi, oj) {
    const arch = this.units.filter((u) => u.owner === PLAYER && u.type === 'architect');
    if (!arch.length) { this.notify('Binayı taşımak için bir mimar gerekir (Üniversite).', 'warn'); return false; }
    const err = this.checkPlacement(b.type, oi, oj, b);
    if (err) { this.notify(err, 'warn'); return false; }
    const cost = this.relocateCost(b);
    if (!this.player.spend(cost)) { this.notify('Taşıma için yetersiz kaynak.', 'warn'); return false; }
    this.ungarrison(b);
    this.map.removeObject(b);
    b.i = oi + b.size - 1; b.j = oj + b.size - 1;
    this.map.addObject(b);
    b.rally = null;
    for (const u of this.units) {
      if (rectDist(u.tileI, u.tileJ, b) === 0 && b.blocks) { const s = this.map.findWalkableNear(u.tileI, u.tileJ, 8); if (s) { u.x = u.prevX = s.i; u.y = u.prevY = s.j; u.path = []; } }
      if (u.task?.target === b) u.stop();
    }
    if (b.type === 'farm' || b.def.ground) this.map.groundVersion++;
    arch.sort((a, c) => Math.hypot(a.x - b.centerI, a.y - b.centerJ) - Math.hypot(c.x - b.centerI, c.y - b.centerJ));
    this.commandMove([arch[0]], b.i + 1, b.j + 1);
    this.notify(`${b.name} taşındı (${formatCost(cost)}). Mimar yeni yere gidiyor.`, 'good');
    return true;
  }

  // ───────────── Çağ şartları ─────────────
  /** Bir sonraki çağın şartları: { age, military: { have, need }, buildings: [{ type, have, need }], ok } */
  ageReq(owner = PLAYER) {
    const p = this.players[owner], next = p.nextAge;
    if (!next) return { age: null, military: null, buildings: [], ok: false };
    const req = next.req ?? {};
    const have = {};
    for (const b of this.buildings) if (b.owner === owner && b.complete) have[b.type] = (have[b.type] ?? 0) + 1;
    const mil = this.units.filter((u) => u.owner === owner && u.isMilitary).length;
    const buildings = Object.entries(req.buildings ?? {}).map(([type, need]) => ({ type, need, have: Math.min(need, have[type] ?? 0) }));
    const military = { need: req.military ?? 0, have: Math.min(req.military ?? 0, mil) };
    return { age: next, military, buildings, ok: military.have >= military.need && buildings.every((x) => x.have >= x.need) };
  }

  /**
   * Listeden tek tıkla inşaat: Kasaba Merkezi çevresinde uygun ilk yere yerleştirir ve en yakın BOŞTAKİ köylüyü
   * (yoksa en yakın köylüyü) gönderir. Bina kurulamıyorsa nedenini bildirir.
   */
  autoPlace(type) {
    const err = this.checkBuildable(type);
    if (err) { this.notify(err, 'warn'); return null; }
    const tc = this.townCenter, def = BUILDINGS[type];
    if (!tc) return null;
    const vs = this.units.filter((u) => u.owner === PLAYER && u.def.builder);
    if (!vs.length) { this.notify('İnşa edecek köylü yok.', 'warn'); return null; }
    for (let r = 4; r < 30; r++) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + r * 0.7;
        const oi = Math.round(tc.centerI + Math.cos(a) * r - def.size / 2), oj = Math.round(tc.centerJ + Math.sin(a) * r - def.size / 2);
        if (this.checkPlacement(type, oi, oj)) continue;
        // Kapı önü ve yollar tıkanmasın: çevresinde 1 karo boşluk
        if (!this.map.canPlace(oi - 1, oj - 1, def.size + 2) && type !== 'farm') continue;
        const c = { x: oi + def.size / 2, y: oj + def.size / 2 };
        const idle = vs.filter((u) => u.state === 'idle');
        const pool = idle.length ? idle : vs;
        pool.sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y));
        const b = this.placeBuilding(type, oi, oj, [pool[0]]);
        if (b) this.notify(`${def.name} inşaatı başladı (Kasaba Merkezi yakınında).`, 'good');
        return b;
      }
    }
    this.notify('Kasaba Merkezi çevresinde uygun yer bulunamadı.', 'warn');
    return null;
  }

  /** İnşaata en yakın BOŞTAKİ bir köylüyü (mimarı) çağır */
  callWorker(b) {
    const c = { x: b.centerI, y: b.centerJ };
    const idle = this.units.filter((u) => u.owner === b.owner && u.state === 'idle' && this.canBuild(u, b.type))
      .sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y));
    if (!idle.length) { this.notify(BUILDINGS[b.type].decor ? 'Boşta mimar yok.' : 'Boşta köylü yok.', 'warn'); return false; }
    this.commandBuild([idle[0]], b);
    this.notify(`Boştaki bir ${BUILDINGS[b.type].decor ? 'mimar' : 'köylü'} inşaata gidiyor.`, 'info');
    return true;
  }

  // ───────────── Simya: iksir kullan ─────────────
  useItem(id, owner = PLAYER) {
    const p = this.players[owner], it = ITEMS[id];
    if (!it || !(p.items[id] > 0)) return false;
    p.items[id]--;
    if (it.dur) p.effects[id] = Math.max(this.time, p.effects[id] ?? 0) + it.dur;
    if (id === 'heal') for (const u of this.units) if (u.owner === owner) u.hp = u.maxHp;
    if (id === 'fertilizer') { for (const b of this.buildings) if (b.owner === owner && b.def.farmFood && b.complete) b.food += 150; this.map.groundVersion++; }
    if (id === 'vision' && this.fog) { this.fog.explored.fill(1); this.fog._t = 0; }
    if (owner === PLAYER) { this.notify(`${it.name} kullanıldı${it.dur ? ` (${it.dur} sn)` : ''}.`, 'good'); this.sound('bell', null, null, 0.5); }
    p.version++;
    return true;
  }

  // ───────────── Binalar ─────────────
  addBuilding(type, oi, oj, owner, complete = false) {
    const b = new Building(type, oi, oj, { complete, owner });
    b.cost = this.costOf(type, owner);
    if (b.def.tiers) this.applyTier(b, this.players[owner].tier);
    b.maxHp = Math.round(b.maxHp * this.players[owner].modifiers.bldgHp); // Duvarcılık / Mimarlık
    b.hp = complete ? b.maxHp : 1;
    if (b.def.ground) this.map.groundVersion++; // patika zeminde çizilir
    this.map.addObject(b);
    this.buildings.push(b);
    if (type === 'farm') this.map.groundVersion++; // çiftlik zemin katmanında çizilir
    return b;
  }

  checkBuildable(type, owner = PLAYER) {
    const def = BUILDINGS[type], p = this.players[owner];
    if (def.age > p.age) return `${AGES[def.age].name} gerekli`;
    for (const req of def.requires ?? []) {
      if (!this.buildings.some((b) => b.owner === owner && b.type === req && b.complete)) return `Önce ${BUILDINGS[req].name} gerekli`;
    }
    if (!p.canAfford(this.costOf(type, owner))) return 'Yetersiz kaynak';
    return null;
  }

  /** Konum kuralı: ayak izi boş + (tersane ise) su kenarı. Hata metni veya null döner. */
  checkPlacement(type, oi, oj, ignore = null) {
    const def = BUILDINGS[type];
    const ok = ignore ? this._canPlaceIgnoring(oi, oj, def.size, ignore) : this.map.canPlace(oi, oj, def.size);
    if (!ok) return 'Buraya inşa edilemez.';
    if (def.coastal && !this.map.isCoastal(oi, oj, def.size)) return `${def.name} su kenarına kurulmalı.`;
    return null;
  }

  _canPlaceIgnoring(oi, oj, size, ignore) {
    const map = this.map;
    for (let j = oj; j < oj + size; j++) for (let i = oi; i < oi + size; i++) {
      if (!map.inBounds(i, j) || !TileRegistry.get(map.terrain[j][i]).buildable) return false;
      const o = map.occupancy[j][i];
      if (o && o !== ignore) return false;
    }
    return true;
  }

  placeBuilding(type, oi, oj, builders) {
    const def = BUILDINGS[type];
    const err = this.checkBuildable(type);
    if (err) { this.notify(err, 'warn'); return null; }
    // Bina yalnızca köylüler (süsleme yalnızca mimarlar) tarafından kurulabilir
    if (!builders?.some((u) => this.canBuild(u, type))) { this.notify(def.decor ? 'Süslemeleri yalnızca mimarlar yapabilir.' : 'Yalnızca köylüler inşa edebilir.', 'warn'); return null; }
    const perr = this.checkPlacement(type, oi, oj);
    if (perr) { this.notify(perr, 'warn'); return null; }
    this.player.spend(this.costOf(type));
    const b = this.addBuilding(type, oi, oj, PLAYER, false);
    if (b.blocks) {
      for (const u of this.units) {
        if (rectDist(u.tileI, u.tileJ, b) === 0) {
          const spot = this.map.findWalkableNear(u.tileI, u.tileJ, 8);
          if (spot) { u.x = u.prevX = spot.i; u.y = u.prevY = spot.j; u.path = []; }
        }
      }
    }
    if (builders?.length) this.commandBuild(builders, b);
    return b;
  }

  /**
   * Çit hattı: karolar sırayla yerleştirilir; geçersiz karolar atlanır, kaynak bitince durur.
   * İlk parçaya köylüler gönderilir; bitirince kendiliğinden yakındaki sonraki parçaya geçerler.
   */
  placeWallLine(tiles, builders, type = 'wall') {
    const err = this.checkBuildable(type);
    if (err) { this.notify(err, 'warn'); return 0; }
    if (!builders?.some((u) => this.canBuild(u, type))) { this.notify(BUILDINGS[type].decor ? 'Süslemeleri yalnızca mimarlar yapabilir.' : 'Yalnızca köylüler inşa edebilir.', 'warn'); return 0; }
    let first = null, n = 0;
    for (const t of tiles) {
      if (this.checkPlacement(type, t.i, t.j)) continue;
      if (!this.player.spend(this.costOf(type))) { this.notify('Yetersiz kaynak: hattın bir kısmı kurulamadı.', 'warn'); break; }
      const b = this.addBuilding(type, t.i, t.j, PLAYER, false);
      first ??= b;
      n++;
    }
    if (first && builders?.length) this.commandBuild(builders, first);
    return n;
  }

  removeBuilding(b) {
    b.destroyed = true;
    if (b.type === 'farm' || b.def.ground) this.map.groundVersion++;
    this.map.removeObject(b);
    this.buildings = this.buildings.filter((o) => o !== b);
    this.recountPopulation();
  }

  onBuildingComplete(b) {
    this.recountPopulation();
    this.map.version++;
    if (b.type === 'farm' || b.def.ground) this.map.groundVersion++;
    if (b.owner === PLAYER && b.type !== 'farm' && !b.def.line) {
      this.notify(`${b.name} tamamlandı.`, 'good');
      this.sound('bell', b.centerI, b.centerJ, 0.7);
    }
    if (b.type === 'wonder' && b.owner === PLAYER) this._win('Harika tamamlandı! ZAFER!');
    if (b.type === 'dock' && b.owner === PLAYER) {
      const regions = this.map.regionsAround(b);
      if (!this.fishNodes.some((f) => this.isAlive(f) && regions.has(this.map.regionAt(f.i, f.j)))) this.notify('Bu tersanenin açıldığı suda balık sürüsü yok.', 'warn');
    }
  }

  /**
   * Binanın çevresinde doğma noktası seçer. Ön köşeye en yakın karo bazen su/bina arasında sıkışmış
   * küçük bir cebe düşer; birim oradan çıkamaz. Bu yüzden her adayın bağlı olduğu bölgenin büyüklüğü
   * sınırlı bir BFS ile ölçülür ve "cep" olmayan ilk aday seçilir.
   */
  findSpawnSpot(b) {
    const cands = [];
    for (let r = 1; r <= 4; r++) {
      for (let j = b.originJ - r; j <= b.j + r; j++) {
        for (let i = b.originI - r; i <= b.i + r; i++) {
          if (rectDist(i, j, b) !== r || !this.map.isWalkable(i, j)) continue;
          cands.push({ i, j, score: r * 100 - (i + j) }); // yakın + ön taraf (ekranda alt) önce
        }
      }
    }
    cands.sort((a, c) => a.score - c.score);
    for (const c of cands) if (this._regionSize(c.i, c.j, 120) >= 120) return c;
    return cands[0] ?? this.map.findWalkableNear(b.i + 1, b.j + 1, b.size + 6);
  }

  _regionSize(si, sj, limit) {
    const map = this.map, W = map.width, seen = new Set([sj * W + si]), q = [si, sj];
    for (let k = 0; k < q.length && seen.size < limit; k += 2) {
      const i = q[k], j = q[k + 1];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, key = nj * W + ni;
        if (seen.has(key) || !map.isWalkable(ni, nj)) continue;
        seen.add(key);
        q.push(ni, nj);
      }
    }
    return seen.size;
  }

  spawnUnitNear(b, type) {
    const naval = UNITS[type]?.naval;
    const spot = naval ? this.findWaterSpot(b) : this.findSpawnSpot(b);
    if (!spot) return null;
    const u = type === 'villager' ? new Villager(spot.i, spot.j, b.owner)
      : type === 'architect' ? new Architect(spot.i, spot.j, b.owner) : type === 'cart' ? new Cart(spot.i, spot.j, b.owner)
      : naval ? new Boat(spot.i, spot.j, b.owner) : new Soldier(type, spot.i, spot.j, b.owner);
    const hpBonus = this.players[b.owner].bonus[type]?.hp ?? 0;
    u.maxHp += hpBonus;
    u.hp = u.maxHp;
    this.units.push(u);
    return u;
  }

  // ───────────── Üretim kuyruğu ─────────────
  checkQueue(b, kind, id) {
    const p = this.players[b.owner];
    if (!b.complete) return 'Bina henüz tamamlanmadı';
    if (b.queue.length >= 10) return 'Kuyruk dolu';
    if (kind === 'unit') {
      if ((UNITS[id].age ?? 0) > p.age) return `${AGES[UNITS[id].age].name} gerekli`;
      return p.canAfford(UNITS[id].cost) ? null : 'Yetersiz kaynak';
    }
    if (kind === 'age') {
      const next = p.nextAge;
      if (!next) return 'Son çağdasınız';
      if (this.buildings.some((o) => o.owner === b.owner && o.queue.some((q) => q.kind === 'age'))) return 'Çağ araştırması sürüyor';
      // Kaynak yetmez: asker sayısı ve gerekli binalar da tamam olmalı (oyuncu için)
      if (b.owner === PLAYER && !this.ageReq(b.owner).ok) return 'Çağ şartları eksik';
      return p.canAfford(next.cost) ? null : 'Yetersiz kaynak';
    }
    if (kind === 'craft') {
      const it = ITEMS[id];
      if (it.kind === 'tool' && p.tools.has(id)) return 'Zaten üretildi';
      if (it.kind === 'tool' && this.buildings.some((o) => o.owner === b.owner && o.queue.some((q) => q.kind === 'craft' && q.id === id))) return 'Üretiliyor';
      return p.canAfford(it.cost) ? null : 'Yetersiz kaynak';
    }
    if (kind === 'tech') {
      const t = TECHS[id];
      if (p.techs.has(id)) return 'Araştırıldı';
      if (t.age > p.age) return `${AGES[t.age].name} gerekli`;
      if (t.requires && !p.techs.has(t.requires)) return `Önce ${TECHS[t.requires].name}`;
      if (this.buildings.some((o) => o.owner === b.owner && o.queue.some((q) => q.kind === 'tech' && q.id === id))) return 'Araştırılıyor';
      return p.canAfford(t.cost) ? null : 'Yetersiz kaynak';
    }
    if (kind === 'level') {
      if (!b.def.levels) return 'Yükseltilemez';
      if (b.level >= LEVELS.MAX_LEVEL) return 'En yüksek seviye';
      if (b.queue.some((q) => q.kind === 'level')) return 'Yükseltiliyor';
      return p.canAfford(this.upgradeCost(b)) ? null : 'Yetersiz kaynak';
    }
    return 'Bilinmeyen';
  }

  enqueue(b, kind, id) {
    const err = this.checkQueue(b, kind, id);
    if (err) { this.notify(err, 'warn'); return false; }
    const p = this.players[b.owner];
    let cost, time;
    if (kind === 'unit') { cost = UNITS[id].cost; time = UNITS[id].trainTime; }
    else if (kind === 'age') { const n = p.nextAge; cost = n.cost; time = n.time; id = n.id; }
    else if (kind === 'level') { cost = this.upgradeCost(b); time = LEVELS.time * b.level; id = b.level + 1; }
    else if (kind === 'craft') { cost = ITEMS[id].cost; time = ITEMS[id].time; }
    else { cost = TECHS[id].cost; time = TECHS[id].time; }
    p.spend(cost);
    b.queue.push({ kind, id, total: time, remaining: time, cost, started: kind !== 'unit' });
    return true;
  }

  cancelQueue(b, index) {
    const item = b.queue[index];
    if (!item) return;
    b.queue.splice(index, 1);
    this.players[b.owner].refund(item.cost);
    this.recountPopulation();
  }

  onQueueComplete(b, item) {
    const p = this.players[b.owner];
    if (item.kind === 'unit') {
      const u = this.spawnUnitNear(b, item.id);
      if (u && u.naval && b.rally?.target?.kind === 'fish' && this.isAlive(b.rally.target)) this.commandFish([u], b.rally.target);
      else if (u && u.naval && b.rally?.i !== undefined) this.commandMove([u], b.rally.i, b.rally.j);
      else if (u && u.naval) this.retargetBoat(u);
      else if (u && b.rally) {
        const t = b.rally.target;
        if (t && this.isAlive(t)) {
          if (t.owner && t.owner !== u.owner) this.commandAttack([u], t);
          else if (u.def.gatherer && (t.isResource || (t.isBuilding && t.def.farmFood && t.complete && !u.def.vehicle))) this.assignGather(u, t);
          else if (t.isBuilding && !t.complete && this.canBuild(u, t.type)) this.commandBuild([u], t);
          else this.commandMove([u], Math.round(t.centerI ?? t.i) + 1, Math.round(t.centerJ ?? t.j) + 1);
        } else if (b.rally.i !== undefined) {
          this.commandMove([u], b.rally.i, b.rally.j);
        }
      }
      if (b.owner === PLAYER) this.sound('bell', b.centerI, b.centerJ, 0.35);
      this.recountPopulation();
    } else if (item.kind === 'tech') {
      const t = TECHS[item.id];
      p.applyTech(item.id, t);
      // Bina canı artışı mevcut binalara da uygulanır
      if (t.effect?.bldgHp) for (const o of this.buildings) if (o.owner === b.owner) { o.maxHp = Math.round(o.maxHp * t.effect.bldgHp); o.hp = Math.min(o.maxHp, o.hp * t.effect.bldgHp); }
      // Can bonusu mevcut birimlere de uygulanır
      for (const [type, stats] of Object.entries(t.bonus ?? {})) {
        if (!stats.hp) continue;
        for (const u of this.units) if (u.owner === b.owner && u.type === type) { u.maxHp += stats.hp; u.hp += stats.hp; }
      }
      if (b.owner === PLAYER) { this.notify(`${t.name} araştırıldı.`, 'good'); this.sound('bell', null, null, 0.6); }
    } else if (item.kind === 'craft') {
      const it = ITEMS[item.id];
      if (it.kind === 'tool') {
        p.tools.add(item.id);
        for (const [k, v] of Object.entries(it.effect ?? {})) p.modifiers[k] = (p.modifiers[k] ?? 1) * v;
        if (b.owner === PLAYER) { this.notify(`${it.name} üretildi: etkisi kalıcı.`, 'good'); this.sound('bell', null, null, 0.6); }
      } else {
        p.items[item.id] = (p.items[item.id] ?? 0) + 1;
        if (b.owner === PLAYER) { this.notify(`${it.name} hazır (envanterde).`, 'good'); this.sound('bell', null, null, 0.5); }
      }
    } else if (item.kind === 'level') {
      b.level = Math.min(LEVELS.MAX_LEVEL, b.level + 1);
      if (b.def.farmFood) { b.food += b.def.farmFood * 0.5; this.map.groundVersion++; } // yükseltilen tarla tazelenir
      this.map.version++;
      if (b.owner === PLAYER) { this.notify(`${b.name} seviye ${b.level} oldu: üretim +%${Math.round(LEVELS.bonus * (b.level - 1) * 100)}.`, 'good'); this.sound('bell', b.centerI, b.centerJ, 0.6); }
    } else if (item.kind === 'age') {
      p.advanceAge();
      // Surlar ve kapılar yeni çağın taşına/kalesine dönüşür (daha kalın, daha sağlam)
      for (const o of this.buildings) if (o.owner === b.owner && o.def.tiers) this.applyTier(o, p.tier);
      this.map.version++; // tüm binaların görünümü yeni çağa geçer
      if (b.owner === PLAYER) { this.notify(`Yeni çağ: ${p.ageDef.name}!`, 'age'); this.sound('fanfare'); }
    }
  }

  /** Kendiliğinden gelir (tersane, hayvan çiftliği, sera, su değirmeni, altın eleme). Kesirli birikir, istatistiğe yazılır. */
  _passiveIncome(dt) {
    for (const b of this.buildings) {
      const inc = b.def.income;
      if (!inc || !b.complete) continue;
      const p = this.players[b.owner];
      for (const [res, rate] of Object.entries(inc)) p.add(res, rate * (p.modifiers[b.def.incomeMod] ?? 1) * this.levelMul(b) * dt);
    }
  }

  // ───────────── Pazar ─────────────
  trade(action, res) {
    const p = this.player, lot = MARKET.lot;
    if (action === 'sell') {
      if (p.resources[res] < lot) { this.notify(`Yetersiz ${RESOURCE_NAMES[res].toLowerCase()}`, 'warn'); return; }
      p.resources[res] -= lot; p.add('gold', MARKET.sell);
    } else {
      if (p.resources.gold < MARKET.buy) { this.notify('Yetersiz altın', 'warn'); return; }
      p.resources.gold -= MARKET.buy; p.add(res, lot);
    }
    p.version++;
  }

  // ═════════════════════ SAVAŞ ═════════════════════
  /** Birimden hedefe uzaklık: birim → merkezler arası; bina → ayak izi kenarına */
  distTo(u, t) {
    return t.isUnit ? Math.hypot(t.x - u.x, t.y - u.y) : rectEuclid(u.x, u.y, t);
  }

  inAttackRange(u, t) {
    const range = this.stat(u, 'range');
    const d = this.distTo(u, t);
    if (range <= 0) return t.isUnit ? d <= 1.5 : d <= 0.8; // yakın dövüş: bitişik (çapraz dahil)
    return d <= range;
  }

  /** Saldırı pozisyonuna git: yakın dövüşte bitişik karo, okçuda menzil içindeki herhangi bir karo */
  moveToAttack(u, t) {
    const range = this.stat(u, 'range');
    let fn;
    if (range <= 0) {
      fn = t.isUnit
        ? (i, j) => Math.max(Math.abs(i - t.tileI), Math.abs(j - t.tileJ)) <= 1
        : (i, j) => rectDist(i, j, t) <= 1;
    } else {
      const r = range - 0.35;
      fn = t.isUnit ? (i, j) => Math.hypot(i - t.x, j - t.y) <= r : (i, j) => rectEuclid(i, j, t) <= r;
    }
    const ti = t.isUnit ? t.tileI : Math.round(t.centerI), tj = t.isUnit ? t.tileJ : Math.round(t.centerJ);
    return this.moveToGoal(u, fn, ti, tj, 5000);
  }

  performAttack(u, t) {
    const dmg = this.stat(u, 'attack');
    if (this.stat(u, 'range') > 0) {
      this.spawnArrow(u.x, u.y, 22, t, dmg, u);
      if (u.def.splash) { const pr = this.projectiles[this.projectiles.length - 1]; pr.splash = u.def.splash; pr.stone = true; pr.dur *= 1.6; this.sound('ram', u.x, u.y, 0.5); }
      else this.sound('bow', u.x, u.y, 0.5);
    } else {
      this.damage(u, t, dmg, 'melee');
      if (u.def.siege) this.sound('ram', u.x, u.y, 0.8);
      else this.sound(t.isUnit ? 'sword' : 'hammer', u.x, u.y, t.isUnit ? 0.6 : 0.45);
    }
  }

  /** Ok: hedefe doğru kavisli uçar (hedef hareket ederse onu izler), varınca hasar verir */
  spawnArrow(x, y, z, target, damage, attacker, owner = attacker?.owner) {
    const tx = target.isUnit ? target.x : target.centerI, ty = target.isUnit ? target.y : target.centerJ;
    const d = Math.hypot(tx - x, ty - y);
    this.projectiles.push({ sx: x, sy: y, sz: z, tx, ty, target, damage, attacker, owner, p: 0, dur: Math.max(0.25, d / 9), d });
  }

  _updateProjectiles(dt) {
    if (!this.projectiles.length) return;
    const keep = [];
    for (const pr of this.projectiles) {
      if (this.isAlive(pr.target)) {
        pr.tx = pr.target.isUnit ? pr.target.x : pr.target.centerI;
        pr.ty = pr.target.isUnit ? pr.target.y : pr.target.centerJ;
      }
      pr.p += dt / pr.dur;
      if (pr.p >= 1) {
        if (pr.splash) this._splash(pr);
        else if (this.isAlive(pr.target)) {
          this.damage(pr.attacker?.dead ? null : pr.attacker, pr.target, pr.damage, 'pierce', pr.owner);
          this.sound('hit', pr.tx, pr.ty, 0.35);
        }
      } else keep.push(pr);
    }
    this.projectiles = keep;
  }

  /**
   * Hasar formülü (AoE): hasar = max(1, saldırı − zırh)
   *   yakın dövüş → yakın dövüş zırhı, ok → ok (pierce) zırhı; binalara karşı birimin bina çarpanı uygulanır.
   */
  damage(attacker, target, base, kind, owner = attacker?.owner) {
    if (!this.isAlive(target)) return;
    // Taş Deri İksiri: binalar hasar almaz
    if (target.isBuilding && (this.players[target.owner]?.effects.stoneSkin ?? 0) > this.time) return;
    if (target.isUnit) target._hurtAt = this.time;
    let amount = base, armor;
    if (target.isUnit) armor = this.stat(target, kind);
    else {
      armor = target.armor?.[kind] ?? 0;
      // Yaratık surlara karşı çok güçlü (wallMul), diğer binalara karşı yavaş (bldgMul)
      if (attacker?.isUnit) amount *= (target.def.wall || target.def.gate) && attacker.def.wallMul ? attacker.def.wallMul : attacker.def.bldgMul ?? 1;
    }
    const dmg = Math.max(1, amount - armor);
    target.hp -= dmg;
    if (target.owner === PLAYER || owner === PLAYER) this.lastCombatAt = this.time;
    if (target.owner === PLAYER) this._underAttack(target);
    if (target.hp <= 0) {
      if (target.isUnit) this.killUnit(target, owner);
      else this.destroyBuilding(target);
      return;
    }
    // Karşılık ver: boştaki birim saldırana döner
    if (target.isUnit && attacker?.isUnit && !attacker.dead && attacker.owner !== target.owner) {
      if (target.def.animal) { target.flee(this, attacker); return; }
      if (target.state === 'idle') target.attack(attacker);
      else if (target.state === 'guard') target.attack(attacker, 'guard');
      // Yakındaki boştaki askerler savaşa katılır (her iki taraf için)
      if (target.isMilitary) this.callAllies(target, attacker);
      if (attacker.isMilitary) this.callAllies(attacker, target);
    }
  }

  /**
   * Otomatik savaş: çatışan bir askerin (u) 7 karo yakınındaki BOŞTA / nöbetteki / saldırı yürüyüşündeki müttefik
   * askerler düşmana (foe) saldırır. Yürüyen ya da başka hedefle savaşan birimlere dokunulmaz.
   * Aynı asker için en fazla 0,5 sn'de bir çağrılır.
   */
  callAllies(u, foe) {
    if (u.owner === WILD || foe.def?.animal || this.time - (u._allyAt ?? -9) < 0.5) return;
    u._allyAt = this.time;
    this.grid.each(u.x, u.y, 7, (o) => {
      if (o === u || o.owner !== u.owner || o.dead || !o.isMilitary || o.target) return;
      if (o.def.siege && foe.isUnit) return;
      if (foe.naval && (o.def.range ?? 0) <= 0) return;
      if (o.state === 'idle') o.attack(foe);
      else if (o.state === 'guard') o.attack(foe, 'guard');
      else if (o.state === 'attackMove') o.attack(foe, 'attackMove');
    });
  }

  /** Mancınık taşı: isabet noktasının çevresindeki tüm düşman birim ve binalarına hasar (yakın dövüş türü) */
  _splash(pr) {
    const att = pr.attacker?.dead ? null : pr.attacker, R = pr.splash;
    this.grid.each(pr.tx, pr.ty, R + 0.5, (o) => {
      if (o.owner === pr.owner || o.dead || o.def.animal) return;
      if (Math.hypot(o.x - pr.tx, o.y - pr.ty) <= R) this.damage(att, o, pr.damage, 'melee', pr.owner);
    });
    for (const b of this.buildings) {
      if (b.owner === pr.owner || rectEuclid(pr.tx, pr.ty, b) > R) continue;
      this.damage(att, b, pr.damage, 'melee', pr.owner);
    }
    this.sound('collapse', pr.tx, pr.ty, 0.35);
    this.impacts = (this.impacts ?? []).concat([{ x: pr.tx, y: pr.ty, t: this.time }]).slice(-12);
  }

  killUnit(u, killerOwner) {
    u.dead = true;
    if (u.def.animal) { this._onAnimalKilled(u, killerOwner); return; }
    if (u.cargo?.length) this.unload(u, 0.5); // savaş arabası: içindekiler yarı canla kaçar
    if (u.owner === PLAYER) this.players[PLAYER].grief = (this.players[PLAYER].grief ?? 0) + 1.5;
    // Hastane: ölen askerin bir kısmı iyileşip geri döner
    if (u.isMilitary && !u.def.vehicle && u.type !== 'yeti') {
      const hosp = this.buildings.filter((b) => b.owner === u.owner && b.complete && b.def.revive);
      if (hosp.length && Math.random() < hosp[0].def.revive.chance) {
        hosp.sort((a, c) => rectEuclid(u.x, u.y, a) - rectEuclid(u.x, u.y, c));
        (hosp[0].revive ??= []).push({ type: u.type, t: hosp[0].def.revive.time });
        if (u.owner === PLAYER) this.notify(`Yaralı ${u.name.toLocaleLowerCase('tr')} hastaneye kaldırıldı (25 sn sonra döner).`, 'info');
      }
    }
    if (u.type === 'yeti') this.wild.onKilled(u, killerOwner);
    this.units = this.units.filter((x) => x !== u);
    this.corpses.push({ type: u.type, owner: u.owner, x: u.x, y: u.y, facing: u.facing, dir: u.dir, t: 0, naval: !!u.naval });
    this.players[u.owner].stats.losses++;
    if (killerOwner && this.players[killerOwner]) this.players[killerOwner].stats.kills++;
    this.sound('death', u.x, u.y, 0.6);
    for (const b of this.buildings) if (b.farmer === u) b.farmer = null;
    this.recountPopulation();
  }

  destroyBuilding(b) {
    this.ungarrison(b); // içeridekiler yıkıntıdan kaçar
    if (b.owner === PLAYER && !b.def.wall && !b.def.gate && !b.def.decor && b.type !== 'farm') {
      const p = this.player, keep = this.protectedShare(PLAYER);
      let lost = 0;
      for (const r of RESOURCE_TYPES) { const x = Math.floor(p.resources[r] * (1 - keep) * PLUNDER); p.resources[r] -= x; lost += x; }
      p.grief = (p.grief ?? 0) + 5;
      if (lost > 0) this.notify(`Yağma! ${lost} kaynak çalındı${keep > 0 ? ` (ambarlar %${Math.round(keep * 100)}'ünü korudu)` : ' — ambar kurarak koruyun'}.`, 'warn');
    }
    this.removeBuilding(b);
    this.map.addObject(new StaticObject('ruins', b.i, b.j, { size: b.size, blocks: false }));
    this.sound('collapse', b.centerI, b.centerJ, 0.8);
    if (b.owner === PLAYER) this.notify(`${b.name} yıkıldı!`, 'warn');
    else this.notify(`Düşman ${b.name.toLocaleLowerCase('tr')} yıkıldı!`, 'good');
    if (b.type === 'townCenter') {
      if (b.owner === ENEMY) this._win('Düşman Kasaba Merkezi yıkıldı! ZAFER!');
      else this._lose();
    }
  }

  _win(text) {
    if (this.victory || this.defeat) return;
    this.victory = true;
    this.notify(text, 'good');
    this.sound('fanfare');
  }

  _lose() {
    if (this.victory || this.defeat) return;
    this.defeat = true;
    this.notify('Kasaba Merkeziniz yıkıldı. YENİLGİ.', 'warn');
    this.sound('defeat');
  }

  _underAttack(target) {
    if (this.time - this._attackAlertAt < 15) return;
    this._attackAlertAt = this.time;
    const i = target.isUnit ? target.x : target.centerI, j = target.isUnit ? target.y : target.centerJ;
    this.notify('Saldırı altındasınız!', 'warn');
    this.sound('horn');
    this.alert(i, j);
  }

  /** Görüş alanındaki en yakın düşman (önce birimler; istenirse ardından binalar). Mekânsal ızgarayla aranır. */
  findEnemyNear(u, radius, includeBuildings) {
    if (u.owner !== PLAYER && u.isMilitary && !u.def.siege) return this._findByPriority(u, radius, includeBuildings);
    let best = null, bestD = radius;
    if (!u.def.siege) {
      const melee = (u.def.range ?? 0) <= 0;
      this.grid.each(u.x, u.y, radius, (o) => {
        if (o.owner === u.owner || o.dead || o.def.animal || (melee && o.naval)) return;
        const d = Math.hypot(o.x - u.x, o.y - u.y);
        if (d < bestD) { bestD = d; best = o; }
      });
    }
    if (best || !includeBuildings) return best;
    bestD = radius;
    for (const b of this.buildings) {
      if (b.owner === u.owner || b.type === 'farm' || b.def.wall || b.def.gate) continue;
      const d = rectEuclid(u.x, u.y, b);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /**
   * Düşman ve yaratık hedef önceliği: önce SURLAR/KAPILAR, sonra ASKERLER, sonra KÖYLÜLER, en son diğer BİNALAR.
   * Her sınıfta en yakın olan seçilir (koçbaşı bu kuralın dışındadır: yalnızca binalara gider).
   */
  _findByPriority(u, radius, includeBuildings) {
    const melee = (u.def.range ?? 0) <= 0;
    let wall = null, wd = radius;
    for (const b of this.buildings) {
      if (b.owner === u.owner || !(b.def.wall || b.def.gate)) continue;
      if (Math.abs(b.i - u.x) > radius + 1 || Math.abs(b.j - u.y) > radius + 1) continue;
      const d = rectEuclid(u.x, u.y, b);
      if (d < wd) { wd = d; wall = b; }
    }
    if (wall) return wall;
    let sol = null, sd = radius, vil = null, vd = radius;
    this.grid.each(u.x, u.y, radius, (o) => {
      if (o.owner === u.owner || o.dead || o.def.animal || (melee && o.naval)) return;
      const d = Math.hypot(o.x - u.x, o.y - u.y);
      if (o.isMilitary) { if (d < sd) { sd = d; sol = o; } } else if (d < vd) { vd = d; vil = o; }
    });
    if (sol || vil || !includeBuildings) return sol ?? vil;
    let best = null, bestD = radius;
    for (const b of this.buildings) {
      if (b.owner === u.owner || b.type === 'farm' || b.def.wall || b.def.gate) continue;
      const d = rectEuclid(u.x, u.y, b);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** Kasaba Merkezi ve kuleler menzile giren düşmana ok atar */
  _buildingAttacks(dt) {
    for (const b of this.buildings) {
      const atk = b.def.attack;
      if (!atk || !b.complete) continue;
      b.atkCd -= dt;
      if (b.atkCd > 0) continue;
      const bonus = b.type === 'watchTower' ? this.players[b.owner].bonus.tower ?? {} : {};
      const range = atk.range + (bonus.range ?? 0);
      let best = null, bestD = range;
      this.grid.each(b.centerI, b.centerJ, range + b.size, (u) => {
        if (u.owner === b.owner || u.dead || u.def.animal) return;
        const d = rectEuclid(u.x, u.y, b);
        if (d < bestD) { bestD = d; best = u; }
      });
      if (!best) { b.atkCd = 0.3; continue; }
      b.atkCd = atk.reload;
      // İçeri sığınan her 3 köylü bir ok daha attırır (AoE'deki gibi)
      const shots = 1 + Math.floor(b.garrison.length / 3);
      for (let k = 0; k < shots; k++) {
        this.spawnArrow(b.centerI + (k ? (Math.random() - 0.5) * b.size * 0.6 : 0), b.centerJ, 40 + b.size * 14, best, atk.damage + (bonus.attack ?? 0), null, b.owner);
      }
      this.sound('bow', b.centerI, b.centerJ, 0.4);
    }
  }
}

export { rectDist, rectEuclid, formatCost };
