#!/usr/bin/env sh
# Arzu'nun Köyü - macOS / Linux yerel sunucu
cd "$(dirname "$0")" || exit 1
URL="http://localhost:8080/"
( sleep 2; (command -v open >/dev/null && open "$URL") || (command -v xdg-open >/dev/null && xdg-open "$URL") ) >/dev/null 2>&1 &
if command -v python3 >/dev/null 2>&1; then exec python3 tools/server.py 8080
elif command -v python >/dev/null 2>&1; then exec python tools/server.py 8080
elif command -v npx >/dev/null 2>&1; then exec npx --yes serve -l 8080 .
else echo "Python veya Node.js bulunamadı. Lütfen birini kurun."; exit 1
fi
