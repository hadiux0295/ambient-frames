#!/usr/bin/env bash
# Post-encode loudness trim: AAC at 96k drops some high-frequency energy (crackle/hiss layers),
# so a wav matched to the target can land ~1 LU low in the MP4. Measure the encoded file and, while
# it is off by more than tol, re-mux the audio FROM THE SOURCE WAV (no AAC generation loss) with a
# cumulative gain; video stream is copied. Up to 3 passes (the AAC response is slightly non-linear).
# Usage: trim_loudness.sh <mp4> <source.wav> [target=-20] [tol=0.3] [abr=96]
set -euo pipefail
F="$1"; WAV="$2"; T="${3:--20}"; TOL="${4:-0.3}"; ABR="${5:-96}"
lufs() { ffmpeg -nostats -i "$1" -vn -af ebur128=framelog=quiet -f null - 2>&1 | grep -oP 'I:\s+\K-?[\d.]+(?= LUFS)' | tail -1; }
L0=$(lufs "$F"); L=$L0; G=0
for pass in 1 2 3; do
  python3 -c "import sys;sys.exit(0 if abs($T-($L))>$TOL else 1)" || break
  G=$(python3 -c "print(round($G+($T-($L)),2))")
  TMP="${F%.mp4}.trim.mp4"
  ffmpeg -y -loglevel error -i "$F" -i "$WAV" -map 0:v -map 1:a -c:v copy -af "volume=${G}dB" \
    -c:a aac -b:a "${ABR}k" -movflags +faststart -shortest "$TMP"
  mv "$TMP" "$F"; L=$(lufs "$F")
done
echo "[trim_loudness] $(basename "$F"): $L0 → $L LUFS (gain ${G} dB, target $T ±$TOL)"
