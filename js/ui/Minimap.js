import { TileId } from '../world/TileTypes.js';
import { HW, HH, worldToTileFloat } from '../render/iso.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Minimap: haritanın elmas biçimli küçük görünümü.
 *
 * Püf noktası: 128×128 piksellik bir "grid bitmap'i" (her piksel = bir karo) üretip onu
 * izometrik affine matrisle çiziyoruz → tek drawImage ile elmas harita. Binalar, birimler ve
 * kamera çerçevesi de aynı matris altında doğrudan GRID koordinatında çizilir.
 */
export class Minimap {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.map = game.world.map;
    this.grid = document.createElement('canvas');
    this.grid.width = this.map.width;
    this.grid.height = this.map.height;
    const tex = game.sprites.textures;
    this.colors = {
      [TileId.WATER]: [30, 84, 128],
      [TileId.SAND]: hex(tex.sand.avg),
      [TileId.GRASS]: hex(tex.grass.avg),
      [TileId.DIRT]: hex(tex.dirt.avg),
      [TileId.MOUNTAIN]: [110, 106, 98],
    };
    this._builtVersion = -1;
    this._builtAt = -10;
    this._bindPointer();
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = Math.max(10, r.width);
    this.cssH = Math.max(10, r.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.dpr = dpr;
    // Elmas, kutuya sığacak şekilde: genişlik W = 2·N·s, yükseklik = N·s
    const N = this.map.width;
    this.s = Math.min(this.cssW / (2 * N), this.cssH / N) * 0.96;
    this.ox = this.cssW / 2;
    this.oy = (this.cssH - N * this.s) / 2;
  }

  _rebuild() {
    const map = this.map, W = map.width, H = map.height;
    const ctx = this.grid.getContext('2d');
    const img = ctx.createImageData(W, H);
    // Kışın kara (su hariç) beyaza yakın: örtü oranında karıştırılır
    const snow = this.game.world.weather.snowCover > 0.5 ? 0.72 : 0;
    this._snow = snow > 0;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        let c = this.colors[map.terrain[j][i]];
        const o = map.objects[j][i];
        if (o && !o.isBuilding) {
          if (o.kind === 'tree') c = [34, 74, 26];
          else if (o.kind === 'gold') c = [240, 200, 40];
          else if (o.kind === 'stone') c = [200, 200, 200];
          else if (o.kind === 'berry') c = [200, 60, 70];
          else if (o.kind === 'mountain') c = [96, 92, 86];
          else if (o.kind === 'fish') c = [120, 200, 235];
          else if (o.kind === 'cave') c = [70, 66, 62];
        }
        if (snow && map.terrain[j][i] !== TileId.WATER && o?.kind !== 'gold' && o?.kind !== 'berry') c = [c[0] + (232 - c[0]) * snow, c[1] + (238 - c[1]) * snow, c[2] + (248 - c[2]) * snow];
        const k = (j * W + i) * 4;
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this._builtVersion = map.version;
  }

  draw(time) {
    // Kutu boyutu değiştiyse (gizliyken kuruldu, pencere yeniden boyutlandı) tuvali yeniden ölç
    const r = this.canvas.getBoundingClientRect();
    if (r.width > 10 && (Math.abs(r.width - this.cssW) > 1 || Math.abs(r.height - this.cssH) > 1)) this.resize();
    // Statik kısım (arazi + kaynaklar) en fazla saniyede bir yeniden üretilir
    const snowNow = this.game.world.weather.snowCover > 0.5;
    if ((this.map.version !== this._builtVersion || snowNow !== this._snow) && time - this._builtAt > 1) {
      this._rebuild();
      this._builtAt = time;
    }
    const ctx = this.ctx, d = this.dpr, s = this.s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Grid → minimap:  x = (i − j)·s + ox ,  y = (i + j)·s/2 + oy
    ctx.setTransform(s * d, (s / 2) * d, -s * d, (s / 2) * d, this.ox * d, this.oy * d);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.grid, 0, 0);

    const world = this.game.world, fog = this.game.fog;
    // Savaş sisi: keşfedilmemiş siyah, görüş dışı yarı karanlık (aynı sis görüntüsü)
    if (fog?.enabled) { ctx.imageSmoothingEnabled = true; ctx.drawImage(fog.canvas, 0, 0); ctx.imageSmoothingEnabled = false; }
    for (const b of world.buildings) {
      if (b.owner !== 1 && fog && !fog.knowsObject(b)) continue;
      ctx.fillStyle = b.owner === 2 ? '#d8352a' : '#2f6fd6';
      ctx.fillRect(b.originI, b.originJ, b.size, b.size);
    }
    for (const u of world.units) {
      if (u.owner !== 1 && fog && !fog.isVisible(u.x, u.y)) continue;
      ctx.fillStyle = u.owner === 3 ? '#f4f8ff' : u.owner === 2 ? '#ff6a5c' : '#9fd0ff'; // 3: yaratık
      ctx.fillRect(u.x - 0.2, u.y - 0.2, 1.4, 1.4); // karo merkezi = piksel merkezi (+0.5)
    }
    // Saldırı uyarısı: 3 saniye boyunca büyüyüp sönen kırmızı halka
    for (const a of world.alerts) {
      const age = world.time - a.t;
      if (age > 3) continue;
      const r = 3 + (age % 1) * 8;
      ctx.beginPath();
      ctx.arc(a.i + 0.5, a.j + 0.5, r, 0, Math.PI * 2);
      ctx.lineWidth = 1.6 / s;
      ctx.strokeStyle = `rgba(255,60,40,${1 - (age % 1)})`;
      ctx.stroke();
    }

    // Kamera çerçevesi: ekranın 4 köşesi → dünya → grid
    const cam = this.game.camera;
    const corners = [[0, 0], [cam.viewW, 0], [cam.viewW, cam.viewH], [0, cam.viewH]].map(([x, y]) => {
      const w = cam.screenToWorld(x, y);
      return worldToTileFloat(w.x, w.y);
    });
    ctx.beginPath();
    corners.forEach((c, k) => (k ? ctx.lineTo(c.i + 0.5, c.j + 0.5) : ctx.moveTo(c.i + 0.5, c.j + 0.5)));
    ctx.closePath();
    ctx.lineWidth = 1.2 / s;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  _bindPointer() {
    const jump = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      // Ters dönüşüm:  i − j = (mx − ox)/s ,  i + j = 2(my − oy)/s
      const a = (mx - this.ox) / this.s, b = (2 * (my - this.oy)) / this.s;
      const gi = (a + b) / 2 - 0.5, gj = (b - a) / 2 - 0.5; // piksel → karo merkezi
      this.game.camera.centerOn((gi - gj) * HW, (gi + gj) * HH);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        // Sağ tık minimap'te: seçili köylüleri oraya gönder
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        const a = (e.clientX - r.left - this.ox) / this.s, b = (2 * (e.clientY - r.top - this.oy)) / this.s;
        this.game.commandMoveToTile(Math.round((a + b) / 2 - 0.5), Math.round((b - a) / 2 - 0.5));
        return;
      }
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* yakalama başarısız olsa da kamera atlasın */ }
      jump(e);
    });
    this.canvas.addEventListener('pointermove', (e) => { if (e.buttons & 1) jump(e); });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
