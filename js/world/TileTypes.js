/**
 * ZEMİN TİPLERİ
 * Grid'de her karo için yalnızca küçük bir tamsayı (id) saklanır (Uint8 → karo başına 1 bayt).
 * O id'ye ait tüm görsel ve oynanış bilgisi paylaşılan tek bir TileType nesnesinde durur
 * (Flyweight deseni): 16.384 karo için 16.384 nesne yerine yalnızca 5 nesne.
 */
export const TileId = Object.freeze({
  WATER: 0,
  SAND: 1,
  GRASS: 2,
  DIRT: 3,
  MOUNTAIN: 4,
});

export class TileType {
  constructor({ id, key, name, colors, walkable = true, buildable = false, dynamic = false, moveCost = 1 }) {
    this.id = id;
    this.key = key;
    this.name = name;           // HUD'da gösterilen Türkçe ad
    this.colors = colors;       // { base, light, dark } → doku üretiminde kullanılır
    this.walkable = walkable;   // ileride pathfinding (A*) için
    this.buildable = buildable;
    this.dynamic = dynamic;     // true → statik katmana çizilmez, her karede animasyonlu çizilir
    this.moveCost = moveCost;
    Object.freeze(this);
  }
}

const TYPES = [];
const register = (def) => { TYPES[def.id] = new TileType(def); };

register({ id: TileId.WATER,    key: 'water',    name: 'Su',     colors: { base: '#2a6f9e', light: '#4d9cc4', dark: '#174a73' }, walkable: false, dynamic: true });
register({ id: TileId.SAND,     key: 'sand',     name: 'Kum',    colors: { base: '#d6c38a', light: '#eadba9', dark: '#b39e64' }, buildable: true, moveCost: 1.2 });
register({ id: TileId.GRASS,    key: 'grass',    name: 'Çimen',  colors: { base: '#5c9a3b', light: '#7dbb50', dark: '#3d7226' }, buildable: true });
register({ id: TileId.DIRT,     key: 'dirt',     name: 'Toprak', colors: { base: '#8b6b44', light: '#a8875c', dark: '#664c2e' }, buildable: true });
register({ id: TileId.MOUNTAIN, key: 'mountain', name: 'Dağ',    colors: { base: '#7c7367', light: '#a09689', dark: '#544c43' }, walkable: false, moveCost: Infinity });

export const TileRegistry = Object.freeze({
  get: (id) => TYPES[id],
  all: () => TYPES,
});
