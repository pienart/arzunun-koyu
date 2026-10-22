"""
Ses işleme: baştaki sessizliği kırp, süreyi sınırla, sondaki sessizliği at, kısa sönümleme ekle,
tepe seviyesini eşitle → mono 96 kbps MP3 (assets/sounds) + sounds.json (süre bilgisi).
ffmpeg yalnızca çözme/kodlama için kullanılır; kırpma ve seviye işlemleri numpy ile örnek düzeyinde yapılır.
Kullanım: python tools/process_audio.py tools/raw/sounds assets/sounds   (gerekenler: ffmpeg, numpy)
"""
import json, os, subprocess, sys
import numpy as np

SR = 44100
# ad: (azami süre sn, hedef tepe dB, döngü mü)
SPEC = {
    'chop': (0.55, -2.0, False), 'mine': (0.6, -2.0, False), 'hammer': (0.5, -3.0, False),
    'sword': (0.9, -2.0, False), 'bow': (1.3, -3.0, False), 'hit': (0.5, -4.0, False),
    'death': (1.2, -3.0, False), 'bell': (1.6, -4.0, False), 'horn': (2.6, -2.0, False),
    'fanfare': (4.6, -2.0, False), 'collapse': (2.4, -2.0, False), 'click': (0.25, -6.0, False),
    'defeat': (5.0, -3.0, False), 'nature': (40.0, -12.0, True),
}


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def encode(x, path):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                    '-b:a', '96k', path], input=x.astype(np.float32).tobytes(), check=True)


def first_above(x, db, win=256):
    """RMS penceresi eşiği ilk aştığı örnek (geri: kaynağın başlangıcını kesmemek için 5 ms pay)."""
    thr = 10 ** (db / 20)
    n = len(x) // win
    if n == 0:
        return 0
    rms = np.sqrt((x[:n * win].reshape(n, win) ** 2).mean(axis=1))
    idx = np.argmax(rms > thr) if (rms > thr).any() else 0
    return max(0, idx * win - int(0.005 * SR))


def process(src, dst, name):
    max_d, target, loop = SPEC[name]
    x = decode(src)
    if not loop:
        x = x[first_above(x, -50):]                 # baştaki sessizlik
        x = x[:int(max_d * SR)]                      # azami süre
        end = len(x) - first_above(x[::-1], -60)     # sondaki sessizlik
        x = x[:max(end, int(0.05 * SR))]
        fade = min(len(x), int(0.08 * SR))           # klik olmasın diye kısa sönümleme
        x[-fade:] *= np.linspace(1, 0, fade)
    else:
        x = x[:int(max_d * SR)]
        f = int(0.6 * SR)                            # döngü dikişi: baş/son kısa geçiş
        x[:f] *= np.linspace(0, 1, f)
        x[-f:] *= np.linspace(1, 0, f)
    peak = np.abs(x).max() or 1.0
    x *= (10 ** (target / 20)) / peak                # tepe seviyesini eşitle
    encode(x, dst)
    return round(len(x) / SR, 2)


if __name__ == '__main__':
    raw, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    manifest = {}
    for name in SPEC:
        src = os.path.join(raw, f'{name}.mp3')
        if not os.path.exists(src):
            print('eksik:', name)
            continue
        d = process(src, os.path.join(out, f'{name}.mp3'), name)
        manifest[name] = {'file': f'assets/sounds/{name}.mp3', 'dur': d, 'loop': SPEC[name][2]}
        print(f'{name:9s} {d:5.2f} sn  {os.path.getsize(os.path.join(out, name + ".mp3")) // 1024} KB')
    with open(os.path.join(out, 'sounds.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
