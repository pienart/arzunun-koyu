import { WILD } from '../data/gameData.js';
import { Soldier } from './Soldier.js';

/**
 * Yeti (Koca Ayak): mağaradaki yaratık. Davranışı Wild sistemi yönetir; kendisi bir askerin saldırı yürüyüşünü
 * kullanır (yolundaki her birim ve yapıyla savaşır, surları kırarak geçer).
 *   hunt   : hedef üsse saldırı yürüyüşü (Soldier.attackMove)
 *   home   : kış bitti → mağaraya dönüş (saldırıya karşılık vermez, yalnızca yürür)
 */
export class Yeti extends Soldier {
  constructor(i, j) {
    super('yeti', i, j, WILD);
    this.home = false;
  }

  get activity() {
    if (this.home) return 'Mağarasına dönüyor';
    return this.state === 'attack' ? 'Saldırıyor' : 'Av peşinde';
  }

  get animState() {
    if (this.moving) return this._walkAnim('yeti_walk');
    if (this.engaged) return this._attackAnim('yeti_attack');
    return null;
  }

  get pose() { return 'idle'; }

  /** Eve dönerken saldırılara karşılık vermez (yolunu bozmasın) */
  attack(target, resume = null) {
    if (this.home) return;
    super.attack(target, resume);
  }

  update(dt, world) {
    if (this.home) {
      this.tick(dt);
      if (this.followPath(dt, world)) world.wild.enterCave(this);
      return;
    }
    super.update(dt, world);
  }
}
