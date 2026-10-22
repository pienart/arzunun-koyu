/**
 * Merkezi yapılandırma: motorla ilgili tüm sabitler burada.
 * Oyun dengesi (maliyetler, süreler, toplama hızları) → js/data/gameData.js
 */
export const CONFIG = Object.freeze({
  // --- Harita ---
  MAP_WIDTH: 160,
  MAP_HEIGHT: 160,
  SEED: 1337,
  TILE_WIDTH: 64,   // 2:1 izometrik karo
  TILE_HEIGHT: 32,

  // --- Kamera ---
  ZOOM_MIN: 0.5,
  ZOOM_MAX: 2.5,
  ZOOM_SENSITIVITY: 0.0015,
  ZOOM_SMOOTHING: 14,
  PAN_FRICTION: 5,
  KEY_PAN_SPEED: 900,
  DRAG_THRESHOLD: 5,
  WORLD_PADDING: 96,

  // --- Render ---
  MAX_DPR: 2,
  GROUND_PAD: { x: 24, top: 12, bottom: 12 },
  OBJECT_PAD: { x: 200, top: 40, bottom: 360 },
  BACKGROUND: '#0b1a26',
  TEXTURE_TILES: 6,         // bir zemin dokusu kaç karoyu kaplar (tekrar sıklığı)
  VILLAGER_HEIGHT: 36,      // köylünün dünya birimindeki boyu
  TREE_HEIGHT: 92,
  BUILDING_FIT: 1.0,        // bina sprite tabanının ayak izine oranı

  // --- Simülasyon ---
  SIM_STEP: 1 / 20,         // sabit adım: 20 tick/sn (lockstep RTS standardı)
  UI_INTERVAL: 0.15,        // DOM arayüzü güncelleme aralığı (sn)
});
