#!/usr/bin/env bash
# Render every mood into the app's bundled raw assets (app/assets/raw/<id>.mp4).
# Usage: render_all.sh [seconds=1800] [size=1920x1080] [outdir=app/assets/raw]
# Smoke test: render_all.sh 10 640x360 — full: render_all.sh (10-min loop, 1080p; PC). Then check_render.py on each.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SEC="${1:-600}"; SIZE="${2:-1920x1080}"; OUT="${3:-$HERE/../app/assets/raw}"
TMP="${TMPDIR:-/tmp}/ambient_frames_render"
mkdir -p "$OUT" "$TMP"
for MOOD in "$HERE"/moods/*.json; do
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$MOOD")
  python3 "$HERE/render_audio.py" "$MOOD" "$TMP/$ID.wav" --seconds "$SEC"
  bash "$HERE/render_video.sh" "$MOOD" "$TMP/$ID.wav" "$OUT/$ID.mp4" "$SEC" "$SIZE"
done
ls -la "$OUT"
