import { Animal } from '../entities/Animal.js';
import { CONFIG } from '../config.js';

const KINDS = [
  { type: 'gazelle', n: [3, 5] },
  { type: 'deer', n: [2, 4] },
  { type: 'rabbit', n: [2, 4] },
  { type: 'horse', n: [3, 4] },
];

/**
 * YABANİ HAYVANLAR: haritaya dağılmış sürüler. Ara sıra (2–4 dk'da bir) bir sürü köyün kenarına (Kasaba Merkezi'ne
 * 9–15 karo) otlamaya gelir — avlanma fırsatı. Sürü azalınca yerine haritanın uzak bir yerinde yenisi doğar.
 * Kışın hayvanlar seyrekleşir (yeni sürü doğmaz).
 */
export class Animals {
  constructor(world) {
    this.world = world;
    this.herds = [];
    this.visitT = 120 + Math.random() * 60;
    this.spawnT = 60;
  }

  /** Kayıttan yüklenen hayvanları sürülere bağla (her biri kendi merkezinde) */
  adopt(list) {
    for (const a of list) this.herds.push({ type: a.type, home: a.home, members: [a] });
    const area = (this.world.map.width * this.world.map.height) / (128 * 128);
    this.target = Math.max(list.length, Math.round(5 * area * 3.3)); // kayıtta tutulmaz: haritanın olağan sayısı
  }

  setup() {
    const area = (this.world.map.width * this.world.map.height) / (128 * 128);
    const n = Math.round(5 * area);
    for (let k = 0; k < n; k++) this._spawnHerd(KINDS[k % KINDS.length]);
    this.target = this._alive();
  }

  _alive() { return this.herds.reduce((s, h) => s + h.members.filter((a) => !a.dead).length, 0); }

  _randomLand(minFromTC = 30) {
    const w = this.world, map = w.map, tc = w.townCenter;
    for (let a = 0; a < 200; a++) {
      const i = 6 + ((Math.random() * (map.width - 12)) | 0), j = 6 + ((Math.random() * (map.height - 12)) | 0);
      if (!map.isWalkable(i, j)) continue;
      if (tc && Math.hypot(i - tc.centerI, j - tc.centerJ) < minFromTC) continue;
      if (w.enemyAI.tc && Math.hypot(i - w.enemyAI.tc.centerI, j - w.enemyAI.tc.centerJ) < 18) continue;
      return { i, j };
    }
    return null;
  }

  _spawnHerd(kind, at = null) {
    const home = at ?? this._randomLand();
    if (!home) return;
    const herd = { type: kind.type, home, members: [] };
    const count = kind.n[0] + ((Math.random() * (kind.n[1] - kind.n[0] + 1)) | 0);
    for (let k = 0; k < count; k++) {
      const s = this.world.map.findWalkableNear(home.i + ((Math.random() * 5) | 0) - 2, home.j + ((Math.random() * 5) | 0) - 2, 4);
      if (!s) continue;
      const a = new Animal(kind.type, s.i, s.j, herd.home);
      herd.members.push(a);
      this.world.units.push(a);
    }
    this.herds.push(herd);
  }

  update(dt) {
    const w = this.world;
    for (const h of this.herds) h.members = h.members.filter((a) => !a.dead);
    this.herds = this.herds.filter((h) => h.members.length);
    // Ara sıra bir sürü köyün kenarına gelir
    this.visitT -= dt;
    if (this.visitT <= 0 && w.townCenter && this.herds.length) {
      this.visitT = 120 + Math.random() * 120;
      const h = this.herds[(Math.random() * this.herds.length) | 0];
      // Çitin hemen dışına (içine girip mahsur kalmasın)
      const tc = w.townCenter, a = Math.random() * Math.PI * 2, r = CONFIG.START_WALL_R + 4 + Math.random() * 5;
      const m = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const spot = w.map.findWalkableNear(Math.round(tc.centerI + (Math.cos(a) * r) / m), Math.round(tc.centerJ + (Math.sin(a) * r) / m), 4);
      if (spot) {
        h.home.i = spot.i; h.home.j = spot.j;
        for (const m of h.members) m.grazeT = Math.random() * 2;
        w.notify(`Bir ${({ gazelle: 'ceylan', deer: 'geyik', rabbit: 'tavşan', horse: 'yaban atı' })[h.type]} sürüsü köyün yakınına geldi: köylülerle avlayabilirsiniz.`, 'info');
        w.alert(spot.i, spot.j);
      }
    }
    // Avlanan hayvanların yerine, eksilen sayı kadarı haritanın rastgele yerlerinde yeniden doğar (sürüler halinde)
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 30;
      let missing = (this.target ?? 0) - this._alive();
      for (let k = 0; missing > 0 && k < 6; k++) {
        const kind = KINDS[(Math.random() * KINDS.length) | 0];
        const before = this._alive();
        this._spawnHerd({ type: kind.type, n: [Math.min(missing, kind.n[0]), Math.min(missing, kind.n[1])] });
        missing -= this._alive() - before;
      }
    }
  }
}
