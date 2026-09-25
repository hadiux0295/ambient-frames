# app/ — React Native for Vega shell (Phase 2 · runs on the VVD since 2026-09-05)

Generated from the Vega `helloWorld` template (`vega project generate -t helloWorld -n AmbientFrames --packageId com.hunailab.ambientframes -o app`), template screens removed, one dependency added: `@amazon-devices/react-native-w3cmedia@2.3.4-rn-83` (RN 0.83 build — the plain `2.3.2` line targets an older RN).

## Layout
- `src/App.tsx` — the whole shell: one `VideoPlayer` + `KeplerVideoView` (scalingmode `fill`), overlay (title · Auto/Sleep/Paused chips · key hint · disclosure) that fades after 3 s, `useTVEventHandler` for the remote.
- `src/moods.ts` — catalog imported straight from `../../content/moods/*.json` (Metro `watchFolders` in `metro.config.js` also exposes `../../engine`, so `engine/scheduler.ts` is imported, not copied).
- `assets/raw/<mood>.mp4` — bundled renders (git-ignored; produce with `bash ../content/render_all.sh [seconds] [size]`). Referenced at runtime as **`/pkg/assets/raw/<mood>.mp4`** — the `/pkg` prefix is the only working form for bundled media (Amazon community answer; `asset://` and `require()` do not).
- `manifest.toml` — media `[wants]` block from `docs/vega/0.24/media-player-setup` added to the template manifest.

## Remote → engine
| Key | Action |
|---|---|
| Left / Right | previous / next mood (pins it, Auto off) |
| Select (OK) | back to Auto + immediate re-evaluation |
| Menu | sleep timer 15 → 30 → 60 → off |
| Play/Pause | pause / resume |

Media `ended` → `tick`: same mood ⇒ `currentTime = 0; play()`; changed ⇒ new `src`, `load()`, `play()`. A 60 s interval also ticks so day-part changes and the sleep timer land within a minute.

## Build · run (PC, `ssh pc`)
```bash
source ~/vega/env
export DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir   # WSLg window for the VVD
cd ambient-frames
bash content/render_all.sh 10 640x360          # smoke assets (full: no args = 10-min loop 1080p, ~1.5 h on 6 cores)
cd app && npm install && npx tsc --noEmit && npx eslint src --ext .ts,.tsx
npx react-native build-vega --build-type Release        # → build/x86_64-release/ambientframes_x86_64.vpkg (+ aarch64, armv7)
export DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir PULSE_SERVER=unix:/mnt/wslg/PulseServer   # over ssh: without these the VVD dies silently ("unresponsive" after 60 s); 09-19 one boot failed without PULSE_SERVER, next succeeded with it (cause not isolated)
vega virtual-device start
vega run-app build/x86_64-release/ambientframes_x86_64.vpkg com.hunailab.ambientframes.main -d VirtualDevice
# if run-app dies with "Cannot read properties of undefined (reading 'trim')" (its uninstall pre-step, seen right after boot):
vega device install-app -d VirtualDevice -p build/x86_64-release/ambientframes_x86_64.vpkg && vega device launch-app -d VirtualDevice -a com.hunailab.ambientframes.main
vega device start-log-stream -d VirtualDevice | grep ambientframes            # W3CMEDIA timeupdate / EOS / "Src URL"
vega device run-cmd -d VirtualDevice -c 'inputd-cli button_press KEY_RIGHT'   # remote injection: KEY_LEFT/RIGHT/UP/DOWN/MENU/PLAYPAUSE/ENTER (OK = KEY_ENTER → focused Pressable onPress; KEY_SELECT produces nothing)
vega virtual-device stop                                                       # always
```
Measured 2026-09-05: build 14.4 MB with five 10 s 640×360 clips; plays to EOS (10.0 s) and restarts at 0; two `KEY_RIGHT` → two `Src URL` loads; `KEY_PLAYPAUSE` → `MediaPlayer: pause`.
Measured 2026-09-05 with the v1 assets (5 × 10 min 1080p, 160 MB): vpkg 155 MB, install 4 s, `playing` → steady `timeupdate`, `KEY_RIGHT` → new `Src URL` + `playing`, `KEY_PLAYPAUSE` → `pause`. `KeplerMediaSink setQueueState Invalid configuration` GST errors appear in both v0 and v1 runs and are harmless.

## Known limits / next
- `loop`: the 2.3.4 JS layer does implement `loop` (calls `play()` on `ended` and swallows the event) although the docs list it as unsupported — we keep our own `ended` handler so the engine still gets its tick.
- No on-device screenshot/recording — demo capture is Windows-side on the VVD window.
- Bundle size: 160 MB of assets for five 10-min moods (see the root README "Content budget"); the public repo git-ignores them — ship via GitHub Release or re-render with `render_all.sh`.

## Adaptive Auto (2026-09-19)
- Dependency added: `@amazon-devices/react-native-async-storage__async-storage@2.1.9000000000-rn-83` (system library, auto-linked from OS metadata — **no `manifest.toml` entry**). History key `af.history.v1`, see `src/storage.ts`.
- `metro.config.js` `resolver.nodeModulesPaths` = `app/node_modules`: Debug builds inject `@babel/runtime` helpers into `../engine/*.ts`, which otherwise cannot resolve.
- **Debug builds = demo clock**: starts at 19:30 today, ▲ jumps a day, chip "Demo clock · Sat 19:30" on the overlay. Release builds use the real clock and ignore ▲. Demo path: ▶ (skip the Auto pick, hand-pick the next mood) → ▲ ▲ ▲ (three evenings; a mood left pinned into a new day part earns a fresh pin each time) → OK (Auto plays it: "Learned · you chose Dawn Aurora on 3 of your last 3 evenings") · ▼▼ forget. Do not relaunch on camera: the demo clock restarts at day 1, so later-day pins count as future and the line drops to "1 of 1".
- Every key and state change logs one `[AmbientFrames]` line (`start-log-stream | grep AmbientFrames`). JS lines logged in the first second after launch can be missing from the stream, so the key line carries the current state.
- Measured on the VVD 09-19 (logs PC `temp/ambient_frames/af_log_adaptive3.log`, scenario `app/scripts/vvd_adaptive_scenario.sh` (VVD already running, Debug vpkg built)): learn → relaunch → state restored (`history=2`, learned reason) → ▼▼ → `history=0`, "Evening schedule"; 0 rewinds. Re-run after the pinned-across-days fix: ▶ ▲▲▲ OK → "3 of your last 3 evenings" (history 4), 0 rewinds.
