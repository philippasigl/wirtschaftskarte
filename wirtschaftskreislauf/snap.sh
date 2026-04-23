#!/bin/bash
# snap.sh — render index.html via headless browser → screenshot.png
#
# Nutzung:   ./snap.sh
# Ausgabe:   wirtschaftskreislauf/screenshot.png

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"

# Windows-Pfade bauen (Chrome erwartet file:///c:/... nicht /c/...)
HTML_WIN="$(cygpath -w "$HERE/index.html" 2>/dev/null || echo "$HERE/index.html")"
OUT_WIN="$(cygpath -w "$HERE/screenshot.png" 2>/dev/null || echo "$HERE/screenshot.png")"
URL="file:///${HTML_WIN//\\//}"

BROWSERS=(
  "/c/Program Files/Google/Chrome/Application/chrome.exe"
  "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  "/c/Program Files/Microsoft/Edge/Application/msedge.exe"
  "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
)

for BROWSER in "${BROWSERS[@]}"; do
  if [ -f "$BROWSER" ]; then
    "$BROWSER" \
      --headless=new \
      --disable-gpu \
      --hide-scrollbars \
      --default-background-color=00000000 \
      --screenshot="$OUT_WIN" \
      --window-size=1620,1080 \
      "$URL" >/dev/null 2>&1
    if [ -f "$HERE/screenshot.png" ]; then
      echo "→ $HERE/screenshot.png"
      exit 0
    fi
    echo "Browser ran but produced no file" >&2
    exit 1
  fi
done

echo "No Chrome/Edge found" >&2
exit 1
