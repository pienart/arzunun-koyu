import { PLAYER } from '../data/gameData.js';
import { Unit } from './Unit.js';

/**
 * Soldier (milis, okçu): savaş durum makinesi.
 *
 *   idle       : görüş alanını (LOS) periyodik tara → düşman birimi görürse 'attack'
 *   move       : sağ tıkla yürü (yoldaki düşmanları yok say), varınca 'idle'
 *   attack     : hedefi kovala/vur; hedef ölünce 'resume' durumuna dön
 *   attackMove : hedefe yürürken karşılaştığı her düşmanla savaş (düşman dalgaları bunu kullanır)
 *   guard      : nöbet noktasını koru; çok uzağa kovalarsa (tasma/leash) geri dön (düşman üs savunması)
 */
export class Soldier extends Unit {
  constructor(type, i, j, owner = PLAYER) {
    super(type, i, j, owner);
    this.post = null;        // guard: nöbet noktası
    this.moveGoal = null;    // attackMove: nihai hedef karo
    this.nextGoal = null;    // attackMove: ara noktadan sonra gidilecek asıl hedef (düşman dalgasının yönü)
    if (this.def.transport) this.cargo = []; // savaş arabası: içindeki askerler
  }

  get activity() {
    if (this.def.siege && this.state === 'attack') return 'Kapıya/duvara vuruyor';
    return { attack: 'Savaşıyor', move: 'Yürüyor', attackMove: 'Saldırı yürüyüşü', guard: 'Nöbette' }[this.state] ?? 'Hazır';
  }

  get animState() {
    if (this.def.siege || this.def.vehicle) return null; // koçbaşı, mancınık, savaş arabası: yönlü sabit görsel + Renderer'da yalpalama ve vuruş itmesi
    if (this.moving) return this._walkAnim(`${this.prefix}_walk`);
    if (this.engaged) return this._attackAnim({ archer: 'arc_shoot', cavalry: 'cav_attack' }[this.type] ?? 'mil_attack');
    return null;
  }

  get pose() {
    if (this.attackAnim > 0 && !this.moving) return this.type === 'archer' ? 'shoot' : 'attack';
    if (this.moving) return Math.floor(this.anim * 6.5) % 2 === 0 ? 'walk1' : 'walk2';
    return 'idle';
  }

  update(dt, world) {
    this.tick(dt);
    switch (this.state) {
      case 'idle': this._scan(world, false); break;
      case 'move': if (this.followPath(dt, world)) this.stop(); break;
      case 'attack':
        if (this._leashed(world) || !this.updateAttack(dt, world)) this._afterTarget(world);
        break;
      case 'attackMove': this._updateAttackMove(dt, world); break;
      case 'guard': this._updateGuard(dt, world); break;
      case 'board': this._updateBoard(dt, world); break;
      default: break;
    }
  }

  /** Görüş alanında düşman ara (0.4 sn'de bir; tüm birimler aynı karede taramasın diye zaman kaydırmalı) */
  /** Savaş arabasına bin: arabanın yanına yürü (araba hareket ediyorsa yolu yenile) */
  _updateBoard(dt, world) {
    const wg = this.task?.target;
    if (!wg || !world.isAlive(wg)) { this.stop(); return; }
    const adj = Math.max(Math.abs(this.tileI - wg.tileI), Math.abs(this.tileJ - wg.tileJ)) <= 1;
    if (adj || Math.hypot(wg.x - this.x, wg.y - this.y) < 2.6) { world.board(this, wg); return; }
    this.repathT -= dt;
    if (this.repathT <= 0 || !this.path.length) {
      this.repathT = 1;
      world.moveToGoal(this, (i, j) => Math.max(Math.abs(i - wg.tileI), Math.abs(j - wg.tileJ)) <= 1, wg.tileI, wg.tileJ, 4000);
    }
    this.followPath(dt, world);
  }

  attack(target, resume = null) {
    if (this.def.noAttack) return; // savaş arabası saldırmaz
    super.attack(target, resume);
  }

  _scan(world, includeBuildings, resume = null) {
    if (this.def.noAttack) return false;
    if (this.scanT > 0) return false;
    this.scanT = 0.4;
    const foe = world.findEnemyNear(this, this.def.los + (this.def.range > 0 ? 0 : 1), includeBuildings);
    if (foe) { this.attack(foe, resume); return true; }
    return false;
  }

  _afterTarget(world) {
    const r = this.resume;
    this.target = null;
    if (r === 'attackMove' && this.moveGoal) this.attackMoveTo(world, this.moveGoal.i, this.moveGoal.j);
    else if (r === 'guard' && this.post) this.guardAt(world, this.post.i, this.post.j);
    else { this.stop(); this.scanT = 0; }
  }

  _leashed(world) {
    if (this.resume !== 'guard' || !this.post) return false;
    return Math.hypot(this.x - this.post.i, this.y - this.post.j) > 11;
  }

  attackMoveTo(world, i, j, keepNext = false) {
    const next = this.nextGoal;
    this.stop();
    if (keepNext) this.nextGoal = next;
    this.state = 'attackMove';
    this.moveGoal = { i, j };
    world.moveToGoal(this, (a, b) => Math.abs(a - i) <= 2 && Math.abs(b - j) <= 2, i, j, 30000); // uzun yürüyüş → geniş arama bütçesi
  }

  guardAt(world, i, j) {
    this.stop();
    this.state = 'guard';
    this.post = { i, j };
    if (Math.hypot(this.x - i, this.y - j) > 0.6) world.moveToGoal(this, (a, b) => a === i && b === j, i, j);
  }

  _updateAttackMove(dt, world) {
    if (this._scan(world, true, 'attackMove')) return;
    // Yol bir düşman çitinden/kapısından geçiyorsa önce onu kır
    const next = this.path[0];
    if (next) {
      const wall = world.blockingWall(this, next[0], next[1]);
      if (wall) { this.attack(wall, 'attackMove'); return; }
    }
    if (this.followPath(dt, world)) {
      // Ara noktaya (saldırı yönü) varıldı → asıl hedefe saldırı yürüyüşü
      if (this.nextGoal) { const n = this.nextGoal; this.nextGoal = null; this.attackMoveTo(world, n.i, n.j); return; }
      // Hedefe vardı ama savaşacak kimse yok → haritadaki en yakın düşman yapısına/birimine yönel
      const foe = world.findEnemyNear(this, 999, true);
      if (foe) this.attack(foe, 'attackMove');
      else this.stop();
    }
  }

  _updateGuard(dt, world) {
    if (this._scan(world, true, 'guard')) return;
    this.followPath(dt, world);
  }
}
