#!/usr/bin/env bash
# v1 procedural visual + audio mux for one mood (ffmpeg only, layers from gen_layers.py).
# Usage: render_video.sh <mood.json> <audio.wav> <out.mp4> [seconds=600] [size=1920x1080]
# Env: PRESET (x264 preset, default medium) · CRF (default 28) · ABR (audio kbps, default 96) · FPS (24)
#      LOOP (motion period in s, default = seconds) — set LOOP=600 on a short probe so drift speed,
#      and therefore the measured bitrate, matches the real loop (probes at 20 s otherwise run 30× too fast)
#
# Design rules (size + photosensitivity, decided 2026-09-05):
#  - base = slow `gradients`, static PNG layers drift over it → almost every macroblock is a
#    motion-vector copy, so 1080p stays in the low-hundreds-kbps range (v0 noise sources were
#    incompressible: ~10 Mbps AND per-frame flicker).
#  - every drift moves an integer number of tiles per loop, so a restart on `ended` is seamless
#    for the layers; the aperiodic base is masked with a 1.5 s fade at both edges (audio does the same).
#  - the only brightness modulation is a sine with period ≥ 7 s (no flashes > 3 Hz by construction;
#    `check_render.py` verifies on the encoded file).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MOOD="$1"; AUDIO="$2"; OUT="$3"; SEC="${4:-600}"; SIZE="${5:-1920x1080}"
PRESET="${PRESET:-medium}"; CRF="${CRF:-28}"; ABR="${ABR:-96}"; FPS="${FPS:-24}"; LOOP="${LOOP:-$SEC}"
W=${SIZE%x*}; H=${SIZE#*x}
J() { python3 -c "import json,sys;m=json.load(open(sys.argv[1]));print(eval(sys.argv[2]))" "$MOOD" "$1"; }
ID=$(J "m['id']"); KIND=$(J "m['visual']['kind']")
read -r C0 C1 C2 <<<"$(J "' '.join(m['palette'])")"
c() { echo "0x${1#\#}"; }
LAY="${LAYERS:-${TMPDIR:-/tmp}/ambient_frames_render/layers/$ID}"
python3 "$HERE/gen_layers.py" "$MOOD" "$LAY" --size "$SIZE" >/dev/null
L() { echo "-loop 1 -framerate $FPS -i $LAY/$1.png"; }
FADE="fade=t=in:st=0:d=1.5,fade=t=out:st=$(python3 -c "print($SEC-1.5)"):d=1.5"
# px/s so that a layer travels exactly k tiles per loop (seamless restart)
vx() { python3 -c "print($W*$1/$LOOP)"; }; vy() { python3 -c "print($H*$1/$LOOP)"; }
case "$KIND" in
  starfield)
    IN="$(L far) $(L near) $(L vignette)"
    FC="gradients=s=$SIZE:r=$FPS:c0=$(c $C0):c1=$(c $C1):c2=$(c $C0):speed=0.004:nb_colors=3[b];
        [b][0]overlay=x='-mod(t*$(vx 1),$W)':y=0:format=auto[s1];
        [s1][1]overlay=x='-mod(t*$(vx 2),$W)':y=0:format=auto[s2];
        [s2][2]overlay=format=auto,$FADE[v]" ;;
  rain)
    IN="$(L bokeh) $(L sheet) $(L drops) $(L vignette)"
    FC="gradients=s=$SIZE:r=$FPS:c0=$(c $C0):c1=$(c $C1):c2=$(c $C0):speed=0.006:nb_colors=3[b];
        [b][0]overlay=0:0:format=auto[s1];
        [s1][1]overlay=x=0:y='-$H+mod(t*$(vy 2),$H)':format=auto[s2];
        [s2][2]overlay=x=0:y='-$H+mod(t*$(vy 4),$H)':format=auto[s3];
        [s3][3]overlay=format=auto,$FADE[v]" ;;
  embers)
    IN="$(L glow) $(L embers) $(L sparks) $(L vignette)"
    FC="gradients=s=$SIZE:r=$FPS:c0=$(c $C0):c1=0x2a0f06:c2=$(c $C0):speed=0.01:nb_colors=3[b];
        [b][0]overlay=0:0:format=auto,eq=brightness='0.04*sin(2*PI*t/9)+0.03*sin(2*PI*t/23)':eval=frame[g];
        [g][1]overlay=x='6*sin(2*PI*t/11)':y='-mod(t*$(vy 4),$H)':format=auto[s2];
        [s2][2]overlay=x='10*sin(2*PI*t/7)':y='-mod(t*$(vy 8),$H)':format=auto[s3];
        [s3][3]overlay=format=auto,$FADE[v]" ;;
  aurora)
    IN="$(L stars) $(L veil) $(L curtain) $(L vignette)"
    FC="gradients=s=$SIZE:r=$FPS:c0=$(c $C0):c1=$(c $C1):c2=$(c $C0):speed=0.005:nb_colors=3[b];
        [b][0]overlay=x='-mod(t*$(vx 1),$W)':y=0:format=auto[s1];
        [s1][1]overlay=x='-mod(t*$(vx 2),$W)':y='20*sin(2*PI*t/29)':format=auto[s2];
        [s2][2]overlay=x='-mod(t*$(vx 3),$W)':y='12*sin(2*PI*t/17)':format=auto[s3];
        [s3][3]overlay=format=auto,$FADE[v]" ;;
  waves)
    IN="$(L light) $(L foam) $(L vignette)"
    FC="gradients=s=$SIZE:r=$FPS:c0=$(c $C0):c1=$(c $C1):c2=$(c $C0):speed=0.006:nb_colors=3[b];
        [b][0]overlay=x='8*sin(2*PI*t/13)':y='-$H+mod(t*$(vy 2),$H)':format=auto[s1];
        [s1][1]overlay=x='-14*sin(2*PI*t/19)':y='-$H+mod(t*$(vy 3),$H)':format=auto[s2];
        [s2][2]overlay=format=auto,$FADE[v]" ;;
  *) echo "unknown visual kind $KIND" >&2; exit 1 ;;
esac
# shellcheck disable=SC2086
NIN=$(echo "$IN" | grep -o -- '-i ' | wc -l)   # audio = input index NIN
ffmpeg -y -loglevel error $IN -i "$AUDIO" \
  -filter_complex "$(echo "$FC" | tr -d '\n')" \
  -map "[v]" -map "$NIN:a" -t "$SEC" \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p -g 240 -keyint_min 48 -bf 3 \
  -c:a aac -b:a "${ABR}k" -movflags +faststart -shortest "$OUT"
echo "[render_video] $ID/$KIND -> $OUT (${SEC}s $SIZE crf$CRF $PRESET, audio ${ABR}k)"
bash "$HERE/trim_loudness.sh" "$OUT" "$AUDIO" -20 0.3 "$ABR"   # AAC can shave ~1 LU off noisy layers
