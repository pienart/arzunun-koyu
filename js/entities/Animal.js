import { WILD } from '../data/gameData.js';
import { Unit } from './Unit.js';

/**
 * Yabani hayvan (ceylan, geyik, tavşan, yaban atı): sürüsünün merkezi (home) çevresinde otlar, ara sıra yer değiştirir;
 * saldırıya uğrayınca saldırandan uzağa kaçar. Askerler kendiliğinden saldırmaz; köylüler sağ tıkla avlar.
 * Öldüğünde yerinde et (carcass) kalır, avcının sahibi deri kazanır.
 */
export class Animal extends Unit {
  constructor(type, i, j, home) {
    super(type, i, j, WILD);
    this.home = home;          // { i, j } sürü merkezi (Animals sistemi taşır)
    this.grazeT = Math.random() * 6;
    this.fleeT = 0;
  }

  get activity() { return this.fleeT > 0 ? 'Kaçıyor' : 'Otluyor'; }
  get animState() { return null; }
  get pose() { return 'idle'; }

  /** Kaçarken hızlı, otlarken ağır */
  speed(world) { return this.def.speed * (this.fleeT > 0 ? 0.6 : 0.45); } // kaçarken bile köylü (1,8) yetişir

  attack() { /* hayvan saldırmaz */ }

  flee(world, from) {
    if (this.fleeT > 0 && this.path.length) return;
    this.fleeT = 3;
    const dx = this.x - (from?.x ?? this.x - 1), dy = this.y - (from?.y ?? this.y), d = Math.hypot(dx, dy) || 1;
    const ti = Math.round(this.x + (dx / d) * 4), tj = Math.round(this.y + (dy / d) * 4);
    const spot = world.map.findWalkableNear(ti, tj, 4);
    if (spot) world.moveToGoal(this, (i, j) => i === spot.i && j === spot.j, spot.i, spot.j, 1500);
  }

  update(dt, world) {
    this.tick(dt);
    if (this.fleeT > 0) this.fleeT -= dt;
    if (this.path.length) { this.followPath(dt, world); return; }
    this.grazeT -= dt;
    if (this.grazeT > 0) return;
    this.grazeT = 5 + Math.random() * 9;
    const r = 4;
    const i = Math.round(this.home.i + (Math.random() - 0.5) * 2 * r), j = Math.round(this.home.j + (Math.random() - 0.5) * 2 * r);
    if (world.map.isWalkable(i, j)) world.moveToGoal(this, (a, b) => a === i && b === j, i, j, 600);
  }
}
