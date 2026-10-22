"""
Higgsfield ile üretilen ek sesleri oyuna hazırlar → assets/sounds/*.mp3 + assets/manifest.js "sounds".

  • Ses seviyesi eşitlenir (RMS hedefi türüne göre: efekt / ambiyans / müzik)
  • Döngü sesleri (ambiyans, müzik) kesintisiz döner: sonun son 1,5 sn'si başa çapraz geçişle karıştırılır
  • Kısa efektlerin başındaki/sonundaki sessizlik kırpılır

Kullanım:  python tools/process_audio2.py            (girdi: tools/raw/sounds2/*.mp3|m4a|wav)
Gerekenler: pip install imageio-ffmpeg numpy
"""
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'tools' / 'raw' / 'sounds2'
OUT = ROOT / 'assets' / 'sounds'
FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 44100

# ad → (tür, hedef RMS dBFS)
SPECS = {
    'amb_day': ('loop', -24), 'amb_night': ('loop', -24), 'rain': ('loop', -22), 'wind': ('loop', -24),
    'fire': ('loop', -22), 'music_village': ('loop', -20), 'music_battle': ('loop', -19),
'ram': ('sfx', -16), 'splash': ('sfx', -20), 'cluck': ('sfx', -21), 'net': ('sfx', -21),
}


def decode(path):
    raw = subprocess.run([FF, '-v', 'error', '-i', str(path), '-f', 's16le', '-ac', '2', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).reshape(-1, 2).astype(np.float32) / 32768


def encode(x, path):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    subprocess.run([FF, '-v', 'error', '-y', '-f', 's16le', '-ac', '2', '-ar', str(SR), '-i', '-',
                    '-codec:a', 'libmp3lame', '-q:a', '4', str(path)], input=pcm, check=True)


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)


def main():
    mpath = ROOT / 'assets' / 'manifest.js'
    text = mpath.read_text(encoding='utf-8')
    head, body = text[:text.index('{')], text[text.index('{'):text.rindex('}') + 1]
    manifest = json.loads(body)
    for f in sorted(RAW.iterdir()):
        name = f.stem
        if name not in SPECS:
            continue
        kind, target = SPECS[name]
        x = decode(f)
        if kind == 'sfx':
            env = np.abs(x).max(axis=1)
            idx = np.nonzero(env > env.max() * 0.12)[0]  # sesin kendi tepesine göre eşik
            if len(idx):
                x = x[max(0, idx[0] - 200): min(len(x), idx[-1] + 2000)]
            fade = min(len(x) // 4, int(0.04 * SR))
            x[-fade:] *= np.linspace(1, 0, fade)[:, None]
        else:
            # Kesintisiz döngü: son XF örnek, başlangıca eşit güçlü çapraz geçişle karışır, sonra kesilir
            xf = min(int(1.5 * SR), len(x) // 4)
            t = np.linspace(0, np.pi / 2, xf)[:, None]
            head_part = x[:xf] * np.sin(t) + x[-xf:] * np.cos(t)
            x = np.concatenate([head_part, x[xf:-xf]])
        gain = 10 ** ((target - rms_db(x)) / 20)
        x = x * gain
        peak = np.abs(x).max()
        if peak > 0.97:
            x *= 0.97 / peak
        out = OUT / f'{name}.mp3'
        encode(x, out)
        manifest['sounds'][name] = {'file': f'assets/sounds/{name}.mp3', 'dur': round(len(x) / SR, 2), 'loop': kind == 'loop'}
        print(f'{name}: {len(x) / SR:.1f} sn, {kind}, kazanç {20 * np.log10(gain):+.1f} dB')
    mpath.write_text(head + json.dumps(manifest, indent=2, ensure_ascii=False) + ';\n', encoding='utf-8')


if __name__ == '__main__':
    main()
