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
 *  - GELİŞİM (oyun başından itibaren): köylüleriyle sürekli bina kurar (ev, kışla, okçuluk alanı, ahır, kule, hastane,
 *    kuşatma atölyesi, kamplar), üretim binalarında sürekli asker yetiştirir (kalıcı ordu) ve bu ordu dalgalara katılır.
 *    Hedef: oyuncuyla dengeli bir savaş — düşman asla geride kalmaz.
 */
const GATHER_ORDER = ['farm', 'tree', 'berry', 'farm', 'gold', 'tree', 'farm', 'stone', 'berry', 'gold'];
export class EnemyAI {
  constructor(world) {
    this.world = world;
    this.player = world.players[ENEMY];
    // İlk saldırı: en erken 20 dk (zorluk) + 0–5 dk rastgele; sonrakiler rastgele aralıklarla
    this.waveTimer = Math.max(1200, world.diff.firstWave) + Math.random() * 300;
    this.wave = 0;
    this.econT = 6;           // ekonomi kararları (köylü üret, boşta olana iş ver) aralığı
    this.trainT = 25;         // sonraki köylü üretimi
    this._gatherIdx = 0;
    this.enabled = false;
    this.tc = null;
    this.buildT = 4;          // sonraki inşaat kararı
    this.armyT = 6;           // sonraki asker üretim kararı
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
    // Düşman hazinesi: zorluğa göre (Normal 3500) — hemen bina kurup asker üretmeye başlar
    const st = w.diff.enemyStart ?? 3000;
    this.player.resources = { food: st, wood: st, gold: st * 0.8, stone: st * 0.6, hide: 0 };
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
    // Takas: yiyecek azaldıysa biriken odun/taşı yiyeceğe çevir (pazar oranı ~%70)
    const r = this.player.resources;
    if (r.food < 400) for (const k of ['wood', 'stone']) if (r[k] > 1200) { r[k] -= 300; r.food += 210; }
    // Köylü üret: hedef sayı çağla artar
    const want = this.world.diff.enemyVillagers + 6 + 4 * this.player.age;
    if (this.trainT <= 0 && vs.length < Math.min(26, want) && this.player.spend(UNITS.villager.cost)) {
      this.trainT = 16;
      this._spawnWorker();
    }
  }

  // ───────────── Gelişim: inşaat ve kalıcı ordu ─────────────
  _count(type, completeOnly = false) {
    return this.world.buildings.filter((b) => b.owner === ENEMY && b.type === type && (!completeOnly || b.complete)).length;
  }

  /** Bu çağda istenen bina sayıları (sırası öncelik sırasıdır) */
  _plan() {
    const a = this.player.age, p = this.player;
    const houseNeed = p.popCap < 200 && p.popCap - p.population < 8 ? this._count('house') + 1 : 0;
    return [
      ['house', houseNeed],
      ['barracks', 1 + Math.min(3, a + (this._rich() ? 1 : 0))],
      ['lumberCamp', 1], ['mill', 1], ['miningCamp', 1],
      ['farm', 4 + a * 3],
      ['archeryRange', 1 + (a >= 2 ? 1 : 0)],
      ['stable', a >= 1 ? 1 + (a >= 3 ? 1 : 0) : 0],
      ['watchTower', a >= 1 ? 2 + a * 2 : 0],
      ['hospital', a >= 1 ? 1 : 0],
      ['siegeWorkshop', a >= 2 ? 1 : 0],
      ['house', p.popCap < 200 ? Math.min(30, 8 + a * 6) : 0],
    ];
  }

  /** Sıradaki eksik binayı Kasaba Merkezi çevresine temel olarak kur ve 2 köylüyü inşaata gönder (aynı anda en fazla 3 inşaat) */
  _build(dt) {
    this.buildT -= dt;
    if (this.buildT > 0) return;
    this.buildT = 6;
    const w = this.world;
    const sites = w.buildings.filter((b) => b.owner === ENEMY && !b.complete);
    for (const s of sites) if (!w.units.some((u) => u.task?.target === s)) this._sendBuilders(s, 2);
    if (sites.length >= 3) return;
    for (const [type, want] of this._plan()) {
      if (this._count(type) >= want) continue;
      if (w.checkBuildable(type, ENEMY)) continue; // çağ / ön koşul / kaynak yok → sıradakine bak
      const spot = this._findSite(type);
      if (!spot) continue;
      this.player.spend(w.costOf(type, ENEMY));
      const b = w.addBuilding(type, spot.i, spot.j, ENEMY, false);
      this._sendBuilders(b, type === 'house' ? 1 : 2);
      return;
    }
  }

  _findSite(type) {
    const w = this.world, tc = this.tc, size = BUILDINGS[type].size;
    const dir = this._dirToPlayer();
    for (let r = 5; r < 20; r++) {
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2 + r * 1.3;
        let oi = Math.round(tc.centerI + Math.cos(a) * r - size / 2), oj = Math.round(tc.centerJ + Math.sin(a) * r - size / 2);
        if (type === 'watchTower') { // kuleler oyuncuya bakan tarafa
          oi = Math.round(tc.centerI + dir.i * (6 + r * 0.6) + Math.cos(a) * 4); oj = Math.round(tc.centerJ + dir.j * (6 + r * 0.6) + Math.sin(a) * 4);
        }
        if (!w.map.canPlace(oi - 1, oj - 1, size + 2)) continue;
        return { i: oi, j: oj };
      }
    }
    return null;
  }

  _sendBuilders(b, n) {
    const vs = this.villagers.filter((u) => u.state !== 'build')
      .sort((a, c) => Math.hypot(a.x - b.centerI, a.y - b.centerJ) - Math.hypot(c.x - b.centerI, c.y - b.centerJ));
    this.world.commandBuild(vs.slice(0, n), b);
  }

  /** Kalıcı ordu: üretim binalarında sürekli asker; hedef boyut çağla ve dalga sayısıyla büyür */
  _army(dt) {
    this.armyT -= dt;
    if (this.armyT > 0) return;
    this.armyT = 5;
    const w = this.world, a = this.player.age;
    // Hedef ordu: çağ, dalga ve zamanla büyür; hazine doluysa daha da büyük (kaynak biriktirmez)
    const minutes = w.time / 60;
    const target = Math.min(110, 14 + 14 * a + 4 * this.wave + Math.floor(minutes) + (this._rich() ? 15 : 0));
    const have = w.units.filter((u) => u.owner === ENEMY && u.isMilitary && !u.def.monster).length;
    let queued = 0;
    for (const b of w.buildings) if (b.owner === ENEMY) queued += b.queue.filter((q) => q.kind === 'unit' && q.id !== 'villager').length;
    if (have + queued >= target) return;
    const muster = this._muster();
    const pick = { barracks: ['militia'], archeryRange: ['archer'], stable: ['cavalry'], siegeWorkshop: a >= 2 ? ['ram', 'catapult'] : ['ram'] };
    for (const b of w.buildings) {
      if (b.owner !== ENEMY || !b.complete || !pick[b.type] || b.queue.length >= 2) continue;
      const types = pick[b.type];
      const type = types[(this._rot = (this._rot ?? 0) + 1) % types.length];
      if (type === 'ram' && this._siegeCount() >= 2 + a) continue;
      if (w.checkQueue(b, 'unit', type)) continue;
      w.enqueue(b, 'unit', type);
      b.rally = muster;
    }
  }

  /** Hazine dolu mu? (her kaynak 1500 üzeri) → daha fazla bina ve asker */
  _rich() { const r = this.player.resources; return r.food > 1500 && r.wood > 1500 && r.gold > 1200; }

  /**
   * Askeri gelişim (oyuncunun araştırmalarına karşılık): 2 dakikada bir, kaynak varsa ordusunu güçlendirir
   * (+1 saldırı, +1 zırh, +8 can; okçuya +0,5 menzil). Böylece düşman yalnızca sayıca değil nitelikçe de gelişir.
   */
  _research(dt) {
    this.resT = (this.resT ?? 90) - dt;
    if (this.resT > 0) return;
    this.resT = 120;
    const p = this.player;
    if (!p.spend({ food: 300, gold: 200 })) return;
    for (const t of ['militia', 'archer', 'cavalry']) { p.addBonus(t, 'attack', 1); p.addBonus(t, 'melee', 1); p.addBonus(t, 'pierce', 1); p.addBonus(t, 'hp', 8); }
    p.addBonus('archer', 'range', 0.5);
    p.addBonus('tower', 'attack', 1);
    this.researched = (this.researched ?? 0) + 1;
  }

  _siegeCount() { return this.world.units.filter((u) => u.owner === ENEMY && (u.def.siege || u.type === 'catapult')).length; }

  /** Toplanma noktası: Kasaba Merkezi'nin oyuncuya bakan önü */
  _muster() {
    const d = this._dirToPlayer(), tc = this.tc;
    const s = this.world.map.findWalkableNear(Math.round(tc.centerI + d.i * 9), Math.round(tc.centerJ + d.j * 9), 6);
    return s ? { i: s.i, j: s.j } : null;
  }

  get countdown() { return Math.max(0, this.waveTimer); }

  serialize() {
    return { waveTimer: this.waveTimer, wave: this.wave, dirBase: this.dirBase, enabled: this.enabled, econT: this.econT, trainT: this.trainT,
      tc: this.tc?.id, barracks: this.barracks?.id, range: this.range?.id };
  }

  restore(s, byId) {
    if (s.dirBase !== undefined) this.dirBase = s.dirBase;
    Object.assign(this, { waveTimer: s.waveTimer, wave: s.wave, enabled: s.enabled, econT: s.econT ?? 3, trainT: s.trainT ?? 20 });
    this.tc = byId.get(s.tc) ?? null;
    this.barracks = byId.get(s.barracks) ?? null;
    this.range = byId.get(s.range) ?? null;
  }

  update(dt) {
    const w = this.world;
    if (!this.enabled || !w.isAlive(this.tc)) return;
    // Çağ atlama (zamana bağlı): +1 saldırı, +5 can (birim başına)
    // Düşman sizden ~%5 hızlı gelişir: zamanı gelince ya da siz o çağa geçince (hangisi önce) çağ atlar
    const nextAt = ENEMY_AI.ageAt[this.player.age + 1];
    if (nextAt !== undefined && (w.time >= nextAt * 0.95 || w.player.age > this.player.age)) {
      this.player.advanceAge();
      for (const type of ['militia', 'archer']) { this.player.addBonus(type, 'attack', 1); this.player.addBonus(type, 'hp', 5); }
      this.player.addBonus('tower', 'attack', 1);
      w.map.version++; // düşman binaları yeni çağ görünümüne geçer
      w.notify(`Düşman yeni bir çağa geçti: ${this.player.ageDef.name}.`, 'info');
    }
    this._economy(dt);
    this._build(dt);
    this._army(dt);
    this._research(dt);
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = w.diff.interval * (0.6 + Math.random() * 0.9);
      this.launchWave();
    }
  }

  launchWave() {
    const w = this.world;
    this.wave++;
    const n = this.wave;
    const mul = w.diff.waveMul;
    // Her dalga kademeli olarak büyür ve sertleşir: 1. dalga küçük bir akın, sonra her seferinde daha kalabalık,
    // 3. dalgadan itibaren koçbaşı, 4.'den atlı, 6.'dan mancınık; her dalgada askerler %6 daha güçlü (saldırı ve can).
    const myArmy = w.units.filter((u) => u.owner === PLAYER && u.isMilitary).length;
    let militia = Math.max(2, Math.round(Math.min(30, 2 + n * 1.8) * mul));
    let archers = n >= 2 ? Math.round(Math.min(16, Math.floor(n * 0.9) + 1) * mul) : 0;
    const rams = n >= 3 ? Math.min(4, Math.floor((n - 1) / 2)) : 0;
    const cavalry = n >= 4 ? Math.round(Math.min(10, n - 2) * mul) : 0;
    const catapults = n >= 6 ? Math.min(3, Math.floor((n - 4) / 2)) : 0;
    const power = 1 + 0.06 * (n - 1);
    const want = Math.round(myArmy * 1.05 * 0.6);
    if (militia + archers < want) militia += Math.min(10, want - militia - archers);
    // Biriken kaynakla ek askerler (köylü üretimi için 100 yiyecek yedekte kalır)
    let bought = 0;
    while (bought < Math.min(8, n)) { // hazineden alım da kademeli: 1. dalgada en fazla 1
      const type = bought % 3 === 2 ? 'archer' : 'militia', cost = UNITS[type].cost;
      if ((this.player.resources.food - (cost.food ?? 0)) < 100 || !this.player.spend(cost)) break;
      if (type === 'archer') archers++; else militia++;
      bought++;
    }
    const target = w.townCenter && w.isAlive(w.townCenter) ? w.townCenter : w.buildings.find((b) => b.owner === PLAYER);
    if (!target) return;
    const ti = Math.round(target.centerI), tj = Math.round(target.centerJ);
    // Saldırı yönü her dalgada kademeli döner: önce köyün çevresinde (yaklaşık 18 karo) bir ara noktaya, sonra merkeze
    this.dirBase ??= Math.atan2(this.tc.centerJ - tj, this.tc.centerI - ti);
    const ang = this.dirBase + (n - 1) * (Math.PI / 3.2);
    const st = w.map.findWalkableNear(Math.round(ti + Math.cos(ang) * 18), Math.round(tj + Math.sin(ang) * 18), 6) ?? { i: ti, j: tj };
    const spawnFrom = (type) => (type === 'archer' && w.isAlive(this.range) ? this.range : w.isAlive(this.barracks) ? this.barracks : this.tc);
    const list = [...Array(rams).fill('ram'), ...Array(catapults).fill('catapult'), ...Array(cavalry).fill('cavalry'),
      ...Array(militia).fill('militia'), ...Array(archers).fill('archer')].slice(0, 50);
    let sent = 0;
    for (const type of list) {
      const u = w.spawnUnitNear(spawnFrom(type), type);
      if (!u) continue;
      u.maxHp = Math.round(u.maxHp * power); u.hp = u.maxHp;
      u.waveDmg = power; // saldırı çarpanı (World.stat)
      u.nextGoal = { i: ti, j: tj };
      u.attackMoveTo(w, st.i, st.j, true);
      sent++;
    }
    // Kalıcı ordudan da birlikler katılır (nöbetçiler hariç): her dalgada daha fazlası
    const reserve = w.units.filter((u) => u.owner === ENEMY && u.isMilitary && !u.def.monster && !u.post && (u.state === 'idle' || u.state === 'move'));
    const join = reserve.slice(0, Math.min(reserve.length, 3 + n * 3));
    for (const u of join) { u.nextGoal = { i: ti, j: tj }; u.attackMoveTo(w, st.i, st.j, true); sent++; }
    this.lastWave = { n, sent, at: w.time };
    const parts = [`${militia} milis`, archers && `${archers} okçu`, cavalry && `${cavalry} atlı`, rams && `${rams} koçbaşı`, catapults && `${catapults} mancınık`].filter(Boolean).join(', ');
    w.notify(`Düşman saldırısı! Dalga ${n} (${sent} asker: ${parts}${join.length ? `, +${join.length} kalıcı ordudan` : ''}) — güç +%${Math.round((power - 1) * 100)}${bought ? ` · ${bought} tanesi düşman hazinesinden` : ''}`, 'warn');
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
