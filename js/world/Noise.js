/**
 * Mulberry32: küçük, hızlı, tohumlanabilir PRNG.
 * Aynı SEED her zaman aynı haritayı üretir (multiplayer senkronu ve tekrar üretilebilirlik için şart).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D Value Noise + fBm: doğal görünümlü yükseklik ve orman haritaları için. */
export class ValueNoise2D {
  constructor(seed, size = 256) {
    const rand = mulberry32(seed);
    this.size = size;      // 2'nin kuvveti olmalı → bit maskesiyle ucuz sarma (wrap)
    this.mask = size - 1;
    this.lattice = new Float32Array(size * size).map(() => rand());
  }

  _at(ix, iy) {
    return this.lattice[(iy & this.mask) * this.size + (ix & this.mask)];
  }

  noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    // Smoothstep ağırlıkları: doğrusal interpolasyonun kafes noktalarındaki "köşeli" geçişlerini yumuşatır
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this._at(x0, y0), b = this._at(x0 + 1, y0);
    const c = this._at(x0, y0 + 1), d = this._at(x0 + 1, y0 + 1);
    const top = a + (b - a) * sx;
    const bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  }

  /** Fractal Brownian Motion: farklı frekanstaki gürültü katmanlarının toplamı → kıta + koy + kayalık detayı. */
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      // Her oktava farklı ofset: kafes noktaları üst üste binip yapay desen oluşturmasın
      sum += amp * this.noise(x * freq + o * 31.7, y * freq + o * 17.3);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
