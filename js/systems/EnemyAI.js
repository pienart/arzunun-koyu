import { ENEMY, PLAYER, ENEMY_AI, BUILDINGS, UNITS } from '../data/gameData.js';
import { TileId } from '../world/TileTypes.js';

/**
 * EnemyAI: düşman (kırmızı) oyuncu.
 *  - Haritanın uzak ama KARADAN ULAŞILABİLİR bir bölgesine üs kurar (taşkın doldurma ile erişilebilirlik garanti).
 *  - Üssü nöbetçiler ve kuleler korur.
 *  - Barış süresinden sonra giderek büyüyen saldırı dalgaları gönderir ("attack-move": yol boyunca her şeyle savaşır).
 *  - Zamanla çağ atlar: birimleri güçlenir, binalarının görünümü değişir.
 *  - EKONOMİ: köylüleri üssün çevresinde odun/yiyecek/altın/taş toplar, düşman zamanla yeni köylü yetiştirir.
 *    Biriken kaynakla her dalgaya ek asker satın alınır → düşman köylülerine baskın yapmak dalgaları küçültür.
 *  - Zorluk (World.diff): ilk saldırı zamanı, dalga aralığı, dalga büyüklüğü, köylü sayısı ve toplama hızı.
 */
const GATHER_ORDER = ['tree', 'berry', 'tree', 'gold', 'tree', 'stone', 'berry', 'gold'];
export class EnemyAI {
  constructor(world) {
    this.world = world;
    this.player = world.players[ENEMY];
    this.waveTimer = world.diff.firstWave;
    this.wave = 0;
    this.econT = 6;           // ekonomi kararları (köylü üret, boşta olana iş ver) aralığı
    this.trainT = 25;         // sonraki köylü üretimi
    this._gatherIdx = 0;
    this.enabled = false;
    this.tc = null;
  }

  setup() {
    const w = this.world;
    const spot = this._findBaseSpot();
    if (!spot) return; // ada çok küçükse düşmansız oyna
    this.enabled = true;
    this._clearArea(spot.i + 2, spot.j + 2, 7);
    this.tc = w.addBuilding('townCenter', spot.i, spot.j, ENEMY, true);
    this.barracks = this._placeNear(this.tc, 'barracks', 3);
    this.range = this._placeNear(this.tc, 'archeryRange', 3);
    // Kuleler: oyuncuya bakan tarafta
    const dir = this._dirToPlayer();
    this.towers = [0, 1].map((k) => this._placeAt('watchTower',
      Math.round(this.tc.centerI + dir.i * 6 + dir.j * (k ? 3 : -3)), Math.round(this.tc.centerJ + dir.j * 6 - dir.i * (k ? 3 : -3))));
    // Nöbetçiler: kasaba merkezinin çevresinde halka
    const { militia, archer } = ENEMY_AI.defenders;
    const types = [...Array(militia).fill('militia'), ...Array(archer).fill('archer')];
    types.forEach((type, k) => {
      const a = (k / types.length) * Math.PI * 2;
      const pi = Math.round(this.tc.centerI + Math.cos(a) * 4.5), pj = Math.round(this.tc.centerJ + Math.sin(a) * 4.5);
      const u = w.spawnUnitNear(this.barracks ?? this.tc, type);
      const post = w.map.isWalkable(pi, pj) ? { i: pi, j: pj } : w.map.findWalkableNear(pi, pj, 4);
      if (u && post) u.guardAt(w, post.i, post.j);
    });
    // Düşman hazinesi küçük başlar (oyuncunun 5 kat başlangıcı ona uygulanmaz); gerisini köylüleri toplar
    this.player.resources = { food: 200, wood: 200, gold: 100, stone: 100 };
    // Ekonomi: başlangıç köylüleri
    for (let k = 0; k < w.diff.enemyVillagers; k++) this._spawnWorker();
  }

  get villagers() { return this.world.units.filter((u) => u.owner === ENEMY && u.type === 'villager'); }

  _spawnWorker() {
    const u = this.world.spawnUnitNear(this.tc, 'villager');
    if (u) this._giveJob(u);
    return u;
  }

  /** Üssün çevresinde (14 karo) sıradaki kaynak türünü bul; yoksa herhangi birini */
  _giveJob(u) {
    const w = this.world, ci = Math.round(this.tc.centerI), cj = Math.round(this.tc.centerJ);
    for (let k = 0; k < GATHER_ORDER.length; k++) {
      const kind = GATHER_ORDER[(this._gatherIdx + k) % GATHER_ORDER.length];
      const node = w.findNearestResource(kind, ci, cj, 14, u);
      if (node) { this._gatherIdx = (this._gatherIdx + k + 1) % GATHER_ORDER.length; w.assignGather(u, node); return true; }
    }
    return false;
  }

  _economy(dt) {
    this.econT -= dt;
    this.trainT -= dt;
    if (this.econT > 0) return;
    this.econT = 3;
    const vs = this.villagers;
    for (const u of vs) if (u.state === 'idle') this._giveJob(u);
    // Köylü üret: hedef sayı çağla artar
    const want = this.world.diff.enemyVillagers + 2 * this.player.age;
    if (this.trainT <= 0 && vs.length < Math.min(16, want) && this.player.spend(UNITS.villager.cost)) {
      this.trainT = 28;
      this._spawnWorker();
    }
  }

  get countdown() { return Math.max(0, this.waveTimer); }

  serialize() {
    return { waveTimer: this.waveTimer, wave: this.wave, enabled: this.enabled, econT: this.econT, trainT: this.trainT,
      tc: this.tc?.id, barracks: this.barracks?.id, range: this.range?.id };
  }

  restore(s, byId) {
    Object.assign(this, { waveTimer: s.waveTimer, wave: s.wave, enabled: s.enabled, econT: s.econT ?? 3, trainT: s.trainT ?? 20 });
    this.tc = byId.get(s.tc) ?? null;
    this.barracks = byId.get(s.barracks) ?? null;
    this.range = byId.get(s.range) ?? null;
  }

  update(dt) {
    const w = this.world;
    if (!this.enabled || !w.isAlive(this.tc)) return;
    // Çağ atlama (zamana bağlı): +1 saldırı, +5 can (birim başına)
    const nextAt = ENEMY_AI.ageAt[this.player.age + 1];
    if (nextAt !== undefined && w.time >= nextAt) {
      this.player.advanceAge();
      for (const type of ['militia', 'archer']) { this.player.addBonus(type, 'attack', 1); this.player.addBonus(type, 'hp', 5); }
      this.player.addBonus('tower', 'attack', 1);
      w.map.version++; // düşman binaları yeni çağ görünümüne geçer
      w.notify(`Düşman yeni bir çağa geçti: ${this.player.ageDef.name}.`, 'info');
    }
    this._economy(dt);
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = w.diff.interval;
      this.launchWave();
    }
  }

  launchWave() {
    const w = this.world;
    this.wave++;
    const n = this.wave;
    const mul = w.diff.waveMul;
    let militia = Math.max(1, Math.round(Math.min(10, 2 + n) * mul));
    let archers = n >= 2 ? Math.round(Math.min(6, Math.floor(n / 2) + 1) * mul) : 0;
    // Biriken kaynakla ek askerler (köylü üretimi için 100 yiyecek yedekte kalır)
    let bought = 0;
    while (bought < 8) {
      const type = bought % 3 === 2 ? 'archer' : 'militia', cost = UNITS[type].cost;
      if ((this.player.resources.food - (cost.food ?? 0)) < 100 || !this.player.spend(cost)) break;
      if (type === 'archer') archers++; else militia++;
      bought++;
    }
    const target = w.townCenter && w.isAlive(w.townCenter) ? w.townCenter : w.buildings.find((b) => b.owner === PLAYER);
    if (!target) return;
    const ti = Math.round(target.centerI), tj = Math.round(target.centerJ);
    const spawnFrom = (type) => (type === 'archer' && w.isAlive(this.range) ? this.range : w.isAlive(this.barracks) ? this.barracks : this.tc);
    const list = [...Array(militia).fill('militia'), ...Array(archers).fill('archer')].slice(0, ENEMY_AI.maxWave);
    for (const type of list) {
      const u = w.spawnUnitNear(spawnFrom(type), type);
      if (u) u.attackMoveTo(w, ti, tj);
    }
    w.notify(`Düşman saldırısı başladı! (Dalga ${n}: ${militia} milis${archers ? `, ${archers} okçu` : ''}${bought ? ` — ${bought} tanesi düşman hazinesinden` : ''})`, 'warn');
    w.sound('horn');
  }

  // ───────────── Üs yerleşimi ─────────────
  /** Oyuncu üssünden karadan yürünebilen bölgeyi taşkın doldurma ile bulur, en uzak uygun açık alanı seçer. */
  _findBaseSpot() {
    // Önce katı test (ağaçlar da engel → birimler gerçekten yürüyebilsin); bulunamazsa ağaçları yok say
    return this._searchBase(true) ?? this._searchBase(false);
  }

  _searchBase(strict) {
    const w = this.world, map = w.map, W = map.width, H = map.height;
    const start = map.findWalkableNear(w.townCenter.i + 1, w.townCenter.j + 1, 6);
    if (!start) return null;
    const dist = new Int32Array(W * H).fill(-1);
    const queue = [start.j * W + start.i];
    dist[queue[0]] = 0;
    for (let q = 0; q < queue.length; q++) {
      const n = queue[q], ci = n % W, cj = (n / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (!map.inBounds(ni, nj)) continue;
        const k = nj * W + ni;
        if (dist[k] >= 0) continue;
        if (strict) {
          if (!map.isWalkable(ni, nj)) continue;
        } else {
          const t = map.terrain[nj][ni];
          if (t === TileId.WATER || t === TileId.MOUNTAIN) continue;
          const o = map.occupancy[nj][ni];
          if (o && o.isBuilding) continue;
        }
        dist[k] = dist[n] + 1;
        queue.push(k);
      }
    }
    // En uzaktan yakına doğru: 4×4 + 3 karo boşluklu, tamamı çimen/toprak bir alan ara
    const order = queue.slice().sort((a, b) => dist[b] - dist[a]);
    const okTile = (i, j) => {
      if (!map.inBounds(i, j)) return false;
      const t = map.terrain[j][i];
      if (t !== TileId.GRASS && t !== TileId.DIRT) return false;
      const o = map.occupancy[j][i];
      return !o || o.kind === 'tree' || o.kind === 'stump';
    };
    // Yürüme mesafesi (karo): önce en uzak seçenek, bulunamazsa adım adım yakına
    for (const minD of strict ? [ENEMY_AI.minDistance + 18, ENEMY_AI.minDistance, 55, 40] : [ENEMY_AI.minDistance, 35, 20]) {
      for (const n of order) {
        if (dist[n] < minD) break;
        const ci = n % W, cj = (n / W) | 0;
        const oi = ci - 2, oj = cj - 2;
        let ok = true;
        for (let j = oj - 3; ok && j < oj + 7; j++) for (let i = oi - 3; i < oi + 7; i++) if (!okTile(i, j)) { ok = false; break; }
        if (ok) return { i: oi, j: oj };
      }
    }
    return null;
  }

  _clearArea(ci, cj, r) {
    const map = this.world.map;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (!map.inBounds(i, j) || Math.hypot(i - ci, j - cj) > r) continue;
        const o = map.occupancy[j][i];
        if (o && !o.isBuilding && o.kind !== 'mountain') map.removeObject(o);
        if (map.terrain[j][i] === TileId.GRASS && Math.hypot(i - ci, j - cj) < r - 1) map.terrain[j][i] = TileId.DIRT;
      }
    }
  }

  _placeAt(type, ci, cj) {
    const w = this.world, size = BUILDINGS[type].size;
    for (let r = 0; r < 6; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const oi = ci + di, oj = cj + dj;
          if (w.map.canPlace(oi, oj, size)) return w.addBuilding(type, oi, oj, ENEMY, true);
        }
      }
    }
    return null;
  }

  _placeNear(tc, type, gap) {
    const size = BUILDINGS[type].size;
    for (let r = 4 + gap; r < 14; r++) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r;
        const oi = Math.round(tc.centerI + Math.cos(a) * r - size / 2), oj = Math.round(tc.centerJ + Math.sin(a) * r - size / 2);
        if (this.world.map.canPlace(oi, oj, size)) return this.world.addBuilding(type, oi, oj, ENEMY, true);
      }
    }
    return null;
  }

  _dirToPlayer() {
    const tc = this.tc, p = this.world.townCenter;
    const di = p.centerI - tc.centerI, dj = p.centerJ - tc.centerJ, d = Math.hypot(di, dj) || 1;
    return { i: di / d, j: dj / d };
  }
}
