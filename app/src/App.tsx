/**
 * Ambient Frames — Fire TV (Vega OS) shell.
 * One fullscreen w3cmedia VideoPlayer, one pre-rendered MP4 per mood, engine decides what plays.
 * D-pad: Left/Right = previous/next mood · Select = back to Auto · Menu = sleep timer cycle · Play/Pause
 * · Down twice = forget what Auto learned · Up (debug builds only) = demo clock +1 day.
 * Auto learns from the household's own picks (engine/scheduler.ts); the history stays on this TV.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {KeplerVideoView, VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

import {
  initialState,
  reduce,
  sleepRemainingMin,
  type Action,
  type PlayerState,
} from '../../engine/scheduler';
import {ACCENT, MOODS, moodUri} from './moods';
import {loadHistory, saveHistory} from './storage';

const TICK_MS = 60_000;
const OVERLAY_MS = 3_000;
const SLEEP_CYCLE: Array<number | null> = [15, 30, 60, null];
const FORGET_CONFIRM_MS = 3_000;
const DAY_MS = 86_400_000;
/** Debug builds run a demo clock: it starts at 19:30 today and Up jumps it a day ahead, so a
 * 3-minute video can show several evenings of learning. Release builds use the real clock. */
const DEMO_CLOCK = __DEV__;

function demoStartOffset(): number {
  if (!DEMO_CLOCK) {
    return 0;
  }
  const t = new Date();
  t.setHours(19, 30, 0, 0);
  return t.getTime() - Date.now();
}

export const App = () => {
  const player = useRef<VideoPlayer | null>(null);
  const offset = useRef(demoStartOffset());
  const clock = useCallback(() => Date.now() + offset.current, []);
  const stateRef = useRef<PlayerState>(initialState(MOODS, clock()));
  const [state, setState] = useState<PlayerState>(stateRef.current);
  const [ready, setReady] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [now, setNow] = useState(clock());
  const [forgetArmed, setForgetArmed] = useState(false);
  const forgetUntil = useRef(0);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedId = useRef<string | null>(null);

  const showOverlay = useCallback(() => {
    setOverlay(true);
    if (overlayTimer.current) {
      clearTimeout(overlayTimer.current);
    }
    overlayTimer.current = setTimeout(() => setOverlay(false), OVERLAY_MS);
  }, []);

  /** Apply the reducer and push the result into the player. */
  const dispatch = useCallback((action: Action) => {
    const prev = stateRef.current;
    const next = reduce(prev, action, MOODS);
    stateRef.current = next;
    setState(next);
    setNow(clock());
    if (next.history !== prev.history) {
      saveHistory(next.history);
    }
    if (next.moodId !== prev.moodId || next.auto !== prev.auto || next.history !== prev.history) {
      console.info(
        `[AmbientFrames] ${action.type} → ${next.moodId} ${next.auto ? 'auto' : 'pinned'} ` +
          `history=${next.history.length} reason="${next.reason}"`,
      );
    }
    const p = player.current;
    if (!p) {
      return;
    }
    if (next.moodId !== loadedId.current) {
      loadedId.current = next.moodId;
      p.src = moodUri(next.moodId);
      p.load();
      if (!next.paused) {
        p.play();
      }
      return;
    }
    if (next.paused && !prev.paused) {
      p.pause();
    } else if (!next.paused && prev.paused) {
      p.play();
    }
  }, [clock]);

  useEffect(() => {
    const p = new VideoPlayer();
    player.current = p;
    let alive = true;
    Promise.all([p.initialize(), loadHistory()])
      .then(([, history]) => {
        if (!alive) {
          return;
        }
        // Start from what this TV has learned before the first frame plays.
        stateRef.current = initialState(MOODS, clock(), history);
        setState(stateRef.current);
        console.info(
          `[AmbientFrames] start → ${stateRef.current.moodId} history=${history.length} reason="${stateRef.current.reason}"`,
        );
        p.autoplay = false;
        // No `loop` on this element: restart the same file on `ended`, then let the engine decide
        // (a changed mood loads its own file). Only `ended` rewinds — the minute tick never does.
        p.addEventListener('ended', () => {
          if (!stateRef.current.paused) {
            p.currentTime = 0;
            p.play();
          }
          dispatch({type: 'tick', now: clock()});
        });
        p.addEventListener('error', () =>
          console.error('[AmbientFrames] media error', p.error?.code, p.error?.message),
        );
        setReady(true);
        loadedId.current = stateRef.current.moodId;
        p.src = moodUri(stateRef.current.moodId);
        p.load();
        p.play();
      })
      .catch((e: unknown) => console.error('[AmbientFrames] initialize failed', e));
    const timer = setInterval(() => dispatch({type: 'tick', now: clock()}), TICK_MS);
    showOverlay();
    return () => {
      alive = false;
      clearInterval(timer);
      if (overlayTimer.current) {
        clearTimeout(overlayTimer.current);
      }
      p.deinitialize().catch(() => undefined);
      player.current = null;
    };
  }, [dispatch, showOverlay, clock]);

  const cycleSleep = useCallback(() => {
    const s = stateRef.current;
    const cur = s.sleepEndsAt === null ? null : sleepRemainingMin(s, clock());
    // pick the next step above the current remaining minutes (15 → 30 → 60 → off → 15 …)
    const idx = cur === null ? -1 : SLEEP_CYCLE.findIndex((m) => m !== null && m >= cur);
    const nextMin = SLEEP_CYCLE[(idx + 1) % SLEEP_CYCLE.length];
    dispatch({type: 'sleep', minutes: nextMin, now: clock()});
  }, [dispatch, clock]);

  const prevMood = useCallback(() => {
    const i = MOODS.findIndex((m) => m.id === stateRef.current.moodId);
    dispatch({type: 'pick', moodId: MOODS[(i - 1 + MOODS.length) % MOODS.length].id, now: clock()});
  }, [dispatch, clock]);

  /** OK = back to Auto. The focused Pressable consumes Select before useTVEventHandler sees it on
   * the VVD, so both paths call this; a second call in a row is a no-op for the reducer. */
  const backToAuto = useCallback(() => {
    dispatch({type: 'auto', now: clock()});
    showOverlay();
  }, [dispatch, clock, showOverlay]);

  /** Down once arms, Down again within FORGET_CONFIRM_MS clears the learned history. */
  const forgetPress = useCallback(() => {
    const t = Date.now();
    if (t < forgetUntil.current) {
      forgetUntil.current = 0;
      setForgetArmed(false);
      dispatch({type: 'forget', now: clock()});
      return;
    }
    forgetUntil.current = t + FORGET_CONFIRM_MS;
    setForgetArmed(true);
    setTimeout(() => setForgetArmed(false), FORGET_CONFIRM_MS);
  }, [dispatch, clock]);

  /** Debug builds: move the demo clock one day ahead, then let the engine react as a tick would. */
  const demoNextDay = useCallback(() => {
    if (!DEMO_CLOCK) {
      return;
    }
    offset.current += DAY_MS;
    dispatch({type: 'tick', now: clock()});
  }, [dispatch, clock]);

  useTVEventHandler((evt: HWEvent) => {
    const cur = stateRef.current;
    console.info(
      `[AmbientFrames] key ${evt.eventType}/${evt.eventKeyAction} on ${cur.moodId} ${cur.auto ? 'auto' : 'pinned'} ` +
        `history=${cur.history.length} reason="${cur.reason}"`,
    );
    if (evt.eventKeyAction === 1) {
      return; // act on key down only
    }
    switch (evt.eventType) {
      case 'right':
        dispatch({type: 'next', now: clock()});
        break;
      case 'left':
        prevMood();
        break;
      case 'select':
        backToAuto();
        return;
      case 'menu':
        cycleSleep();
        break;
      case 'playpause':
        dispatch({type: stateRef.current.paused ? 'resume' : 'pause'});
        break;
      case 'down':
        forgetPress();
        break;
      case 'up':
        demoNextDay();
        break;
      default:
        return;
    }
    showOverlay();
  });

  const mood = MOODS.find((m) => m.id === state.moodId) ?? MOODS[0];
  const sleepMin = sleepRemainingMin(state, now);
  const accent = ACCENT[mood.id] ?? '#ffffff';

  return (
    <View style={styles.root}>
      {player.current && ready && (
        <KeplerVideoView videoPlayer={player.current} style={styles.video} scalingmode="fill" />
      )}
      {/* Invisible focus anchor so the remote always has a target. */}
      <Pressable hasTVPreferredFocus style={styles.focusAnchor} onPress={backToAuto} />
      {overlay && (
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.titleRow}>
            <View style={[styles.dot, {backgroundColor: accent}]} />
            <Text style={styles.title}>{mood.title}</Text>
            {state.auto && <Text style={styles.chip}>Auto</Text>}
            {sleepMin !== null && <Text style={styles.chip}>Sleep {sleepMin} min</Text>}
            {state.paused && <Text style={styles.chip}>Paused</Text>}
            {DEMO_CLOCK && <Text style={styles.chip}>Demo clock · {demoLabel(now)}</Text>}
          </View>
          {state.auto && state.reason !== '' && <Text style={styles.reason}>{state.reason}</Text>}
          <Text style={styles.hint}>
            {forgetArmed
              ? 'Press ▼ again to forget what Auto has learned'
              : `◀ ▶ mood · OK auto · ☰ sleep timer · ⏯ pause · ▼▼ forget${DEMO_CLOCK ? ' · ▲ next day' : ''}`}
          </Text>
          <Text style={styles.disclosure}>
            Procedurally generated scenes — for relaxation and ambience only, not a sleep aid or medical device. Auto
            learns from your picks on this TV only; nothing leaves the device.
          </Text>
        </View>
      )}
    </View>
  );
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function demoLabel(t: number): string {
  const d = new Date(t);
  return `${WEEKDAY[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000000'},
  video: {...StyleSheet.absoluteFillObject},
  focusAnchor: {position: 'absolute', width: 1, height: 1, opacity: 0},
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 72,
    paddingTop: 48,
    paddingBottom: 56,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: 20},
  dot: {width: 18, height: 18, borderRadius: 9},
  title: {color: '#ffffff', fontSize: 52, fontWeight: '600'},
  chip: {
    color: '#ffffff',
    fontSize: 22,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    overflow: 'hidden',
  },
  reason: {color: 'rgba(255,255,255,0.92)', fontSize: 26, marginTop: 14},
  hint: {color: 'rgba(255,255,255,0.85)', fontSize: 24, marginTop: 16},
  disclosure: {color: 'rgba(255,255,255,0.6)', fontSize: 18, marginTop: 10},
});
