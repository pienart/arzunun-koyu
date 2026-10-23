"""
Önbellek kırıcı: her JavaScript dosyasına içerik özetinden bir sürüm verir.

Sorun: tarayıcı ES modüllerini (ör. js/systems/Pathfinder.js) önbellekte tutabilir; oyun güncellenince bir kısmı
eski kalır ve eski/yeni dosyalar birbirine uymaz (ör. tekneler karadan yol bulmaya çalışıp yerinde kalır).
Çözüm: index.html'e bir "import map" yazılır:  "./js/x.js" → "./js/x.js?v=<özet>". Dosya değişince adresi de
değişir, tarayıcı eskisini kullanamaz. Değişmeyen dosyalar önbellekten gelmeye devam eder.
Ayrıca js/build.js (BUILD kimliği ve VERSION dosyasındaki sürüm) yazılır; görsel ve ses adresleri ?v=BUILD alır.

Kullanım:  python tools/stamp.py      (kodu değiştirdikten sonra, commit'ten önce)
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BEGIN, END = '<!-- build:begin (tools/stamp.py üretir, elle düzenlemeyin) -->', '<!-- build:end -->'


def digest(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:10]


def main():
    files = sorted(p for p in (ROOT / 'js').rglob('*.js') if p.name != 'build.js')
    files.append(ROOT / 'assets' / 'manifest.js')
    hashes = {p.relative_to(ROOT).as_posix(): digest(p) for p in files}
    build = hashlib.sha1(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:10]
    vfile = ROOT / 'VERSION'
    version = vfile.read_text(encoding='utf-8').strip() if vfile.exists() else '0.0.0'
    (ROOT / 'js' / 'build.js').write_text(
        "// tools/stamp.py üretir: içerik özeti (görsel/ses adreslerine ?v= olarak eklenir) ve sürüm (VERSION dosyası)\n"
        f"export const BUILD = '{build}';\n"
        f"export const VERSION = '{version}';\n", encoding='utf-8')
    hashes['js/build.js'] = digest(ROOT / 'js' / 'build.js')
    css = digest(ROOT / 'css' / 'style.css')

    imports = {f'./{k}': f'./{k}?v={v}' for k, v in sorted(hashes.items())}
    block = (f'{BEGIN}\n  <link rel="stylesheet" href="css/style.css?v={css}" />\n'
             f'  <script type="importmap">\n  {json.dumps({"imports": imports}, indent=2, ensure_ascii=False).replace(chr(10), chr(10) + "  ")}\n  </script>\n  {END}')
    index = ROOT / 'index.html'
    html = index.read_text(encoding='utf-8')
    if BEGIN in html:
        html = html[:html.index(BEGIN)] + block + html[html.index(END) + len(END):]
    else:
        html = re.sub(r'  <link rel="stylesheet" href="css/style\.css[^"]*" />', '  ' + block, html, count=1)
    html = re.sub(r'src="js/main\.js(\?v=\w+)?"', f'src="js/main.js?v={hashes["js/main.js"]}"', html)
    index.write_text(html, encoding='utf-8')
    print(f'Sürüm: {build} ({len(hashes)} modül)')


if __name__ == '__main__':
    main()
