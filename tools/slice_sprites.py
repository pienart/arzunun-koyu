"""
Kullanım:  python tools/slice_sprites.py      (gerekenler: pip install pillow numpy scipy)
Önce sesler için: python tools/process_audio.py tools/raw/sounds assets/sounds   (ffmpeg gerekir)
"""
"""
Sprite sayfalarını şeffaflık (alpha) bağlantılı bileşenlerine göre otomatik böler.
Her sprite için: kırpılmış PNG + taban ölçümleri (anchorX, baseW) → assets/manifest.js
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')                 # ham sprite sayfaları ve dokular
OUT = os.path.join(HERE, '..', 'assets')         # oyunun kullandığı çıktı klasörü

SHEETS = {
    'sheet_tier0.webp':    (2, 3, ['townCenter_0', 'house_0', 'lumberCamp_0', 'mill_0', 'miningCamp_0', 'foundation'], 'sprites', 640),
    'sheet_tier1.webp':    (2, 3, ['townCenter_1', 'house_1', 'lumberCamp_1', 'mill_1', 'miningCamp_1', 'market_1'], 'sprites', 640),
    'sheet_tier2.webp':    (2, 3, ['townCenter_2', 'house_2', 'lumberCamp_2', 'mill_2', 'miningCamp_2', 'wonder_2'], 'sprites', 760),
    'sheet_nature.webp':   (2, 4, ['tree_oak', 'tree_pine', 'tree_autumn', 'berry', 'gold', 'stone', 'mountain', 'stump'], 'sprites', 300),
    'sheet_villager.webp': (2, 4, ['vil_idle', 'vil_walk1', 'vil_walk2', 'vil_chop', 'vil_carry', 'vil_build', 'vil_mine', 'vil_gather'], 'sprites', 0),
    'sheet_icons.webp':    (3, 4, ['wood', 'food', 'gold', 'stone', 'pop', 'age', 'axe', 'horseCollar', 'pickaxe', 'trade', 'wheelbarrow', 'build'], 'icons', 96),
    'sheet_military.webp': (2, 4, ['barracks_0', 'barracks_1', 'barracks_2', 'archeryRange_1', 'archeryRange_2', 'watchTower_1', 'watchTower_2', 'ruins'], 'sprites', 560),
    'sheet_soldiers.webp': (2, 4, ['mil_idle', 'mil_walk1', 'mil_walk2', 'mil_attack', 'arc_idle', 'arc_walk1', 'arc_walk2', 'arc_shoot'], 'sprites', 0),
    'sheet_icons2.webp':   (2, 3, ['swords', 'quiver', 'shield', 'horn', 'banner', 'torch'], 'icons', 96),
}
UNIT_PREFIXES = ('vil_', 'mil_', 'arc_')


def components(alpha, rows, cols):
    mask = alpha > 40
    # Yakın parçaları (bayrak, ip, yel değirmeni kanatları) birleştirmek için genişlet
    dil = ndimage.binary_dilation(mask, iterations=14)
    lab, n = ndimage.label(dil)
    objs = ndimage.find_objects(lab)
    areas = ndimage.sum(mask, lab, range(1, n + 1))
    items = []
    for k, sl in enumerate(objs):
        if areas[k] < 0.15 * mask.sum() / (rows * cols):
            continue
        items.append((sl, k + 1, areas[k]))
    return lab, items, mask


def order(items, rows, cols, H, W):
    # Izgara hücresine göre sırala (merkezin düştüğü hücre)
    cells = {}
    for sl, lid, area in items:
        cy = (sl[0].start + sl[0].stop) / 2
        cx = (sl[1].start + sl[1].stop) / 2
        r = min(rows - 1, int(cy / H * rows))
        c = min(cols - 1, int(cx / W * cols))
        key = r * cols + c
        if key not in cells or cells[key][2] < area:
            cells[key] = (sl, lid, area)
    return cells


def base_metrics(a, frac):
    """Alt `frac` kısmındaki opak piksellerin yatay aralığı → taban merkezi ve genişliği."""
    h, w = a.shape
    y0 = int(h * (1 - frac))
    cols = np.where((a[y0:] > 60).any(axis=0))[0]
    if len(cols) == 0:
        return 0.5, w
    return float((cols[0] + cols[-1]) / 2 / w), float(cols[-1] - cols[0] + 1)


manifest = {'sprites': {}, 'icons': {}, 'textures': {}}
report = []
for fname, (rows, cols, names, folder, maxdim) in SHEETS.items():
    im = Image.open(os.path.join(RAW, fname)).convert('RGBA')
    arr = np.array(im)
    H, W = arr.shape[:2]
    lab, items, mask = components(arr[..., 3], rows, cols)
    cells = order(items, rows, cols, H, W)
    report.append(f'{fname}: {len(items)} bileşen, {len(cells)} hücre dolu')
    villager_scale = None
    for idx, name in enumerate(names):
        if idx not in cells:
            report.append(f'  !! {name} bulunamadı')
            continue
        sl, lid, _ = cells[idx]
        sub = arr[sl].copy()
        # Yalnızca bu bileşene ait pikselleri tut (komşu hücreden taşan parçaları sil)
        own = (lab[sl] == lid)
        sub[..., 3] = np.where(own, sub[..., 3], 0)
        # Sıkı kırpma
        ys, xs = np.where(sub[..., 3] > 8)
        sub = sub[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        img = Image.fromarray(sub)
        if folder == 'sprites' and name.startswith(UNIT_PREFIXES):
            # Aynı sayfadaki tüm birim karelerine AYNI ölçek: sayfanın ilk (idle) karesi 160 px yüksekliğe
            if villager_scale is None:
                villager_scale = 160 / img.height
            s = villager_scale
        else:
            s = min(1.0, maxdim / max(img.size)) if maxdim else 1.0
        if s != 1.0:
            img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
        a = np.array(img)[..., 3]
        frac = 0.08 if (name.startswith(UNIT_PREFIXES) or name.startswith('tree')) else 0.3
        ax, bw = base_metrics(a, frac)
        if name.startswith(UNIT_PREFIXES):
            # Yürüme karelerinde tek ayak öne çıkar; çapa = alt yarının kütle merkezi (gövde ekseni)
            ys2, xs2 = np.where(a[a.shape[0] // 2:] > 60)
            ax = float(xs2.mean() / a.shape[1])
        # WebP (alfa destekli, kayıplı q=90): PNG'ye göre ~5-8 kat küçük, görsel fark yok
        path = os.path.join(OUT, folder, name + '.webp')
        img.save(path, 'WEBP', quality=90, method=6)
        entry = {'file': f'assets/{folder}/{name}.webp', 'w': img.width, 'h': img.height,
                 'anchorX': round(ax, 4), 'baseW': round(bw, 1)}
        manifest[folder][name] = entry
        report.append(f'  {name}: {img.width}x{img.height} anchorX={ax:.2f} baseW={bw:.0f}')


def make_seamless(img):
    """Yarım-ofset karışım: kenarlar, görüntünün (zaten sürekli olan) merkez bölgesinden gelir."""
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    rolled = np.roll(np.roll(a, h // 2, axis=0), w // 2, axis=1)
    y = np.minimum(np.arange(h), h - 1 - np.arange(h)) / (h / 2)
    x = np.minimum(np.arange(w), w - 1 - np.arange(w)) / (w / 2)
    m = np.clip(np.minimum.outer(y, x) * 2.2, 0, 1)[..., None]  # kenarda 0 → rolled, içeride 1 → orijinal
    m = m * m * (3 - 2 * m)
    return Image.fromarray((a * m + rolled * (1 - m)).clip(0, 255).astype(np.uint8))


for tex in ['grass', 'dirt', 'sand', 'rock', 'farm', 'water']:
    p = os.path.join(RAW, f'tex_{tex}.webp')
    if not os.path.exists(p):
        report.append(f'doku yok: {tex}')
        continue
    img = Image.open(p).convert('RGB').resize((512, 512), Image.LANCZOS)
    if tex != 'farm':  # tarla sıraları düzenli; karışım sıraları bulanıklaştırmasın
        img = make_seamless(img)
    out = os.path.join(OUT, 'textures', f'{tex}.jpg')
    img.save(out, quality=88)
    avg = np.asarray(img).reshape(-1, 3).mean(axis=0)
    manifest['textures'][tex] = {'file': f'assets/textures/{tex}.jpg', 'size': 512,
                                 'avg': '#%02x%02x%02x' % tuple(int(v) for v in avg)}
    report.append(f'doku {tex}: ort renk {manifest["textures"][tex]["avg"]}')

# Sesler (process_audio.py çıktısı) manifest'e eklenir
snd = os.path.join(OUT, 'sounds', 'sounds.json')
if os.path.exists(snd):
    with open(snd, encoding='utf-8') as f:
        manifest['sounds'] = json.load(f)

with open(os.path.join(OUT, 'manifest.js'), 'w', encoding='utf-8') as f:
    f.write('// Otomatik üretildi (tools/slice_sprites.py). Sprite boyutları ve taban ölçümleri.\n')
    f.write('export const MANIFEST = ' + json.dumps(manifest, indent=2, ensure_ascii=False) + ';\n')
print('\n'.join(report))
