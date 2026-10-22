import { PLAYER } from '../data/gameData.js';
import { Villager } from './Villager.js';

/**
 * Mimar (Üniversite): köylü gibi yürür ve inşa eder, ama YALNIZCA süslemeleri (patika, çiçek tarhı, süs ağacı) kurar.
 * Kaynak toplamaz. Kendi animasyonları vardır (arch_walk, arch_build); yoksa durağan görsele düşer.
 */
export class Architect extends Villager {
  constructor(i, j, owner = PLAYER) { super(i, j, owner, 'architect'); }

  get activity() {
    if (this.state === 'build') return 'Şehri güzelleştiriyor';
    if (this.state === 'move') return 'Yürüyor';
    return 'Hazır';
  }

  get animState() {
    if (this.moving) return this._walkAnim('arch_walk');
    if (this.phase === 'work' && this.state === 'build') return { name: 'arch_build', phase: this._workPhase };
    return null;
  }
}

/**
 * Yük Arabası (İmparatorluk Çağı): kaynağa gider, büyük bir yük alır (köylünün 6 katı) ve YALNIZCA Kasaba Merkezi'ne
 * boşaltır. Köylünün toplama durum makinesini kullanır; görseli 8 yönlü sabit araç görselidir (Renderer sallar).
 */
export class Cart extends Villager {
  constructor(i, j, owner = PLAYER) { super(i, j, owner, 'cart'); }

  get activity() {
    if (this.state === 'gather') {
      if (this.phase === 'toDrop') return `Yükü Kasaba Merkezi'ne taşıyor (${Math.floor(this.carry)})`;
      if (this.phase === 'work') return 'Yükleniyor';
      return 'Kaynağa gidiyor';
    }
    return this.state === 'move' ? 'Yolda' : 'Hazır';
  }

  get animState() { return null; }
  get workAnim() { return null; } // balta/kazma sesi yok
}
