import { UNITS, GATHER_RATES, PLAYER } from '../data/gameData.js';
import { Unit } from './Unit.js';

/**
 * Boat (balıkçı teknesi): yalnızca suda yüzer.
 *   idle ──sağ tık──▶ move ──varış──▶ idle
 *   fish: toNode ──▶ work (ağ atar) ──(dolu)──▶ toDrop (en yakın kendi tersanesi) ──▶ toNode ...
 * Yol bulma World.passFor(teknesi) ile su karolarında yapılır; tersaneye "varmak" = ayak izine bitişik su karosu.
 */
export class Boat extends Unit {
  constructor(i, j, owner = PLAYER) {
    super('fishingBoat', i, j, owner);
    this.naval = true;
    this.carry = 0;
    this.carryType = 'food';
    this.dropTarget = null;
    this._netT = Math.random() * 2;
  }

  get activity() {
    if (this.state === 'fish') return this.phase === 'toDrop' ? 'Balığı tersaneye taşıyor' : this.phase === 'work' ? 'Ağ atıyor' : 'Balık sürüsüne gidiyor';
    if (this.state === 'move') return 'Yüzüyor';
    return 'Demirli';
  }

  /** Su yüzeyinde: yönlü sabit görsel (Renderer sallar) */
  get pose() { return 'idle'; }

  canWalk(world, i, j) { return world.isNavigable(i, j); }

  update(dt, world) {
    this.tick(dt);
    switch (this.state) {
      case 'move': if (this.followPath(dt, world)) this.stop(); break;
      case 'fish': this._updateFish(dt, world); break;
      default: break;
    }
  }

  _updateFish(dt, world) {
    const node = this.task?.target, me = world.players[this.owner];
    if (this.phase === 'toDrop') {
      if (!this.dropTarget || !world.isAlive(this.dropTarget)) {
        if (!world.sendBoatToDock(this)) { this.stop(); return; }
      }
      if (this.followPath(dt, world)) {
        if (world.isAtDock(this, this.dropTarget)) {
          me.add('food', this.carry);
          this.carry = 0;
          world.sound('net', this.x, this.y, 0.35);
          if (node && world.isAlive(node)) { this.phase = 'toNode'; world.moveToTarget(this, node); }
          else if (!world.retargetBoat(this)) this.stop();
        } else if (!world.sendBoatToDock(this)) this.stop();
      }
      return;
    }
    if (!node || !world.isAlive(node)) {
      if (!world.retargetBoat(this)) {
        if (this.carry > 0) { this.phase = 'toDrop'; world.sendBoatToDock(this); } else this.stop();
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
    if (!world.isAt(this, node)) { this.phase = 'toNode'; world.moveToTarget(this, node); return; }
    this.face(node);
    const cap = UNITS.fishingBoat.carry;
    const got = world.takeFromNode(node, Math.min(GATHER_RATES.fish * me.modifiers.fish * dt, cap - this.carry));
    this.carry += got;
    this._netT -= dt;
    if (this._netT <= 0) { this._netT = 2.2 + Math.random(); world.sound('net', this.x, this.y, 0.25); }
    if (this.carry >= cap - 1e-6 || !world.isAlive(node)) {
      this.phase = 'toDrop';
      if (!world.sendBoatToDock(this)) this.stop();
    }
  }
}
