"""
Arzu'nun Köyü — yerel geliştirme sunucusu.

`python -m http.server` dosyaları önbelleğe alınabilir şekilde sunar; oyun güncellenince tarayıcı eski
JavaScript modüllerini kullanmaya devam edebilir (Ctrl+F5 gerekir). Bu sunucu her yanıta
"Cache-Control: no-cache" ekler: tarayıcı her açılışta dosyanın değişip değişmediğini sorar, değişmediyse
yine önbellekten alır (hızlı), değiştiyse yenisini indirir.

Kullanım:  python tools/server.py [port]      (varsayılan 8080, proje kökünü sunar)
"""
import contextlib
import http.server
import os
import socket
import sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.json': 'application/json',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):  # sessiz: konsolu istek satırlarıyla doldurma
        pass


class DualStackServer(http.server.ThreadingHTTPServer):
    """IPv6 + IPv4 birlikte. Windows'ta "localhost" önce ::1'e (IPv6) bağlanmayı dener; sunucu yalnızca
    127.0.0.1'i dinlerse her bağlantı ~2 sn bekleyip IPv4'e düşer → 130 görsel 10+ sn'de yüklenirdi."""
    address_family = socket.AF_INET6

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = partial(Handler, directory=ROOT)
    try:
        # '::' tüm arayüzler (eski `python -m http.server` da 0.0.0.0'ı dinliyordu)
        server = DualStackServer(('::', port), handler)
    except OSError:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)  # IPv6 yoksa yalnızca IPv4
    print(f"Arzu'nun Köyü çalışıyor: http://localhost:{port}/   (kapatmak için Ctrl+C)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
