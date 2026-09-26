# Ambient Frames — generative ambient scenes for Fire TV (Vega OS)

> Amazon **Build, Ship, Shape** hackathon · Fire TV track · deadline 2026-10-23 19:00 UTC (kst 10-24 04:00) · internal freeze 10-21.

Turn the living-room TV into a calm surface: five procedurally generated moods (Deep Space · Rain on the Window · Fireplace · Dawn Aurora · Midnight Ocean), auto-picked by time of day and then by what the household actually watches (on-device pin/skip counting, explained on screen), with a sleep timer and D-pad-only control. Every second of audio and video is produced by the open scripts in `content/` — no stock footage, no licensed music, no ML model.

## Architecture (decided 2026-09-05, after measuring the rules and the Vega APIs)

| Layer | Tech | Where it runs | Why |
|---|---|---|---|
| `content/` | sox (audio synthesis) + ffmpeg (v0 visuals, mux) → **one MP4 per mood** (10–30 min, audio pre-mixed) | S22 for short tests · PC for full renders | Vega `react-native-w3cmedia` has **no `loop`, `volume`, `muted`** → live layer mixing is impossible on device; the mix happens at render time. The shell restarts the file on `ended`. |
| `engine/` | pure TypeScript reducer (day-part → mood, pin/auto, next, sleep timer, **household learning**) + `node --test` | any node | No React/DOM/timers, so it is testable here and drops into the RN shell unchanged. |
| `app/` | **React Native for Vega** + `@amazon-devices/react-native-w3cmedia` `Video` | PC only (Vega SDK, VVD) | Rule: demo must run on a real Fire TV or the Fire TV/Vega simulator. Fire OS has no official emulator; the Vega Virtual Device on Ubuntu has no WebView → RN, not web. |
| video | Windows-side screen capture of the VVD window (WSLg) | PC | VVD has no recorder. |

Dropped on purpose: Web Audio / Canvas web shell (cannot be shown on the only legal simulator) · Lyria BGM (commercial-use policy still undefined — ck `sage_bgm_genre_samples`; the public repo must be OSS-clean).

## Phases

| # | Window (UTC) | Node | Deliverable | Gate |
|---|---|---|---|---|
| 0 | 09-05 | PC | ✅ Vega SDK 0.24.9914 installed · ✅ VVD boots under KVM (after `usermod -aG kvm` + `/dev/kvm` 666 via wsl.conf boot command) · ✅ helloWorld vpkg installed and `VISIBLE` on the VVD (`vlcm list`) | passed 09-05 01:27Z |
| 1 | 09-05 → 09-13 (background to A4H) | S22 | ✅ mood catalog (5) · ✅ `engine/scheduler.ts` 6/6 tests · ✅ `content/render_audio.py` + `render_video.sh` smoke-tested (10 s × 5) · Devpost skeleton · friction log | — |
| 2 | 09-16 → 09-25 (done early 09-05) | PC | ✅ RN app (`app/`): fullscreen `KeplerVideoView`, D-pad (Left/Right = mood, Select = auto, Menu = sleep timer, Play/Pause), engine imported via Metro `watchFolders`, restart-on-`ended`, `/pkg/assets/raw` bundled MP4s | ✅ passed 09-05 02:56Z — plays to EOS + restarts, key injection (`inputd-cli`) switches moods / pauses |
| 3 | 09-05 → 10-05 (started early 09-05) | S22 design · PC renders | ✅ v1 visuals (`gen_layers.py` PNG layers + slow ffmpeg drift, no noise sources) · ✅ loudness match (-20 LUFS, `render_audio.py` + `trim_loudness.sh`) · ✅ `check_render.py` OK ×5 (09-05) · ✅ 10-min 1080p renders on PC (160 MB, vpkg 155 MB, plays/switches/pauses on the VVD) · ⏳ Hun listening/visual check | 5 moods approved |
| 3b | 09-19 (added: judging criteria list "simple video player" as the *obvious* Fire TV idea) | S22 engine · PC build | ✅ adaptive Auto: hand pick held 2 min = pin, Auto pick left < 5 min = skip, one vote per (day, part, mood), 28-day window, re-decide only on day/part change, reason line on screen, ▼▼ forget, AsyncStorage history (no manifest entry), debug-only demo clock (▲ = +1 day). Engine 16/16. Fixed a Phase 2 bug: the minute tick rewound the video to 0 every minute | ✅ VVD 09-19: learn → relaunch (history restored, "Learned · …" line) → forget, 0 rewinds |
| 4 | 10-06 → 10-14 (video done early 09-26) | PC + S22 | ✅ demo video 1:42 English, VVD capture by Sage (https://youtu.be/doJnpA-bKOE, unlisted) · Devpost text · friction log final · app-legal-review | — |
| 5 | 10-15 → 10-21 | — | freeze · public GitHub (MIT) · **Hun submits** | — |

Alexa+ track (IB-0004) runs in parallel with the same deadline; it is a separate project and submission.

## Content budget (decided 2026-09-05, Phase 3)
- **Loop = 10 min, not 30.** The shell restarts on `ended` with a 1.5 s video fade + audio seam, and every drifting layer travels an integer number of tiles per loop, so the restart is invisible. 30 min bought nothing but bytes.
- **Audio = 96 kbps AAC-LC** (noise beds and drones; 160k was 36 MB / 30 min on its own). All moods loudness-matched to **-20 LUFS** integrated (EBU R128 via ffmpeg `ebur128`, gain applied in sox, limiter only when peaks need it).
- **Video = 1080p24, x264 crf 28, GOP 240.** v0 used `noise`/`cellauto` sources: ~10 Mbps *and* per-frame flicker. v1 composes static PNG layers (stars, droplets, embers, curtains, light bands, vignette — `content/gen_layers.py`, deterministic per mood id + seed) over a slow `gradients` base, so nearly every macroblock is a motion copy. Measured full renders (09-05, PC): dawn_aurora 25.6 · deep_space 27.8 · midnight_ocean 33.1 · rain_window 35.2 · fireplace 38.4 MB → **160 MB for five**, x86_64 vpkg 155 MB (installs on the VVD in 4 s). Target ≤ 40 MB/mood, hard limit 50.
- **Photosensitivity**: the only brightness modulation is a sine with period ≥ 7 s; `check_render.py` fails on any frame-to-frame mean-luma swing > 20/255. Measured max on the full renders: 3.2 (fireplace), ≤ 0.94 elsewhere.
- **AAC trim**: 96k AAC shaves ~1 LU off moods with crackle/hiss layers (fireplace landed at -21.2 from a -20.0 wav). `trim_loudness.sh` measures the MP4 and re-muxes the audio from the source wav with the residual gain (≤ 3 passes, video copied); `render_video.sh` runs it automatically. Final: -20.0 ×4, -20.2 (ocean).
- Probing rule: never judge bitrate on a short clip without `LOOP=600` — drift speed is derived from the loop length, so a 20 s clip moves 30× too fast and reports ~2× the real bitrate.

## Commands
```bash
# engine tests (Node ≥ 22.6)
node --experimental-strip-types --test engine/scheduler.test.ts
# one mood, 10-min loop, 1080p (PC); use --seconds 10 / 640x360 for smoke tests
python3 content/render_audio.py content/moods/deep_space.json out/deep_space.wav --seconds 600
bash content/render_video.sh content/moods/deep_space.json out/deep_space.wav out/deep_space.mp4 600 1920x1080
# all five into app/assets/raw/ (default 600 s 1080p), then verify each
bash content/render_all.sh && for f in app/assets/raw/*.mp4; do python3 content/check_render.py "$f"; done
# honest bitrate probe (30 s at the real 10-min drift speed)
LOOP=600 bash content/render_video.sh content/moods/rain_window.json out/rain.wav out/probe.mp4 30 1920x1080
```
Outputs go to `temp/ambient_frames/` (git-ignored: `*.wav`, `*.mp4`).

## Judging fit (Tech · Design · Impact · Idea)
- Tech: Vega-native RN, W3C media element, deterministic content pipeline in the repo, engine with tests.
- Design: 10-foot UI, no pointer, three actions max, text only on demand (overlay fades).
- Impact: replaces "10-hour fireplace" videos with a local app that never buffers and rotates its schedule day to day.
- Idea: the content is generated by code you can read and re-render; every mood is a JSON file. Auto adapts to the household's own remote habits and explains each choice — the rules name "AI-enhanced viewing that adapts to household patterns" as the creative end of the Fire TV track and "simple video player" as the obvious one.

## Compliance (§5.5)
Relaxation/entertainment framing only. Binaural layer = "may help you relax", never sleep therapy or a medical claim. Visuals: slow motion only, no flashes above ~3 Hz (photosensitivity) — a render-time check belongs in Phase 3. "Generative" means procedural code, not an AI model — no model-name disclosure needed unless an LLM enters the stack. No personal data, no network calls.

## 🔗 Related Links
- [[ambient_frames_firetv]] · [[IB-0003_ambient-frames-firetv]] · [[build-ship-shape-amazon-2026]] · [[daily_reflection_alexa]]
- Source pipeline: `Core/Work/Active/echo_odyssey/deep_space_escape/build.sh`
