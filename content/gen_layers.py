#!/usr/bin/env python3
"""Generate the static PNG layers one mood's v1 visual is composed from (numpy + PIL).

Usage: gen_layers.py <mood.json> <outdir> [--size 1920x1080] [--seed 7]

Every layer is an RGBA image that ffmpeg (`render_video.sh`) drifts across a slow
`gradients` base. Layers are *tiled* (2x width or 2x height) so a drift of exactly
one tile per loop is seamless. Deterministic per (mood id, seed) - re-rendering
gives byte-identical layers, which is the "generative but reproducible" story.
Nothing here flickers: motion is only what ffmpeg adds, and that is slow by design.
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

def hex_rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def blank(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))

def dots(w, h, n, rng, rmin, rmax, color, alpha=(120, 255), blur=0.0, elongate=1.0):
    """Sparse soft dots (stars / embers / droplets). elongate>1 stretches vertically."""
    img = blank(w, h); d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(rmin, rmax); a = int(rng.uniform(*alpha))
        d.ellipse([x - r, y - r * elongate, x + r, y + r * elongate], fill=(*color, a))
    return img.filter(ImageFilter.GaussianBlur(blur)) if blur else img

def bands(w, h, n, rng, color, alpha, thickness, blur, vertical=False):
    """Soft light bands (aurora curtains / light on water). Tiled along the drift axis."""
    img = blank(w, h); d = ImageDraw.Draw(img)
    span = w if vertical else h
    for _ in range(n):
        p = rng.uniform(0, span); t = rng.uniform(*thickness); a = int(rng.uniform(*alpha))
        box = [p, 0, p + t, h] if vertical else [0, p, w, p + t]
        d.rectangle(box, fill=(*color, a))
    return img.filter(ImageFilter.GaussianBlur(blur))

def hearth(w, h, color, strength=0.9):
    """Warm radial glow anchored just below the bottom edge (a fire you don't see directly)."""
    y, x = np.mgrid[0:h, 0:w]
    nx, ny = (x - w / 2) / (w * 0.55), (y - h * 1.08) / (h * 0.75)
    r = np.sqrt(nx * nx + ny * ny)
    a = np.clip(1 - r, 0, 1) ** 1.8 * 255 * strength
    img = np.zeros((h, w, 4), np.uint8); img[..., :3] = color; img[..., 3] = a.astype(np.uint8)
    return Image.fromarray(img, "RGBA")

def vignette(w, h, strength=0.55):
    """Dark edges so the layers read as a scene, not a wallpaper. Static → free to encode."""
    y, x = np.mgrid[0:h, 0:w]
    nx, ny = (x - w / 2) / (w / 2), (y - h / 2) / (h / 2)
    r = np.sqrt(nx * nx + ny * ny)
    a = np.clip((r - 0.45) / 0.9, 0, 1) ** 1.6 * 255 * strength
    img = np.zeros((h, w, 4), np.uint8); img[..., 3] = a.astype(np.uint8)
    return Image.fromarray(img, "RGBA")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mood"); ap.add_argument("outdir")
    ap.add_argument("--size", default="1920x1080"); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    w, h = map(int, a.size.split("x"))
    mood = json.load(open(a.mood)); kind = mood["visual"]["kind"]
    dens = float(mood["visual"].get("density", 0.5)); c0, c1, c2 = [hex_rgb(c) for c in mood["palette"]]
    rng = np.random.default_rng(a.seed + sum(map(ord, mood["id"])))
    os.makedirs(a.outdir, exist_ok=True)
    area = w * h / (1920 * 1080)  # keep counts proportional at smoke sizes
    sc = area ** 0.5              # ... and blob radii / blur
    out = {}
    if kind == "starfield":
        out["far"]  = dots(w * 2, h, int(900 * dens * area), rng, 0.6, 1.3, (220, 228, 255), (60, 160))
        out["near"] = dots(w * 2, h, int(140 * dens * area), rng, 1.2, 2.6, c2, (140, 255), blur=0.6)
    elif kind == "rain":
        out["bokeh"] = dots(w, h, int(26 * area) + 4, rng, 40 * sc, 130 * sc, c2, (18, 55), blur=28 * sc)
        out["drops"] = dots(w, h * 2, int(260 * dens * area), rng, 1.0, 2.2, (235, 245, 255), (60, 150), blur=0.8, elongate=3.5)
        out["sheet"] = dots(w, h * 2, int(600 * dens * area), rng, 0.5, 1.0, (200, 215, 230), (25, 70), blur=1.2, elongate=6)
    elif kind == "embers":
        out["glow"]   = Image.alpha_composite(hearth(w, h, c1), hearth(w, h, c2, strength=0.35).resize((w, h)))
        out["embers"] = dots(w, h * 2, int(360 * dens * area), rng, 1.0, 2.6, c2, (120, 230), blur=0.7)
        out["sparks"] = dots(w, h * 2, int(120 * dens * area), rng, 0.6, 1.3, (255, 230, 190), (150, 255))
    elif kind == "aurora":
        out["curtain"] = bands(w * 2, h, int(28 * dens) + 6, rng, c2, (10, 30), (30 * sc, 160 * sc), 70 * sc, vertical=True)
        out["veil"]    = bands(w * 2, h, int(10 * dens) + 3, rng, c1, (20, 50), (120 * sc, 420 * sc), 120 * sc, vertical=True)
        out["stars"]   = dots(w * 2, h, int(400 * area), rng, 0.6, 1.4, (220, 230, 255), (50, 140))
    elif kind == "waves":
        out["light"] = bands(w, h * 2, int(30 * dens) + 8, rng, c2, (10, 34), (12 * sc, 70 * sc), 22 * sc)
        out["foam"]  = dots(w, h * 2, int(120 * dens * area), rng, 20 * sc, 90 * sc, (255, 255, 255), (6, 16), blur=30 * sc, elongate=0.25)
    else:
        raise SystemExit(f"unknown visual kind {kind}")
    out["vignette"] = vignette(w, h)
    for name, img in out.items():
        img.save(os.path.join(a.outdir, f"{name}.png"), optimize=True)
    print(f"[gen_layers] {mood['id']} ({kind}) -> {a.outdir}: {', '.join(out)}")

if __name__ == "__main__":
    main()
