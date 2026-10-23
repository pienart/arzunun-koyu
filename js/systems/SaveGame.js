import { StaticObject, ResourceNode } from '../world/GameMap.js';
import { Building } from '../entities/Building.js';
import { Villager } from '../entities/Villager.js';
import { Soldier } from '../entities/Soldier.js';
import { Boat } from '../entities/Boat.js';
import { Yeti } from '../entities/Yeti.js';
import { Architect, Cart, Prospector } from '../entities/Workers.js';
import { Animal } from '../entities/Animal.js';
import { UNITS, PLAYER, ENEMY, RESOURCE_NODES } from '../data/gameData.js';

/**
 * KAYIT / YÜKLEME (tarayıcı belleğinde tek yuva + otomatik kayıt yuvası)
 *
 * Harita tohumdan (seed) yeniden üretilir; üstüne yalnızca DEĞİŞENLER uygulanır:
 *   • arazi (düşman üssü çevresi toprağa çevrilir) → tam ızgara, base64
 *   • kaynak düğümleri: kalan miktar; listede olmayan (tükenmiş) düğümler kaldırılır
 *   • kütük, yıkıntı, kamp ateşi, binalar (inşaat, can, kuyruk, toplanma noktası, sığınanlar), birimler
 *   • oyuncular (kaynak, çağ, teknoloji, bonus, istatistik), düşman yapay zekâsı, sis, hava, oyun süresi
 * Birimlerin görevi (topla / inşa et / tamir / nöbet / saldırı yürüyüşü) hedef kimlikleriyle saklanır ve
 * yüklemede komut olarak yeniden verilir. Ceset, ok ve seçim kaydedilmez.
 */
// Sürüm 4: 224×224 harita. Daha eski kayıtlar (160×160) bu haritaya uymaz → yüklenmez, menüde görünmez.
const KEY = 'mi_save', AUTO = 'mi_autosave', VERSION = 4;

const b64 = (u8) => { let s = ''; for (let k = 0; k < u8.length; k += 8192) s += String.fromCharCode.apply(null, u8.subarray(k, k + 8192)); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export const SaveGame = {
  has(auto = false) { return !!this.meta(auto); },

  meta(auto = false) {
    try {
      const s = JSON.parse(localStorage.getItem(auto ? AUTO : KEY) ?? 'null');
      return s && s.v === VERSION ? { date: s.date, time: s.world.time, difficulty: s.difficulty } : null;
    } catch { return null; }
  },

  load(auto = false) {
    try {
      const s = JSON.parse(localStorage.getItem(auto ? AUTO : KEY) ?? 'null');
      return s && s.v === VERSION ? s : null;
    } catch { return null; }
  },

  /** Oyun bittiğinde: elle ve otomatik kayıt silinir */
  clear() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(AUTO); } catch { /* yok say */ }
  },

  /** @returns {boolean} başarılı mı (bellek dolu / gizli pencere → false) */
  save(game, auto = false) {
    try {
      const data = this.serialize(game);
      localStorage.setItem(auto ? AUTO : KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('Kayıt başarısız', e);
      return false;
    }
  },

  serialize(game) {
    const w = game.world, map = w.map;
    const terrain = new Uint8Array(map.width * map.height);
    for (let j = 0; j < map.height; j++) terrain.set(map.terrain[j], j * map.width);
    const resources = [], decor = [];
    for (let j = 0; j < map.height; j++) {
      for (let i = 0; i < map.width; i++) {
        const o = map.objects[j][i];
        if (!o || o.isBuilding) continue;
        if (o.isResource) resources.push([o.kind, i, j, Math.round(o.amount * 10) / 10]);
        else if (o.kind === 'stump' || o.kind === 'ruins') decor.push([o.kind, i, j, o.size, o.scale, o.flip ? 1 : 0, o.offX, o.offY]);
      }
    }
    const ref = (t) => (!t ? null : t.isBuilding ? { b: t.id } : t.isResource ? { r: [t.i, t.j] } : null);
    const unit = (u) => ({
      id: u.id, type: u.type, owner: u.owner, x: +u.x.toFixed(3), y: +u.y.toFixed(3), hp: u.hp, maxHp: u.maxHp,
      state: u.state, phase: u.phase, task: ref(u.task?.target), carry: u.carry ?? 0, carryType: u.carryType ?? null,
      lastKind: u.lastKind ?? null, lastPos: u.lastPos ?? null, post: u.post ?? null, moveGoal: u.moveGoal ?? null, dir: u.dir,
      cargo: u.cargo?.length ? u.cargo.map(unit) : undefined,
    });
    const players = {};
    for (const [id, p] of Object.entries(w.players)) {
      players[id] = { resources: p.resources, age: p.age, techs: [...p.techs], modifiers: p.modifiers, bonus: p.bonus, stats: p.stats, items: p.items, tools: [...p.tools], effects: p.effects, wine: p.wine, happiness: p.happiness };
    }
    return {
      v: VERSION, date: Date.now(), seed: w.seed, difficulty: w.difficulty, fog: game.fog.enabled,
      camera: { x: game.camera.x, y: game.camera.y, zoom: game.camera.zoom },
      world: {
        time: w.time, terrain: b64(terrain), resources, decor,
        campfire: w.campfire ? [w.campfire.i, w.campfire.j] : null,
        buildings: w.buildings.map((b) => ({
          id: b.id, type: b.type, oi: b.originI, oj: b.originJ, owner: b.owner, progress: b.progress, hp: b.hp,
          queue: b.queue, food: b.food, level: b.level, tier: b.tier, maxHp: b.maxHp, cost: b.cost, rally: b.rally ? (b.rally.target ? { t: ref(b.rally.target) } : { i: b.rally.i, j: b.rally.j }) : null,
          garrison: b.garrison.map(unit), troops: (b.troops ?? []).map(unit),
        })),
        units: w.units.map(unit),
        players, enemy: w.enemyAI.serialize(), wild: w.wild.serialize(), weather: w.weather.serialize(), explored: game.fog.serialize(),
        townCenter: w.townCenter?.id ?? null, enclosure: w.enclosure ?? null,
      },
    };
  },

  /**
   * Kaydı yeni kurulmuş (opts.save ile, başlangıç kurulumu yapılmamış) bir World'e uygular.
   * Game, World'ü { seed, difficulty, save } ile kurup bunu çağırır.
   */
  apply(world, data) {
    const d = data.world, map = world.map;
    // Arazi
    const terrain = unb64(d.terrain);
    for (let j = 0; j < map.height; j++) for (let i = 0; i < map.width; i++) map.terrain[j][i] = terrain[j * map.width + i];
    map._analyzeWater();
    // Kaynaklar: kayıttakiler kalır (miktarı güncellenir), olmayanlar tükenmiştir
    const keep = new Map(d.resources.map(([kind, i, j, amount]) => [`${kind}:${i}:${j}`, amount]));
    for (let j = 0; j < map.height; j++) {
      for (let i = 0; i < map.width; i++) {
        const o = map.objects[j][i];
        if (!o || !o.isResource) continue;
        const k = `${o.kind}:${i}:${j}`;
        if (keep.has(k)) { o.amount = keep.get(k); keep.delete(k); } else map.removeObject(o);
      }
    }
    for (const [k, amount] of keep) { // üretimde olmayan düğüm (olmamalı) → yine de ekle
      const [kind, i, j] = k.split(':');
      map.addObject(new ResourceNode(kind, +i, +j, { amount, blocks: kind !== 'fish' && kind !== 'carcass', size: RESOURCE_NODES[kind]?.size ?? 1 }));
    }
    for (const [kind, i, j, size, scale, flip, offX, offY] of d.decor) {
      if (!map.objects[j][i]) map.addObject(new StaticObject(kind, i, j, { size, scale, flip: !!flip, offX, offY, blocks: false }));
    }
    if (d.campfire && !map.occupancy[d.campfire[1]][d.campfire[0]]) world.campfire = map.addObject(new StaticObject('campfire', d.campfire[0], d.campfire[1], { blocks: true }));
    world.fishNodes = world.collectFish();

    // Oyuncular
    for (const [id, s] of Object.entries(d.players)) {
      const p = world.players[id];
      Object.assign(p.resources, s.resources);
      p.age = s.age; p.techs = new Set(s.techs); Object.assign(p.modifiers, s.modifiers); p.bonus = s.bonus; p.stats = s.stats;
      p.items = s.items ?? {}; p.tools = new Set(s.tools ?? []); p.effects = s.effects ?? {};
      p.wine = s.wine ?? 0; p.happiness = s.happiness ?? 60; p.resources.hide ??= 0; p.stats.gathered.hide ??= 0; p.stats.spent ??= { food: 0 };
    }

    // Binalar (önce hepsi, sonra referanslar)
    const byId = new Map();
    for (const s of d.buildings) {
      const b = world.addBuilding(s.type, s.oi, s.oj, s.owner, s.progress >= 1);
      if (s.tier !== undefined) world.applyTier(b, s.tier);
      if (s.maxHp) b.maxHp = s.maxHp;
      if (s.cost) b.cost = s.cost;
      b.level = s.level ?? 1;
      b.progress = s.progress; b.hp = s.hp; b.food = s.food ?? b.food; b.queue = s.queue ?? [];
      b._visualStep = Math.floor(b.progress * 10);
      byId.set(s.id, b);
    }
    world.townCenter = byId.get(d.townCenter) ?? world.buildings.find((b) => b.owner === PLAYER && b.type === 'townCenter') ?? null;
    const target = (r) => (!r ? null : r.b !== undefined ? byId.get(r.b) ?? null : map.objects[r.r[1]]?.[r.r[0]] ?? null);

    // Birimler
    const make = (s) => {
      const def = UNITS[s.type];
      const u = def?.animal ? new Animal(s.type, s.x, s.y, { i: Math.round(s.x), j: Math.round(s.y) }) : s.type === 'yeti' ? new Yeti(s.x, s.y) : s.type === 'architect' ? new Architect(s.x, s.y, s.owner) : s.type === 'cart' ? new Cart(s.x, s.y, s.owner) : s.type === 'prospector' ? new Prospector(s.x, s.y, s.owner) : s.type === 'villager' ? new Villager(s.x, s.y, s.owner) : def?.naval ? new Boat(s.x, s.y, s.owner) : new Soldier(s.type, s.x, s.y, s.owner);
      u.maxHp = s.maxHp; u.hp = s.hp; u.dir = s.dir ?? 0;
      if ('carry' in u) { u.carry = s.carry; if (s.carryType) u.carryType = s.carryType; }
      u.lastKind = s.lastKind; u.lastPos = s.lastPos;
      if (s.cargo && u.cargo) for (const c of s.cargo) { const m = make(c); m.boarded = u; u.cargo.push(m); }
      return u;
    };
    const orders = [];
    for (const s of d.units) { const u = make(s); world.units.push(u); orders.push([u, s]); }
    for (const s of d.buildings) {
      const b = byId.get(s.id);
      for (const g of s.garrison ?? []) { const u = make(g); u.garrisoned = b; b.garrison.push(u); }
      for (const t of s.troops ?? []) { const u = make(t); u.garrisoned = b; (b.troops ??= []).push(u); }
      if (s.rally) b.rally = s.rally.t ? { target: target(s.rally.t) } : { i: s.rally.i, j: s.rally.j };
      if (b.rally?.target === null) b.rally = null;
    }
    world.enemyAI.restore(d.enemy, byId);
    world.weather.restore(d.weather);
    world.wild.restore(d.wild); // mağara (eski kayıtta yoksa yeni bir yere konur)
    world.portals.setup();
    world.animals.adopt(world.units.filter((u) => u.def.animal));
    world.meat = world.collectKind('carcass');      // geçitler her dakika zaten yer değiştirir: yeni yerlerde başlar
    world.time = d.time;
    world.enclosure = d.enclosure ?? null;

    // Görevleri yeniden ver
    for (const [u, s] of orders) {
      const t = target(s.task);
      try {
        if (u.type === 'yeti') world.wild.attach(u);
        else if (s.state === 'gather' && t && world.isAlive(t)) world.assignGather(u, t, true);
        else if (s.state === 'build' && t && world.isAlive(t)) world.commandBuild([u], t);
        else if (s.state === 'repair' && t && world.isAlive(t)) world.commandRepair([u], t);
        else if (s.state === 'fish' && t && world.isAlive(t)) world.commandFish([u], t);
        else if (s.state === 'garrison' && t && world.isAlive(t)) world.ringBellUnit(u, t);
        else if (s.state === 'patrol' && u.startPatrol) u.startPatrol(world);
        else if (s.state === 'guard' && s.post) u.guardAt(world, s.post.i, s.post.j);
        else if (s.state === 'attackMove' && s.moveGoal) u.attackMoveTo(world, s.moveGoal.i, s.moveGoal.j);
        else if (u.type === 'villager' && u.owner === ENEMY) world.enemyAI._giveJob(u);
      } catch { u.stop(); }
    }
    world.recountPopulation();
    map.version++;
    map.groundVersion++;
  },
};
