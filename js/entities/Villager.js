import { UNITS, GATHER_RATES, PLAYER } from '../data/gameData.js';
import { Unit } from './Unit.js';
import { ANIMS } from '../data/animData.js';

const DEF = UNITS.villager;
const WORK_SOUND = { wood: 'chop', gold: 'mine', stone: 'mine' };
const WORK_ANIM = { wood: 'vil_chop', gold: 'vil_mine', stone: 'vil_mine', food: 'vil_gather' };

/**
 * Villager (köylü): sonlu durum makinesi (FSM).
 *
 *   idle ──sağ tık──▶ move ──varış──▶ idle
 *   gather: toNode ──▶ work ──(kapasite dolu)──▶ toDrop ──(bıraktı)──▶ toNode ...
 *   build : toSite ──▶ work ──(tamamlandı)──▶ (çiftlik ise gather / kamp ise otomatik toplama / idle)
 *   attack: hedefe yürü ve vur (zayıf; saldırıya uğrayınca boştaysa karşılık verir)
 */
export class Villager extends Unit {
  constructor(i, j, owner = PLAYER) {
    super('villager', i, j, owner);
    this.dropTarget = null;
    this.carryType = null;
    this.carry = 0;
    this.lastKind = null;  // son toplanan kaynak türü (tükenince benzerini bulmak için)
    this.lastPos = null;
    this._workPhase = Math.random(); // köylüler aynı anda vurmasın
  }

  /** Durum metni (UI için) */
  get activity() {
    if (this.state === 'attack') return 'Saldırıyor';
    if (this.state === 'build') return 'İnşa ediyor';
    if (this.state === 'repair') return 'Tamir ediyor';
    if (this.state === 'garrison') return 'Sığınağa koşuyor';
    if (this.state === 'gather') {
      const t = this.task?.target;
      if (this.phase === 'toDrop') return 'Kaynağı taşıyor';
      if (t?.isBuilding) return 'Çiftçilik yapıyor';
      return { wood: 'Odun kesiyor', food: 'Meyve topluyor', gold: 'Altın kazıyor', stone: 'Taş kırıyor' }[t?.resType] ?? 'Topluyor';
    }
    if (this.state === 'move') return 'Yürüyor';
    return 'Boşta';
  }

  /** Animasyon karesi (Renderer kullanır) */
  get pose() {
    if (this.moving) {
      if (this.carry > 0 && this.carryType === 'wood') return 'carry';
      return Math.floor(this.anim * 7) % 2 === 0 ? 'walk1' : 'walk2';
    }
    if (this.state === 'attack') return this.attackAnim > 0 ? 'chop' : 'idle';
    if (this.phase === 'work') {
      const swing = Math.floor(this.anim * 2.6) % 2 === 0;
      if (this.state === 'build') return swing ? 'build' : 'idle';
      const target = this.task?.target;
      if (target?.isBuilding) return swing ? 'gather' : 'idle'; // çiftlik
      const work = { wood: 'chop', gold: 'mine', stone: 'mine', food: 'gather' }[target?.resType] ?? 'idle';
      return swing ? work : 'idle';
    }
    return 'idle';
  }

  /** Hangi iş animasyonu? (inşa → çekiç, çiftlik → hasat, kaynak türüne göre balta/kazma/toplama) */
  get workAnim() {
    if (this.phase !== 'work') return null;
    if (this.state === 'build' || this.state === 'repair') return 'vil_build';
    const t = this.task?.target;
    if (t?.isBuilding) return 'vil_gather';
    return WORK_ANIM[t?.resType] ?? null;
  }

  get animState() {
    if (this.moving) return this._walkAnim(this.carry > 0 && this.carryType === 'wood' ? 'vil_carry' : 'vil_walk');
    if (this.state === 'attack') return this.engaged ? this._attackAnim('vil_chop') : null;
    const work = this.workAnim;
    if (work) return { name: work, phase: this._workPhase };
    return null;
  }

  _canEnter(i, j) {
    const t = this.task?.target;
    return t?.isBuilding && !t.blocks && i >= t.originI && i <= t.i && j >= t.originJ && j <= t.j;
  }

  update(dt, world) {
    this.tick(dt);
    switch (this.state) {
      case 'move': if (this.followPath(dt, world)) this.stop(); break;
      case 'gather': this._updateGather(dt, world); break;
      case 'build': this._updateBuild(dt, world); break;
      case 'repair': this._updateRepair(dt, world); break;
      case 'garrison': this._updateGarrison(dt, world); break;
      case 'attack': if (!this.updateAttack(dt, world)) this.stop(); break;
      default: break;
    }
    // İş döngüsü: animasyon karesi ve ses aynı fazdan beslenir → balta ağaca değdiği anda "tak" sesi
    const work = this.workAnim;
    if (work && !this.moving) {
      const a = ANIMS[work];
      const before = this._workPhase;
      this._workPhase = (before + dt / a.period) % 1;
      const crossed = before < a.hit ? this._workPhase >= a.hit || this._workPhase < before : this._workPhase >= a.hit && this._workPhase < before;
      if (crossed) {
        const snd = this.state === 'build' || this.state === 'repair' ? 'hammer' : WORK_SOUND[this.task?.target?.resType];
        if (snd) world.sound(snd, this.x, this.y, 0.55);
      }
    }
  }

  _updateGather(dt, world) {
    const node = this.task?.target;
    const me = world.players[this.owner];

    if (this.phase === 'toDrop') {
      if (!this.dropTarget || !world.isAlive(this.dropTarget)) {
        if (!world.sendToDropsite(this)) { this.stop(); return; }
      }
      if (this.followPath(dt, world)) {
        if (world.isAt(this, this.dropTarget)) {
          me.add(this.carryType, this.carry);
          this.carry = 0;
          if (node && world.isAlive(node)) {
            this.phase = 'toNode';
            world.moveToTarget(this, node);
          } else if (!world.retarget(this)) {
            this.stop();
          }
        } else if (!world.sendToDropsite(this)) {
          this.stop();
        }
      }
      return;
    }

    if (!node || !world.isAlive(node)) {
      if (!world.retarget(this)) {
        if (this.carry > 0) { this.task = null; this.phase = 'toDrop'; world.sendToDropsite(this); }
        else this.stop();
      }
      return;
    }

    if (this.phase === 'toNode') {
      if (this.followPath(dt, world)) {
        if (world.isAt(this, node)) this.phase = 'work';
        else if (!world.moveToTarget(this, node)) this.stop();
      }
      return;
    }

    // phase === 'work'
    if (!world.isAt(this, node)) { this.phase = 'toNode'; world.moveToTarget(this, node); return; }
    this.face(node);
    const type = node.isBuilding ? 'food' : node.resType;
    if (this.carryType !== type) { this.carryType = type; this.carry = 0; }
    const rateKey = node.isBuilding ? 'farm' : type;
    const mods = me.modifiers;
    const cap = DEF.carry * mods.carry;
    const season = rateKey === 'farm' ? world.weather.farmMul : 1;
    const diff = this.owner !== PLAYER ? world.diff.enemyGather : 1;
    const want = Math.min(GATHER_RATES[rateKey] * mods[rateKey] * season * diff * dt, cap - this.carry);
    const got = world.takeFromNode(node, want);
    this.carry += got;
    this.lastKind = node.isBuilding ? 'farm' : node.kind;
    this.lastPos = { i: node.i, j: node.j };
    if (this.carry >= cap - 1e-6 || !world.isAlive(node)) {
      this.phase = 'toDrop';
      if (!world.sendToDropsite(this)) this.stop();
    }
  }

  /** Tamir: inşaat gibi yanına git ve çekiçle; can dolunca veya kaynak bitince dur */
  _updateRepair(dt, world) {
    const b = this.task?.target;
    if (!b || !world.isAlive(b) || b.hp >= b.maxHp) { this.stop(); return; }
    if (this.phase === 'toSite') {
      if (this.followPath(dt, world)) {
        if (world.isAt(this, b)) this.phase = 'work';
        else if (!world.moveToTarget(this, b)) this.stop();
      }
      return;
    }
    if (!world.isAt(this, b)) { this.phase = 'toSite'; world.moveToTarget(this, b); return; }
    this.face(b);
    if (!world.repairTick(this, b, dt)) this.stop();
  }

  /** "Köylüleri Çağır": binaya koş ve içeri gir */
  _updateGarrison(dt, world) {
    const b = this.task?.target;
    if (!b || !world.isAlive(b)) { this.stop(); return; }
    if (this.followPath(dt, world)) {
      if (world.isAt(this, b)) world.enterGarrison(this, b);
      else if (!world.moveToTarget(this, b)) this.stop();
    }
  }

  _updateBuild(dt, world) {
    const b = this.task?.target;
    if (!b || !world.isAlive(b)) { this.stop(); return; }
    if (b.complete) { world.afterBuild(this, b); return; }
    if (this.phase === 'toSite') {
      if (this.followPath(dt, world)) {
        if (world.isAt(this, b)) this.phase = 'work';
        else if (!world.moveToTarget(this, b)) this.stop();
      }
      return;
    }
    if (!world.isAt(this, b)) { this.phase = 'toSite'; world.moveToTarget(this, b); return; }
    this.face(b);
    b.addProgress(dt, world);
  }
}
