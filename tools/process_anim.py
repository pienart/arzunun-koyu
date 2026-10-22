"""
Higgsfield (Kling 3.0) ile üretilen karakter videolarını oyun animasyon şeritlerine çevirir.

Girdi : tools/raw/anim/<anahtar>.mp4   — düz macenta (#FF00FF) zemin üzerinde, sabit kamerada,
                                         başlangıç ve bitiş karesi aynı (döngü) karakter videosu
Çıktı : assets/anims/<anahtar>.webp     — N kareden oluşan yatay şerit (her kare aynı boyutta, saydam)
        assets/manifest.js  "anims"      — kare sayısı, kare boyutu, taban noktası (anchorX)
        (Zamanlama — adım uzunluğu, döngü süresi, vuruş anı — js/data/animData.js içindedir.)

Adımlar
  1) Kareleri oku, macenta zemini "chroma key" ile saydamlaştır (yumuşak kenar + renk taşması temizliği)
  2) Videodaki tekrar eden hareketi bul: ilk kareye en çok benzeyen sonraki kare = bir döngünün sonu
  3) Döngüden eşit aralıklı N kare seç, tüm karelere ortak bir kırpma kutusu uygula (karakter titremesin)
  4) İlk kare = kaynak sprite olduğu için ölçek, kaynak sprite yüksekliğine eşitlenir (oyundaki boy değişmez)

Kullanım:  python tools/process_anim.py [anahtar ...]
Gerekenler: pip install opencv-python-headless pillow numpy
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'tools' / 'raw' / 'anim'
OUT = ROOT / 'assets' / 'anims'

# anahtar → (kaynak sprite, kare sayısı, döngü süresi sn, döngü arama aralığı (en az/en çok kare))
# Döngü süresi: iş animasyonlarında bir vuruşun süresi; yürüyüşte bir adım çifti (oyunda mesafeyle eşlenir)
# KEYS: otomatik döngü bulma yerine elle seçilmiş video kareleri. Videoda alet uzun süre yerde bekliyorsa
# (balta/kazma) bekleme kısaltılır, vuruş anı (hit, animData.js) seçilen dizideki konumuna göre ayarlanır.
KEYS = {
    'vil_chop': [0, 6, 10, 12, 14, 16, 18, 22, 48, 51, 54, 56, 58, 62],
    'vil_mine': [0, 12, 24, 27, 29, 31, 33, 36, 46, 49, 52, 55, 58, 62],
}
SPECS = {
    'vil_walk':   ('vil_walk1', 16, 0.9,  (14, 40)),
    'vil_carry':  ('vil_carry', 16, 1.0,  (14, 40)),
    'vil_chop':   ('vil_chop',  14, 1.0,  (12, 48)),
    'vil_mine':   ('vil_mine',  14, 1.0,  (12, 48)),
    'vil_build':  ('vil_build', 12, 0.8,  (10, 48)),
    'vil_gather': ('vil_gather', 14, 1.4, (12, 48)),
    'mil_walk':   ('mil_walk1', 16, 0.95, (14, 40)),
    'mil_attack': ('mil_attack', 14, 1.0, (12, 48)),
    'arc_walk':   ('arc_walk1', 16, 0.95, (14, 40)),
    'arc_shoot':  ('arc_shoot', 16, 1.2,  (12, 60)),
}
# 8 yönlü yürüyüş: _s (kameraya doğru), _n (uzağa), _se / _ne (çaprazlar). Batı yönleri oyunda aynalanır.
for _base, _src in [('vil_walk', 'vil_walk1'), ('vil_carry', 'vil_carry'), ('mil_walk', 'mil_walk1'), ('arc_walk', 'arc_walk1')]:
    for _d in ['_s', '_n', '_se', '_ne']:
        SPECS[_base + _d] = (_src, 16, 0.9, (30, 44))  # tam adım çifti ~1,5 sn (24 fps)
SPECS['mil_drink'] = ('mil_idle', 16, 3.0, (30, 72))
# Atlı: yürüyüş (yan + 4 yön), saldırı
SPECS['cav_walk'] = ('cav_idle', 16, 0.9, (24, 44))
for _d in ['_s', '_n', '_se', '_ne']:
    SPECS['cav_walk' + _d] = ('cav_idle', 16, 0.9, (24, 44))
SPECS['cav_attack'] = ('cav_idle', 14, 1.0, (20, 60))
# Koca Ayak (mağara yaratığı): ağır yürüyüş ve iki yumrukla ezme
SPECS['yeti_walk'] = ('yeti_idle', 16, 1.0, (24, 60))
SPECS['yeti_attack'] = ('yeti_idle', 14, 1.0, (30, 72))
# Hayvan çiftliği (bina: sağım, kuyruk sallama) ve mimar
SPECS['animalFarm_0'] = ('animalFarm_0', 12, 1.0, (24, 72))
SPECS['arch_walk'] = ('arch_idle', 16, 1.0, (24, 60))
SPECS['arch_build'] = ('arch_idle', 14, 1.0, (30, 72))
# Yel değirmeni kanatları (bina): kaynak sprite'ın kare içindeki yeri "ref" olarak kaydedilir
for _t in range(3):
    SPECS[f'mill_{_t}'] = (f'mill_{_t}', 12, 2.0, (12, 72))
# Ölüm animasyonları: tek seferlik (döngü aranmaz, videonun ilk 2,4 sn'si)
for _p, _src in [('vil', 'vil_idle'), ('mil', 'mil_idle'), ('arc', 'arc_idle'), ('cav', 'cav_idle')]:
    SPECS[f'{_p}_death'] = (_src, 14, 1.2, (0, 0))
ONESHOT = {k for k in SPECS if k.endswith('_death')}
# Ölüm videosunun kullanılacak aralığı (kare): üretilen videoların bazılarında düşüş geç başlıyor
ONESHOT_RANGE = {'vil_death': (27, 58), 'arc_death': (38, 72)}
# Büyük animasyonlar küçültülür (bellek): en fazla bu yükseklikte kare
MAXH = {'mill_0': 300, 'mill_1': 300, 'mill_2': 300, 'animalFarm_0': 320}


def load_manifest_sprites():
    """assets/manifest.js içindeki sprite boyutlarını okur (JS nesnesi → JSON)."""
    text = (ROOT / 'assets' / 'manifest.js').read_text(encoding='utf-8')
    body = text[text.index('{'):text.rindex('}') + 1]
    return json.loads(body)['sprites']


def chroma_key(frame_bgr, bg):
    """Macenta zemini saydamlaştırır. Dönüş: RGBA (float 0..1)."""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Macentalık: R ve B'nin G'den ne kadar fazla olduğu (karakterde böyle renk yok)
    mag = np.minimum(r, b) - g
    d = np.linalg.norm(rgb - bg, axis=-1)
    a = np.clip((d - 0.18) / 0.22, 0, 1) * np.clip((0.55 - mag) / 0.35, 0, 1)
    a = cv2.GaussianBlur(a, (3, 3), 0)
    # Renk taşması: kenarlardaki pembe hâleyi bastır (R ve B'yi G'ye doğru çek)
    spill = np.clip(mag, 0, None) * (1 - a * 0.6)
    rgb[..., 0] -= spill
    rgb[..., 2] -= spill
    rgb = np.clip(rgb, 0, 1)
    # Bağlı olmayan küçük kırıntıları (video gürültüsü) temizle: en büyük bileşen + yakın parçalar kalır
    mask = (a > 0.5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n > 1:
        keep = np.zeros(n, bool)
        big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        for k in range(1, n):
            if k == big or stats[k, cv2.CC_STAT_AREA] > 60:
                keep[k] = True
        solid = keep[lab]
        solid = cv2.dilate(solid.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        a = a * solid
    return np.dstack([rgb, a])


def find_cycle(frames_small, lo, hi):
    """İlk kareye en çok benzeyen kare (lo..hi aralığında) → döngü uzunluğu."""
    ref = frames_small[0]
    best, best_d = None, 1e9
    for k in range(lo, min(hi, len(frames_small) - 1) + 1):
        d = float(np.mean(np.abs(frames_small[k] - ref)))
        if d < best_d:
            best, best_d = k, d
    return best or len(frames_small) - 1


def process(key, sprites):
    src_key, n_out, period, (lo, hi) = SPECS[key]
    cap = cv2.VideoCapture(str(RAW / f'{key}.mp4'))
    raw = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        raw.append(f)
    if not raw:
        raise SystemExit(f'{key}: video okunamadı')
    # Zemin rengi: köşelerin ortancası
    c = np.concatenate([raw[0][:20, :20].reshape(-1, 3), raw[0][-20:, -20:].reshape(-1, 3)])
    bg = cv2.cvtColor(np.median(c, axis=0).astype(np.uint8)[None, None], cv2.COLOR_BGR2RGB)[0, 0] / 255.0
    rgba = [chroma_key(f, bg) for f in raw]

    small = [cv2.resize(x[..., 3] * 0.5 + x[..., :3].mean(-1) * x[..., 3] * 0.5, (96, 96)) for x in rgba]
    if key in ONESHOT:
        first, last = ONESHOT_RANGE.get(key, (0, int(2.4 * 24)))
        last = min(len(rgba) - 1, last)
        idx, cyc = [round(first + i * (last - first) / (n_out - 1)) for i in range(n_out)], last
    elif key in KEYS:
        idx, cyc = KEYS[key], KEYS[key][-1]
        n_out = len(idx)
    else:
        cyc = find_cycle(small, lo, hi)
        idx = [round(i * cyc / n_out) for i in range(n_out)]
    sel = [rgba[i] for i in idx]

    # Ortak kırpma kutusu (tüm seçili karelerin birleşimi)
    union = np.zeros(sel[0].shape[:2], bool)
    for x in sel:
        union |= x[..., 3] > 0.04
    ys, xs = np.nonzero(union)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    # Ölçek: ilk karedeki karakter boyu = kaynak sprite boyu
    a0 = sel[0][..., 3] > 0.04
    ys0, xs0 = np.nonzero(a0)
    h0 = ys0.max() - ys0.min() + 1
    src = sprites[src_key]
    scale = src['h'] / h0
    if key in MAXH:
        scale = min(scale, MAXH[key] / (y1 - y0))
    # Taban noktası: kaynaktaki ayak merkezi, ilk karenin kutusuna göre konumlanır
    w0 = xs0.max() - xs0.min() + 1
    foot_x = xs0.min() + src['anchorX'] * w0
    fw = round((x1 - x0) * scale)
    fh = round((y1 - y0) * scale)
    # Alt kenar: tüm karelerde ayakların değdiği en alt satır (y1) → oyunda zemine basar
    strip = Image.new('RGBA', (fw * n_out, fh))
    for k, x in enumerate(sel):
        crop = (np.clip(x[y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8)
        im = Image.fromarray(crop, 'RGBA').resize((fw, fh), Image.LANCZOS)
        strip.alpha_composite(im, (k * fw, 0))
    OUT.mkdir(parents=True, exist_ok=True)
    strip.save(OUT / f'{key}.webp', 'WEBP', quality=90, method=6)
    meta = {
        'file': f'assets/anims/{key}.webp', 'frames': n_out, 'w': fw, 'h': fh,
        'anchorX': round(float((foot_x - x0) / (x1 - x0)), 4),
        # Kaynak sprite'ın (ilk kare) kare içindeki yeri: oyunda sabit görselin dikdörtgenine oturtmak için
        'ref': [round(float((xs0.min() - x0) / (x1 - x0)), 4), round(float((ys0.min() - y0) / (y1 - y0)), 4),
                round(float(w0 / (x1 - x0)), 4), round(float(h0 / (y1 - y0)), 4)],
    }
    print(f'{key}: döngü {cyc} kare / {len(raw)} -> {n_out} kare, {fw}x{fh}, anchorX {meta["anchorX"]}')
    return meta


def main():
    sprites = load_manifest_sprites()
    keys = sys.argv[1:] or [k for k in SPECS if (RAW / f'{k}.mp4').exists()]
    mpath = ROOT / 'assets' / 'manifest.js'
    text = mpath.read_text(encoding='utf-8')
    head, body = text[:text.index('{')], text[text.index('{'):text.rindex('}') + 1]
    manifest = json.loads(body)
    anims = manifest.setdefault('anims', {})
    for key in keys:
        anims[key] = process(key, sprites)
    mpath.write_text(head + json.dumps(manifest, indent=2, ensure_ascii=False) + ';\n', encoding='utf-8')


if __name__ == '__main__':
    main()
