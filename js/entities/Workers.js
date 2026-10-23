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

const SEEK = { wood: ['tree'], food: ['berry', 'carcass'], gold: ['gold', 'goldReserve'], stone: ['stone', 'quarry'] };

/**
 * Araştırmacı (Üniversite): seçilen kaynağı (odun, yiyecek, altın, taş ya da deri) TÜM haritada arar. En yakın uygun
 * kaynağa arabasıyla gider, köylünün 20 katı yük alır ve en yakın kabul eden binaya boşaltır. Kaynak bitince
 * kendiliğinden yenisini arar. Deri için yabani hayvan avlar (deri anında gelir, et toplanıp getirilir).
 * Düşman köyünün çevresindeki kaynaklara gitmez. 8 yönlü animasyonlu arabası vardır (pro_walk).
 */
export class Prospector extends Villager {
  constructor(i, j, owner = PLAYER) {
    super(i, j, owner, 'prospector');
    this.searchKind = null;
    this._seekT = 0;
  }

  get activity() {
    const names = { wood: 'odun', food: 'yiyecek', gold: 'altın', stone: 'taş', hide: 'deri' };
    if (this.state === 'attack') return 'Avlanıyor';
    if (this.state === 'gather') {
      if (this.phase === 'toDrop') return `Yükü boşaltmaya gidiyor (${Math.floor(this.carry)})`;
      if (this.phase === 'work') return 'Yükleniyor';
      return `${names[this.searchKind] ?? 'Kaynak'} kaynağına gidiyor`;
    }
    if (this.searchKind && this.state === 'idle') return `${names[this.searchKind]} arıyor…`;
    return this.state === 'move' ? 'Yolda' : 'Hazır — bir kaynak seçin';
  }

  get animState() { return this.moving ? this._walkAnim('pro_walk') : null; }
  get workAnim() { return null; } // balta/kazma sesi yok

  /** Komut: bu kaynağı aramaya başla (oyuncu başka emir verirse arama biter) */
  search(world, kind) {
    this.stop();
    this.searchKind = kind;
    this._seekT = 0;
    this._warned = false;
    this._seek(world);
  }

  update(dt, world) {
    super.update(dt, world);
    if (!this.searchKind || this.state !== 'idle') return;
    this._seekT -= dt;
    if (this._seekT <= 0) { this._seekT = 2; this._seek(world); }
  }

  _seek(world) {
    const kind = this.searchKind;
    const foeTc = this.owner === PLAYER ? world.enemyAI?.tc : world.townCenter;
    const far = (i, j) => !foeTc || Math.hypot(i - foeTc.centerI, j - foeTc.centerJ) > 26; // düşman köyüne girme
    let best = null, bd = Infinity;
    if (kind === 'hide') {
      for (const u of world.units) {
        if (!u.def.animal || u.dead || !far(u.x, u.y)) continue;
        const d = Math.hypot(u.x - this.x, u.y - this.y);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) { world.commandAttack([this], best); this.searchKind = kind; return true; }
    } else {
      const kinds = SEEK[kind] ?? [];
      const map = world.map;
      for (let j = 0; j < map.height; j++) {
        const row = map.objects[j];
        for (let i = 0; i < map.width; i++) {
          const o = row[i];
          if (!o || !o.isResource || !kinds.includes(o.kind) || (o.amount ?? 1) <= 0 || !far(i, j)) continue;
          const d = Math.hypot(i - this.x, j - this.y);
          if (d < bd) { bd = d; best = o; }
        }
      }
      if (best) { world.assignGather(this, best); this.searchKind = kind; return true; }
    }
    if (!this._warned && this.owner === PLAYER) { this._warned = true; world.notify('Araştırmacı aradığı kaynağı haritada bulamadı; aramaya devam ediyor.', 'info'); }
    return false;
  }
}
