import { CONFIG } from '../config.js';

/**
 * InputHandler: ham tarayıcı olaylarını RTS niyetlerine çevirir.
 *   Sol tık            → seçim (onLeftClick)       Sol sürükle → seçim kutusu (onBoxSelect)
 *   Sağ tık            → komut (onRightClick)
 *   Orta sürükle / Space + sol sürükle → kamerayı kaydır (atalet ile)
 *   Tekerlek           → imlece doğru zoom          WASD / Oklar → kaydır
 *
 * DOKUNMATİK (telefon/tablet):
 *   Dokun              → seç (çift dokunuş: ekrandaki aynı türdekiler)
 *   Uzun bas (0,45 sn) → komut (sağ tık gibi: topla, inşa et, saldır, yürü)
 *   Tek parmak sürükle → haritayı kaydır (kutu modu açıksa / çit çizerken: seçim kutusu / hat)
 *   İki parmak         → kıstır-büyüt zoom + kaydır
 *   touchCommand açıksa dokunuş doğrudan komut olur (alt köşedeki "Komut" düğmesi).
 */
export class InputHandler {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.mouse = { x: 0, y: 0, inside: false };
    this.keys = new Set();
    this.drag = null;
    this.box = null;             // aktif seçim kutusu (ekran koordinatı)
    this._lastClick = { t: 0, x: 0, y: 0 };
    this.onLeftClick = null;     // (sx, sy, e)
    this.onDoubleClick = null;   // (sx, sy, e)
    this.onRightClick = null;    // (sx, sy, e)
    this.onBoxSelect = null;     // (box, e)
    this.onKeyPress = null;      // (code, e)
    this.touches = new Map();    // dokunmatik: pointerId → { x, y }
    this.pinch = null;
    this.touchBox = false;       // dokunmatik: tek parmak sürükleme kaydırma yerine seçim kutusu/hat çizsin
    this.touchCommand = false;   // dokunmatik: dokunuş = komut
    this.onTouchDetected = null;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e, false));
    c.addEventListener('pointercancel', (e) => this._onUp(e, true));
    c.addEventListener('pointerleave', () => { if (!this.drag) this.mouse.inside = false; });
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this._endDrag(); });
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ───────────── Dokunmatik ─────────────
  _touchDown(e) {
    e.preventDefault();
    if (!this.isTouch) { this.isTouch = true; this.onTouchDetected?.(); }
    const p = this._local(e);
    this.touches.set(e.pointerId, p);
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* yok say */ }
    if (this.touches.size === 2) {
      // İkinci parmak: tek parmak hareketini iptal et, kıstırmaya geç
      clearTimeout(this._longT);
      if (this.drag?.mode === 'pan') this.camera.endDrag();
      this.drag = null; this.box = null;
      const [a, b] = [...this.touches.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.touches.size > 2) return;
    this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.inside = true;
    const mode = this.touchBox ? 'box' : 'pan';
    this.drag = { id: e.pointerId, mode, touch: true, sx: p.x, sy: p.y, lx: p.x, ly: p.y, lt: e.timeStamp, vx: 0, vy: 0, moved: false, long: false };
    if (mode === 'pan') this.camera.beginDrag();
    // Uzun bas → komut
    clearTimeout(this._longT);
    this._longT = setTimeout(() => {
      const d = this.drag;
      if (!d || d.moved || d.id !== e.pointerId) return;
      d.long = true;
      navigator.vibrate?.(25);
      this.onRightClick?.(d.sx, d.sy, e);
    }, 450);
  }

  _touchMove(e) {
    if (!this.touches.has(e.pointerId)) return;
    const p = this._local(e);
    this.touches.set(e.pointerId, p);
    if (this.pinch && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.camera.panBy(mx - this.pinch.mx, my - this.pinch.my);
      if (this.pinch.d > 10) this.camera.zoomInstant(mx, my, d / this.pinch.d);
      this.pinch = { d, mx, my };
      return;
    }
    this.mouse.x = p.x; this.mouse.y = p.y;
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > CONFIG.DRAG_THRESHOLD * 2) { d.moved = true; clearTimeout(this._longT); }
    if (!d.moved || d.long) return;
    if (d.mode === 'pan') {
      const dx = p.x - d.lx, dy = p.y - d.ly, dt = Math.max(1, e.timeStamp - d.lt) / 1000;
      this.camera.panBy(dx, dy);
      d.vx += (dx / dt - d.vx) * 0.3; d.vy += (dy / dt - d.vy) * 0.3;
      d.lx = p.x; d.ly = p.y; d.lt = e.timeStamp;
    } else this.box = { x0: d.sx, y0: d.sy, x1: p.x, y1: p.y };
  }

  _touchUp(e, cancelled) {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* yok say */ }
    if (this.pinch) { if (this.touches.size < 2) this.pinch = null; return; }
    clearTimeout(this._longT);
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const p = this._local(e);
    if (!cancelled && !d.long) {
      if (d.mode === 'pan' && d.moved) { if (e.timeStamp - d.lt < 80) this.camera.fling(d.vx, d.vy); }
      else if (d.mode === 'box' && d.moved && this.box) this.onBoxSelect?.(this.box, e);
      else if (!d.moved) {
        if (this.touchCommand) this.onRightClick?.(p.x, p.y, e);
        else {
          const lc = this._lastClick;
          const dbl = e.timeStamp - lc.t < 350 && Math.hypot(p.x - lc.x, p.y - lc.y) < 24;
          this._lastClick = { t: dbl ? 0 : e.timeStamp, x: p.x, y: p.y };
          if (dbl) this.onDoubleClick?.(p.x, p.y, e); else this.onLeftClick?.(p.x, p.y, e);
        }
      }
    }
    if (d.mode === 'pan') this.camera.endDrag();
    this.drag = null; this.box = null;
  }

  _onDown(e) {
    if (e.pointerType === 'touch') { this._touchDown(e); return; }
    const p = this._local(e);
    if (e.button === 2) {           // sağ tık: anında komut (AoE gibi basışta tepki)
      e.preventDefault();
      this.onRightClick?.(p.x, p.y, e);
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const pan = e.button === 1 || this.keys.has('Space');
    this.drag = { id: e.pointerId, mode: pan ? 'pan' : 'box', sx: p.x, sy: p.y, lx: p.x, ly: p.y, lt: e.timeStamp, vx: 0, vy: 0, moved: false };
    if (pan) {
      this.camera.beginDrag();
      this.canvas.classList.add('dragging');
    }
  }

  _onMove(e) {
    if (e.pointerType === 'touch') { this._touchMove(e); return; }
    const p = this._local(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    this.mouse.inside = true;
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > CONFIG.DRAG_THRESHOLD) d.moved = true;
    if (d.mode === 'pan') {
      const dx = p.x - d.lx, dy = p.y - d.ly;
      const dt = Math.max(1, e.timeStamp - d.lt) / 1000;
      this.camera.panBy(dx, dy); // harita imlece 1:1 yapışık
      d.vx += (dx / dt - d.vx) * 0.3;
      d.vy += (dy / dt - d.vy) * 0.3;
      d.lx = p.x; d.ly = p.y; d.lt = e.timeStamp;
    } else if (d.moved) {
      this.box = { x0: d.sx, y0: d.sy, x1: p.x, y1: p.y };
    }
  }

  _onUp(e, cancelled) {
    if (e.pointerType === 'touch') { this._touchUp(e, cancelled); return; }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const p = this._local(e);
    if (!cancelled) {
      if (d.mode === 'pan') {
        if (d.moved && e.timeStamp - d.lt < 60) this.camera.fling(d.vx, d.vy);
      } else if (d.moved && this.box) {
        this.onBoxSelect?.(this.box, e);
      } else {
        const lc = this._lastClick;
        const dbl = e.timeStamp - lc.t < 320 && Math.hypot(p.x - lc.x, p.y - lc.y) < 8;
        this._lastClick = { t: dbl ? 0 : e.timeStamp, x: p.x, y: p.y };
        if (dbl) this.onDoubleClick?.(p.x, p.y, e);
        else this.onLeftClick?.(p.x, p.y, e);
      }
    }
    this._endDrag();
  }

  _endDrag() {
    if (!this.drag) return;
    try { this.canvas.releasePointerCapture(this.drag.id); } catch { /* bırakılmış olabilir */ }
    if (this.drag.mode === 'pan') this.camera.endDrag();
    this.drag = null;
    this.box = null;
    this.canvas.classList.remove('dragging');
  }

  _onWheel(e) {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    else if (e.deltaMode === 2) delta *= this.canvas.clientHeight;
    delta = Math.max(-300, Math.min(300, delta));
    // Üstel zoom: her çentik ölçeği aynı ORANDA değiştirir (0.5x'te de 2.5x'te de aynı his)
    const p = this._local(e);
    this.camera.zoomAt(p.x, p.y, Math.exp(-delta * CONFIG.ZOOM_SENSITIVITY));
  }

  _onKey(e, down) {
    if (e.target instanceof HTMLInputElement) return;
    if (down) {
      if (!e.repeat) this.onKeyPress?.(e.code, e);
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
    // Tarayıcı kısayollarını oyuna bırak: Ctrl+rakam (sekme değiştirme), F5 (yenileme → hızlı kayıt), F10, oklar…
    if (e.code.startsWith('Arrow') || e.code === 'Space' || /^F(1|2|3|5|10)$/.test(e.code) || ((e.ctrlKey || e.metaKey) && e.code.startsWith('Digit'))) e.preventDefault();
  }

  update(dt) {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x -= 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (x || y) {
      const n = x && y ? Math.SQRT1_2 : 1;
      const v = CONFIG.KEY_PAN_SPEED * dt * n;
      this.camera.panBy(x * v, y * v);
    }
  }
}
