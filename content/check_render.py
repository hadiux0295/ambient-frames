#!/usr/bin/env python3
"""Verify one rendered mood: size budget, flash risk, loudness. Exit 1 on any FAIL.

Usage: check_render.py <mood.mp4> [--budget-mb 40] [--flash-delta 20] [--lufs -20 --tol 1.0]

Flash check = per-frame mean luma (ffmpeg signalstats YAVG); a "flash" is a luma swing
larger than --flash-delta (0-255) between consecutive frames. Any such event within a
1 s window counts; more than 3 in any second (>3 Hz) is the WCAG/Ofcom line — we FAIL
on the first event at all, because slow-motion ambient content should have none.
"""
import argparse, json, re, subprocess, sys, os

def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

def yavg_series(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-i", path, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
                        "-an", "-f", "null", "-"], capture_output=True, text=True)
    return [float(v) for v in re.findall(r"YAVG=([\d.]+)", r.stdout)]

def lufs(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-i", path, "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"I:\s+(-?[\d.]+) LUFS", r.stderr); return float(m.group(1)) if m else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4"); ap.add_argument("--budget-mb", type=float, default=40)
    ap.add_argument("--flash-delta", type=float, default=20); ap.add_argument("--lufs", type=float, default=-20)
    ap.add_argument("--tol", type=float, default=1.0); ap.add_argument("--loop-sec", type=float, default=600)
    a = ap.parse_args()
    p = probe(a.mp4); fmt = p["format"]; dur = float(fmt["duration"]); size = int(fmt["size"])
    v = next(s for s in p["streams"] if s["codec_type"] == "video")
    kbps = size * 8 / dur / 1000; proj = size / dur * a.loop_sec / 1e6
    ok = True
    print(f"{os.path.basename(a.mp4)}: {v['width']}x{v['height']} {dur:.1f}s {size/1e6:.2f} MB  {kbps:.0f} kbps total"
          f"  → projected {proj:.1f} MB per {a.loop_sec:.0f}s loop (budget {a.budget_mb} MB) "
          + ("OK" if proj <= a.budget_mb else "FAIL")); ok &= proj <= a.budget_mb
    ys = yavg_series(a.mp4)
    deltas = [abs(b - c) for b, c in zip(ys, ys[1:])]
    flashes = sum(1 for d in deltas if d > a.flash_delta)
    print(f"  luma: mean {sum(ys)/len(ys):.1f}, max frame-to-frame delta {max(deltas):.2f} (limit {a.flash_delta}), "
          f"flash events {flashes} " + ("OK" if flashes == 0 else "FAIL")); ok &= flashes == 0
    L = lufs(a.mp4)
    if L is None: print("  loudness: no audio stream FAIL"); ok = False
    else:
        good = abs(L - a.lufs) <= a.tol
        print(f"  loudness: {L:.1f} LUFS (target {a.lufs} ±{a.tol}) " + ("OK" if good else "FAIL")); ok &= good
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
