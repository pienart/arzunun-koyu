import { StaticObject } from '../world/GameMap.js';
import { BUILDINGS, PLAYER } from '../data/gameData.js';

let NEXT_ID = 1;

/**
 * Building: oyuncunun veya düşmanın binası. Haritada StaticObject olarak durur (statik katmanda çizilir),
 * ama durumu vardır: inşaat ilerlemesi, can, üretim kuyruğu, toplanma noktası, ok atma bekleme süresi.
 */
export class Building extends StaticObject {
  constructor(type, oi, oj, { complete = false, owner = PLAYER } = {}) {
    const def = BUILDINGS[type];
    // Çapa = ayak izinin ön köşesi (oi + size − 1, oj + size − 1)
    super(type, oi + def.size - 1, oj + def.size - 1, { size: def.size, blocks: !def.walkable });
    this.id = NEXT_ID++;
    this.type = type;
    this.def = def;
    this.owner = owner;
    this.isBuilding = true;
    this.destroyed = false;
    this.maxHp = def.hp;
    this.progress = complete ? 1 : 0;
    this.hp = complete ? def.hp : 1;
    this.queue = [];      // { kind: 'unit'|'tech'|'age', id, total, remaining, cost, started }
    this.rally = null;    // { i, j } veya { target }
    this.food = def.farmFood ?? 0; // çiftlik kalan yiyecek
    this.farmer = null;
    this.builders = 0;    // bu tick'te inşa eden köylü sayısı (World hesaplar)
    this.repairers = 0;   // bu tick'te tamir eden köylü sayısı
    this.garrison = [];   // içeri sığınmış köylüler (haritadan kalkarlar, ok atışını güçlendirirler)
    this.atkCd = Math.random();
    this.level = 1;       // üretim binası seviyesi (LEVELS)
    this.tier = 0;        // sur/kapı: inşa edildiği/yükseltildiği çağ görünümü (World.applyTier)
    this._visualStep = complete ? 10 : 0;
  }

  get complete() { return this.progress >= 1; }
  /** Kapı, aynı hattaki önündeki çit parçasından sonra çizilir (geniş çit görseli kapıyı örtmesin) */
  get depth() { return super.depth + (this.def.gate ? 1.05 : 0); }
  get name() { return this.def.tiers?.[this.tier]?.name ?? this.def.name; }
  /** Zırh: sur/kapıda çağ kademesinin değeri */
  get armor() { return this.def.tiers?.[this.tier]?.armor ?? this.def.armor ?? { melee: 0, pierce: 0 }; }
  /** Ayak izi merkezi (grid, kesirli) */
  get centerI() { return this.originI + (this.size - 1) / 2; }
  get centerJ() { return this.originJ + (this.size - 1) / 2; }

  /**
   * İnşaat ilerlemesi. AoE formülü: n köylü ile toplam süre = 3t / (n + 2).
   * Bu metot her köylü için ayrı çağrılır; toplam hız (n + 2) / 3 olsun diye
   * tek bir köylünün katkısı (n + 2) / (3n) olur → her ek köylü biraz daha az katkı yapar (azalan verim).
   */
  addProgress(dt, world) {
    if (this.complete) return;
    const n = Math.max(1, this.builders);
    const factor = (n + 2) / (3 * n);
    const before = this.progress;
    this.progress = Math.min(1, this.progress + (dt / this.def.buildTime) * factor);
    // Can, ilerleme ile birlikte artar (hasar almış inşaat da tamamlanabilsin diye fark olarak eklenir)
    this.hp = Math.min(this.maxHp, this.hp + (this.progress - before) * this.maxHp);
    const step = Math.floor(this.progress * 10);
    if (step !== this._visualStep) {
      this._visualStep = step;
      // Diğer binalar inşaat boyunca statik iskeledir; yalnızca çiftliğin toprağı %10 adımlarla koyulaşır
      if (this.type === 'farm') world.map.groundVersion++;
    }
    if (this.complete) world.onBuildingComplete(this);
  }

  update(dt, world) {
    if (!this.complete || this.queue.length === 0) return;
    const item = this.queue[0];
    const owner = world.players[this.owner];
    if (item.kind === 'unit' && !item.started) {
      // Nüfus kontrolü: üretim ancak boş nüfus varsa başlar (üretilen birim de nüfusa sayılır)
      if (owner.population >= owner.popCap) {
        if (this.owner === PLAYER) world.warnPopCap();
        return;
      }
      item.started = true;
      world.recountPopulation();
    }
    item.remaining -= dt;
    if (item.remaining <= 0) {
      this.queue.shift();
      world.onQueueComplete(this, item);
    }
  }
}
