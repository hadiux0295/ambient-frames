/**
 * Ambient Frames — platform-agnostic scheduling core.
 * No React, no DOM, no timers: the app shell (React Native for Vega) feeds it
 * the clock and consumes plain state. Testable with `node --test` alone.
 */

export type MoodId = string;

export interface MoodMeta {
  id: MoodId;
  title: string;
  tags: string[]; // e.g. "morning" | "day" | "evening" | "night" | "sleep" | "focus" | "cozy" | "calm"
}

export type DayPart = "morning" | "day" | "evening" | "night";

/** KST/local hour → day part. Boundaries chosen for a living-room TV, not a desk. */
export function dayPart(hour: number): DayPart {
  if (hour < 0 || hour > 23 || !Number.isInteger(hour)) throw new RangeError(`hour ${hour}`);
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

// ── Household learning ────────────────────────────────────────────────────────────
// Count-based, on-device, no ML: the household's own remote presses are the only input.
//   pin  = a mood the user chose by hand and kept on screen for PIN_MS
//   skip = an Auto pick the user switched away from within SKIP_MS
// Each (mood, day part, calendar day) counts once, so pressing Left/Right ten times
// in one evening is one vote, and only the last LEARN_DAYS days are read.

export type Signal = "pin" | "skip";

export interface HistoryEvent {
  day: string; // local calendar day "YYYY-MM-DD"
  part: DayPart;
  moodId: MoodId;
  kind: Signal;
}

export const PIN_MS = 2 * 60_000;
export const SKIP_MS = 5 * 60_000;
export const LEARN_DAYS = 28;
export const HISTORY_CAP = 200;
const PIN_W = 1;
const SKIP_W = 0.5;

export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

const dayNumber = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Append a signal unless the same (day, part, mood, kind) is already there; keep the newest HISTORY_CAP. */
export function record(history: HistoryEvent[], ev: HistoryEvent): HistoryEvent[] {
  if (history.some((h) => h.day === ev.day && h.part === ev.part && h.moodId === ev.moodId && h.kind === ev.kind)) return history;
  const next = [...history, ev];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

export interface MoodChoice {
  mood: MoodMeta;
  part: DayPart;
  /** One line for the overlay: why Auto chose this mood. */
  reason: string;
}

const PART_PLURAL: Record<DayPart, string> = { morning: "mornings", day: "afternoons", evening: "evenings", night: "nights" };

/** Deterministic pick for `date`: day-part tag (1 point) + distinct-day pins − distinct-day skips from the
 * last LEARN_DAYS days of the same day part. Ties rotate by day-of-year so two evenings in a row differ
 * until the household has shown a preference. Empty history = the plain clock schedule. */
export function chooseMood(moods: MoodMeta[], date: Date, history: HistoryEvent[] = []): MoodChoice {
  if (moods.length === 0) throw new Error("empty catalog");
  const part = dayPart(date.getHours());
  const today = dayNumber(dayKey(date));
  const recent = history.filter((h) => h.part === part && today - dayNumber(h.day) < LEARN_DAYS && dayNumber(h.day) <= today);
  const pins = (id: MoodId) => recent.filter((h) => h.kind === "pin" && h.moodId === id).length;
  const skips = (id: MoodId) => recent.filter((h) => h.kind === "skip" && h.moodId === id).length;
  const score = (m: MoodMeta) => (m.tags.includes(part) ? 1 : 0) + PIN_W * pins(m.id) - SKIP_W * skips(m.id);
  const best = Math.max(...moods.map(score));
  const tied = moods.filter((m) => score(m) === best);
  const doy = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const mood = tied[doy % tied.length];

  const pinDays = new Set(recent.filter((h) => h.kind === "pin").map((h) => h.day)).size;
  const mine = pins(mood.id);
  // What the clock alone would have played — the reason line only claims learning when it changed the pick.
  const tagged = moods.filter((m) => m.tags.includes(part));
  const clockPick = (tagged.length ? tagged : moods)[doy % (tagged.length || moods.length)];
  let reason: string;
  if (mine > 0) reason = `Learned · you chose ${mood.title} on ${mine} of your last ${pinDays} ${PART_PLURAL[part]}`;
  else if (mood.id !== clockPick.id && skips(clockPick.id) > 0) reason = `Learned · passing over ${clockPick.title}, which you skipped recently`;
  else reason = `${part[0].toUpperCase()}${part.slice(1)} schedule`;
  return { mood, part, reason };
}

/** Clock-only pick (no history) — kept for callers that do not learn. */
export function autoMood(moods: MoodMeta[], date: Date): MoodMeta {
  return chooseMood(moods, date).mood;
}

export interface PlayerState {
  moodId: MoodId;
  auto: boolean; // true = follow the clock, false = user pinned a mood
  sleepEndsAt: number | null; // epoch ms, null = no timer
  paused: boolean;
  since: number; // epoch ms the current mood started (dwell for pin/skip)
  pinLogged: boolean; // the current hand-picked mood already produced its pin
  autoKey: string; // "day|part" of the last Auto decision — Auto re-decides only when it changes
  reason: string; // overlay line for the current Auto decision ("" when pinned)
  history: HistoryEvent[];
}

export type Action =
  | { type: "tick"; now: number }
  | { type: "pick"; moodId: MoodId; now: number }
  | { type: "auto"; now: number }
  | { type: "next"; now: number }
  | { type: "sleep"; minutes: number | null; now: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "forget"; now: number };

const keyOf = (date: Date) => `${dayKey(date)}|${dayPart(date.getHours())}`;

function decideAuto(s: PlayerState, moods: MoodMeta[], now: number): PlayerState {
  const date = new Date(now);
  const c = chooseMood(moods, date, s.history);
  const changed = c.mood.id !== s.moodId;
  return { ...s, auto: true, moodId: c.mood.id, autoKey: keyOf(date), reason: c.reason, since: changed || !s.auto ? now : s.since, pinLogged: false };
}

export function initialState(moods: MoodMeta[], now: number, history: HistoryEvent[] = []): PlayerState {
  const base: PlayerState = { moodId: "", auto: true, sleepEndsAt: null, paused: false, since: now, pinLogged: false, autoKey: "", reason: "", history };
  return decideAuto(base, moods, now);
}

/** Leaving the current mood by hand for `to`: an Auto pick left within SKIP_MS is a skip. */
function leave(s: PlayerState, to: MoodId, now: number): HistoryEvent[] {
  if (!s.auto || to === s.moodId || now - s.since >= SKIP_MS) return s.history;
  const date = new Date(s.since);
  return record(s.history, { day: dayKey(date), part: dayPart(date.getHours()), moodId: s.moodId, kind: "skip" });
}

function handPick(s: PlayerState, moodId: MoodId, now: number): PlayerState {
  if (moodId === s.moodId && !s.auto) return { ...s, paused: false };
  // Taking over the mood Auto is already playing keeps its start time: the stay counts from when it appeared.
  const since = moodId === s.moodId ? s.since : now;
  return { ...s, history: leave(s, moodId, now), moodId, auto: false, paused: false, since, pinLogged: false, reason: "" };
}

/** Pure reducer. `tick` is the only time-driven input; the shell calls it once a minute
 * and on media `ended` (the Vega w3cmedia element has no `loop`, so the shell restarts
 * the same file unless the mood changed in the meantime). */
export function reduce(s: PlayerState, a: Action, moods: MoodMeta[]): PlayerState {
  switch (a.type) {
    case "tick": {
      if (s.sleepEndsAt !== null && a.now >= s.sleepEndsAt) return { ...s, paused: true, sleepEndsAt: null };
      if (s.paused) return s;
      if (!s.auto) {
        // A pinned mood still on screen when the day part (or day) changes starts a fresh stay:
        // settle the old stay's pin, then the new part gets its own 2-minute dwell and vote.
        // (A TV left on around the clock therefore also votes for the parts it runs through.)
        const since = new Date(s.since);
        const pin = (h: HistoryEvent[]) => record(h, { day: dayKey(since), part: dayPart(since.getHours()), moodId: s.moodId, kind: "pin" });
        if (keyOf(new Date(a.now)) !== keyOf(since)) {
          const settled = !s.pinLogged && a.now - s.since >= PIN_MS ? pin(s.history) : s.history;
          return { ...s, history: settled, since: a.now, pinLogged: false };
        }
        if (s.pinLogged || a.now - s.since < PIN_MS) return s;
        return { ...s, pinLogged: true, history: pin(s.history) };
      }
      return keyOf(new Date(a.now)) === s.autoKey ? s : decideAuto(s, moods, a.now);
    }
    case "pick":
      if (!moods.some((m) => m.id === a.moodId)) return s;
      return handPick(s, a.moodId, a.now);
    case "auto":
      return decideAuto({ ...s, paused: false }, moods, a.now);
    case "next": {
      const i = moods.findIndex((m) => m.id === s.moodId);
      return handPick(s, moods[(i + 1) % moods.length].id, a.now);
    }
    case "sleep":
      return { ...s, sleepEndsAt: a.minutes === null ? null : a.now + a.minutes * 60_000 };
    case "pause":
      return { ...s, paused: true };
    case "resume":
      return { ...s, paused: false };
    case "forget": {
      const cleared = { ...s, history: [] };
      return s.auto ? decideAuto(cleared, moods, a.now) : cleared;
    }
  }
}

/** Remaining sleep-timer minutes for the on-screen chip, or null. */
export function sleepRemainingMin(s: PlayerState, now: number): number | null {
  return s.sleepEndsAt === null ? null : Math.max(0, Math.ceil((s.sleepEndsAt - now) / 60_000));
}
