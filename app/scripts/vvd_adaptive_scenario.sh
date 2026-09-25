#!/usr/bin/env bash
# Adaptive Auto scenario on the VVD: learn → relaunch (persistence) → forget.
source ~/vega/env
export DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir
L=~/Hun_Sunsu_Dream_F/temp/ambient_frames/af_log_adaptive3.log
APP=com.hunailab.ambientframes.main
key() { timeout 20 vega device run-cmd -d VirtualDevice -c "inputd-cli button_press $1" >/dev/null 2>&1; echo "KEY $1 $(date -u +%T)"; sleep "${2:-4}"; }
cd ~/Hun_Sunsu_Dream_F/Core/Work/Active/ambient_frames/app

(timeout 600 vega device start-log-stream -d VirtualDevice > $L 2>&1 &)
sleep 2
timeout 120 vega device install-app -d VirtualDevice -p build/x86_64-debug/ambientframes_x86_64.vpkg 2>&1 | tail -1
timeout 30 vega device launch-app -d VirtualDevice -a $APP >/dev/null 2>&1; echo "LAUNCH1 $(date -u +%T)"; sleep 15
key KEY_RIGHT      # leave the Auto pick at once → skip; hand pick = next mood
key KEY_UP 6       # demo clock +1 day → the hand pick has been held > 2 min → pin (day 1)
key KEY_UP 6       # still pinned into a new evening → pin (day 2)
key KEY_UP 6       # → pin (day 3)
key KEY_ENTER 6    # OK = KEY_ENTER on the VVD → back to Auto on day 2 → should choose the learned mood
timeout 20 vega device terminate-app -d VirtualDevice -a $APP >/dev/null 2>&1 || timeout 20 vega device run-cmd -d VirtualDevice -c "vlcm terminate-app --pkg-id com.hunailab.ambientframes" >/dev/null 2>&1
sleep 5
timeout 30 vega device launch-app -d VirtualDevice -a $APP >/dev/null 2>&1; echo "LAUNCH2 $(date -u +%T)"; sleep 15
key KEY_DOWN 1
key KEY_DOWN 6     # forget
sleep 2
grep -o "\[AmbientFrames\].*" $L | sed 's/", *$/"/'
echo "rewinds(0.000)=$(grep -c 'TIME_UPDATE: 0.000000' $L) ended=$(grep -c -i 'EOS\|ended' $L)"
