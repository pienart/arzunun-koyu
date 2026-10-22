"""
Düz macenta (#FF00FF) zemin üzerinde üretilmiş tek bir bina görselini oyun sprite'ına çevirir
ve assets/manifest.js'e ekler (taban ölçümü slice_sprites.py ile aynı yöntem).

Kullanım:  python tools/key_sprite.py <girdi.png> <anahtar> [en büyük boyut]   ör.  tools/raw/dock.png dock_0 640
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MAXDIM = 640


def key_magenta(arr):
    rgb = arr[..., :3].astype(np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mag = np.minimum(r, b) - g                      # macentalık: R ve B, G'den ne kadar fazla
    a = np.clip((0.62 - mag) / 0.3, 0, 1)
    spill = np.clip(mag, 0, None) * (1 - a * 0.6)   # kenardaki pembe hâleyi bastır
    rgb[..., 0] -= spill
    rgb[..., 2] -= spill
    out = np.dstack([np.clip(rgb, 0, 1), a])
    return (out * 255).astype(np.uint8)


def base_metrics(a, frac):
    h, w = a.shape
    y0 = int(h * (1 - frac))
    cols = np.where((a[y0:] > 60).any(axis=0))[0]
    if len(cols) == 0:
        return 0.5, w
    return float((cols[0] + cols[-1]) / 2 / w), float(cols[-1] - cols[0] + 1)


def main(src, key, maxdim=MAXDIM):
    arr = key_magenta(np.array(Image.open(src).convert('RGB')))
    ys, xs = np.where(arr[..., 3] > 8)
    img = Image.fromarray(arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1], 'RGBA')
    s = min(1.0, maxdim / max(img.size))
    if s != 1:
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    ax, bw = base_metrics(np.array(img)[..., 3], 0.3)
    out = ROOT / 'assets' / 'sprites' / f'{key}.webp'
    img.save(out, 'WEBP', quality=90, method=6)

    mpath = ROOT / 'assets' / 'manifest.js'
    text = mpath.read_text(encoding='utf-8')
    head, body = text[:text.index('{')], text[text.index('{'):text.rindex('}') + 1]
    manifest = json.loads(body)
    manifest['sprites'][key] = {'file': f'assets/sprites/{key}.webp', 'w': img.width, 'h': img.height,
                                'anchorX': round(ax, 4), 'baseW': round(bw, 1)}
    mpath.write_text(head + json.dumps(manifest, indent=2, ensure_ascii=False) + ';\n', encoding='utf-8')
    print(f'{key}: {img.width}x{img.height} anchorX={ax:.3f} baseW={bw:.0f}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else MAXDIM)
