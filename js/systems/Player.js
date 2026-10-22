import { AGES, START, RESOURCE_TYPES } from '../data/gameData.js';

/**
 * Player: bir oyuncunun ekonomik durumu (kaynaklar, nüfus, çağ, teknolojiler, birim bonusları).
 * Hem siz hem de düşman yapay zekâ birer Player örneğidir.
 */
export class Player {
  constructor(id) {
    this.id = id;
    this.resources = { ...START.resources };
    this.age = 0;
    this.techs = new Set();
    // Ekonomi çarpanları (toplama/taşıma/hız)
    this.modifiers = { food: 1, wood: 1, gold: 1, stone: 1, hide: 1, farm: 1, fish: 1, carry: 1, speed: 1, ranch: 1, bldgHp: 1, regen: 0, winterProof: 0, huntBonus: 0 };
    this.items = {};          // simya: iksir stoku { id: adet }
    this.tools = new Set();   // simya: üretilmiş kalıcı aletler
    this.effects = {};        // etkin iksirler: { id: bitiş zamanı (oyun sn) }
    // Birim türüne eklenen savaş bonusları: bonus.militia.attack = 3 gibi
    this.bonus = {};
    this.popCap = 0;
    this.population = 0;
    this.stats = { gathered: { food: 0, wood: 0, gold: 0, stone: 0, hide: 0 }, spent: { food: 0 }, kills: 0, losses: 0 };
    this.wine = 0;            // şarap mahzeninin ürettiği, tavernaların tükettiği şarap
    this.happiness = 60;      // huzur (0–100)
    this.happyFactors = {};   // arayüz için: huzuru oluşturan kalemler
    this.version = 0;
  }

  get ageDef() { return AGES[this.age]; }
  get nextAge() { return AGES[this.age + 1] ?? null; }
  get tier() { return AGES[this.age].tier; }

  canAfford(cost = {}) { return Object.entries(cost).every(([k, v]) => this.resources[k] >= v); }

  spend(cost = {}) {
    if (!this.canAfford(cost)) return false;
    for (const [k, v] of Object.entries(cost)) this.resources[k] -= v;
    this.version++;
    return true;
  }

  refund(cost = {}) {
    for (const [k, v] of Object.entries(cost)) this.resources[k] += v;
    this.version++;
  }

  add(type, amount) {
    if (!RESOURCE_TYPES.includes(type) || amount <= 0) return;
    this.resources[type] += amount;
    this.stats.gathered[type] += amount;
    this.version++;
  }

  addBonus(unitType, stat, value) {
    this.bonus[unitType] ??= {};
    this.bonus[unitType][stat] = (this.bonus[unitType][stat] ?? 0) + value;
  }

  applyTech(id, def) {
    this.techs.add(id);
    for (const [k, v] of Object.entries(def.effect ?? {})) this.modifiers[k] = (this.modifiers[k] ?? 1) * v;
    for (const [k, v] of Object.entries(def.add ?? {})) this.modifiers[k] = (this.modifiers[k] ?? 0) + v;
    for (const [unit, stats] of Object.entries(def.bonus ?? {})) {
      for (const [stat, v] of Object.entries(stats)) this.addBonus(unit, stat, v);
    }
    this.version++;
  }

  advanceAge() {
    if (this.age < AGES.length - 1) this.age++;
    this.version++;
  }
}
