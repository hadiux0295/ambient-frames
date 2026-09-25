#!/usr/bin/env python3
"""Render one mood's pre-mixed ambient audio from its JSON layer spec (sox only).

Usage: render_audio.py <mood.json> <out.wav> [--seconds 1800] [--seam 0.5]

Every layer = `sox -n synth <dur> <synth...> <effects...> gain <db>`; layers are
summed with `sox -m`, loudness-matched to --lufs (EBU R128 integrated, measured with
ffmpeg's ebur128, limiter on the gain stage) and given a short equal fade at both
ends so a player that restarts the file on `ended` (Vega w3cmedia has no `loop`)
crosses the seam without a click. Deterministic given the JSON — this is the
"generative" pipeline the public repo ships. No third-party audio, no ML models.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"[render_audio] failed: {' '.join(cmd)}\n{r.stderr}")

def lufs(path):
    """EBU R128 integrated loudness via ffmpeg ebur128 (no sox equivalent)."""
    r = subprocess.run(["ffmpeg", "-nostats", "-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
    if not m:
        sys.exit(f"[render_audio] ebur128 measurement failed for {path}\n{r.stderr[-800:]}")
    return float(m.group(1))

def peak_db(path):
    r = subprocess.run(["sox", path, "-n", "stats"], capture_output=True, text=True)
    m = re.search(r"Pk lev dB\s+(-?[\d.]+)", r.stderr); return float(m.group(1)) if m else 0.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mood"); ap.add_argument("out")
    ap.add_argument("--seconds", type=float, default=1800)
    ap.add_argument("--seam", type=float, default=0.5, help="fade in/out length at the file edges")
    ap.add_argument("--rate", type=int, default=44100)
    ap.add_argument("--lufs", type=float, default=-20.0, help="target integrated loudness (all moods match)")
    a = ap.parse_args()
    if not shutil.which("sox"):
        sys.exit("[render_audio] sox not found")
    mood = json.load(open(a.mood))
    layers = mood["audio"]["layers"]
    tmp = tempfile.mkdtemp(prefix="af_")
    parts = []
    for i, L in enumerate(layers):
        p = os.path.join(tmp, f"{i}_{L['name']}.wav")
        cmd = ["sox", "-n", "-r", str(a.rate), "-c", "2", p, "synth", str(a.seconds)] + L["synth"].split()
        if L.get("effects"):
            cmd += L["effects"].split()
        cmd += ["gain", str(L["gain_db"])]
        run(cmd); parts.append(p)
    mixed = os.path.join(tmp, "mix.wav")
    run(["sox", "-m", *parts, mixed])
    measured = lufs(mixed); gain = a.lufs - measured
    # plain gain when the peak allows (limiter would pull loudness down); limiter only as a clip guard
    limit = ["-l"] if peak_db(mixed) + gain > -1.0 else []
    staged = os.path.join(tmp, "staged.wav")
    run(["sox", mixed, staged, "gain", *limit, f"{gain:.2f}"])
    resid = a.lufs - lufs(staged)  # residual after limiter / rounding (usually < 0.3 LU)
    run(["sox", staged, a.out, "gain", *limit, f"{resid:.2f}", "fade", "t", str(a.seam), str(a.seconds), str(a.seam)])
    final = lufs(a.out)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"[render_audio] {mood['id']} -> {a.out} ({a.seconds:.0f}s, {len(layers)} layers, "
          f"mix {measured:.1f} LUFS → {final:.1f} LUFS, target {a.lufs})")

if __name__ == "__main__":
    main()
