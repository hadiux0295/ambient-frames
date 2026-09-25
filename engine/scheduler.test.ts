import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dayPart, autoMood, chooseMood, initialState, reduce, record, sleepRemainingMin,
  HISTORY_CAP, PIN_MS, SKIP_MS, type HistoryEvent, type MoodMeta, type PlayerState,
} from "./scheduler.ts";

const moodDir = join(import.meta.dirname, "..", "content", "moods");
const moods: MoodMeta[] = readdirSync(moodDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(moodDir, f), "utf8")))
  .map((m) => ({ id: m.id, title: m.title, tags: m.tags }));

const at = (h: number, d = 5) => new Date(2026, 8, d, h, 0, 0).getTime(); // local time

test("catalog: 5 moods, every day part covered", () => {
  assert.equal(moods.length, 5);
  for (const p of ["morning", "day", "evening", "night"]) assert.ok(moods.some((m) => m.tags.includes(p)), p);
});

test("dayPart boundaries", () => {
  assert.equal(dayPart(4), "night");
  assert.equal(dayPart(5), "morning");
  assert.equal(dayPart(11), "day");
  assert.equal(dayPart(17), "evening");
  assert.equal(dayPart(22), "night");
  assert.throws(() => dayPart(24));
});

test("autoMood picks a mood tagged for the hour and rotates across days", () => {
  const m = autoMood(moods, new Date(at(19)));
  assert.ok(m.tags.includes("evening"));
  const nights = new Set([autoMood(moods, new Date(at(23, 5))).id, autoMood(moods, new Date(at(23, 6))).id]);
  assert.equal(nights.size, 2, "two night moods should alternate day to day");
});

test("tick follows the clock only in auto mode", () => {
  let s = initialState(moods, at(8));
  const morning = s.moodId;
  s = reduce(s, { type: "tick", now: at(19) }, moods);
  assert.notEqual(s.moodId, morning);
  s = reduce(s, { type: "pick", moodId: "fireplace", now: at(19) }, moods);
  s = reduce(s, { type: "tick", now: at(8, 6) }, moods);
  assert.equal(s.moodId, "fireplace", "pinned mood survives ticks");
  s = reduce(s, { type: "auto", now: at(8, 6) }, moods);
  s = reduce(s, { type: "tick", now: at(8, 6) }, moods);
  assert.ok(moods.find((m) => m.id === s.moodId)!.tags.includes("morning"));
});

test("unknown pick is ignored, next wraps", () => {
  let s = initialState(moods, at(12));
  const before = s.moodId;
  s = reduce(s, { type: "pick", moodId: "nope", now: at(12) }, moods);
  assert.equal(s.moodId, before);
  const seen = new Set<string>();
  for (let i = 0; i < moods.length; i++) { s = reduce(s, { type: "next", now: at(12) }, moods); seen.add(s.moodId); }
  assert.equal(seen.size, moods.length);
});

test("sleep timer pauses at expiry and clears itself", () => {
  let s = initialState(moods, at(22));
  s = reduce(s, { type: "sleep", minutes: 30, now: at(22) }, moods);
  assert.equal(sleepRemainingMin(s, at(22) + 10 * 60_000), 20);
  s = reduce(s, { type: "tick", now: at(22) + 29 * 60_000 }, moods);
  assert.equal(s.paused, false);
  s = reduce(s, { type: "tick", now: at(22) + 30 * 60_000 }, moods);
  assert.equal(s.paused, true);
  assert.equal(s.sleepEndsAt, null);
  s = reduce(s, { type: "resume" }, moods);
  assert.equal(s.paused, false);
});

// ── household learning ──────────────────────────────────────────────────────────────
const min = 60_000;
const run = (s: PlayerState, ...acts: Parameters<typeof reduce>[1][]) => acts.reduce((st, a) => reduce(st, a, moods), s);
const eveningAuto = (d: number) => chooseMood(moods, new Date(at(19, d))).mood.id;

/** One evening on day d: open the app, pick `id` by hand, watch it for `watch` minutes. */
function evening(history: HistoryEvent[], d: number, id: string, watch = 10): HistoryEvent[] {
  let s = initialState(moods, at(19, d), history);
  s = run(s, { type: "pick", moodId: id, now: at(19, d) + 10_000 });
  for (let m = 1; m <= watch; m++) s = run(s, { type: "tick", now: at(19, d) + 10_000 + m * min });
  return s.history;
}

const off = moods.find((m) => !m.tags.includes("evening"))!.id; // a mood the clock never offers at 19:00
const pin = (d: number, part: HistoryEvent["part"], moodId: string): HistoryEvent => ({ day: `2026-09-${String(d).padStart(2, "0")}`, part, moodId, kind: "pin" });
const pins = (h: HistoryEvent[]) => h.filter((e) => e.kind === "pin");

test("no history = the plain clock schedule", () => {
  for (const d of [5, 6, 7]) assert.equal(chooseMood(moods, new Date(at(19, d)), []).mood.id, autoMood(moods, new Date(at(19, d))).id);
  assert.equal(chooseMood(moods, new Date(at(19))).reason, "Evening schedule");
});

test("a hand pick kept for PIN_MS becomes one pin; browsing is not a vote", () => {
  let s = initialState(moods, at(19));
  s = run(s, { type: "pick", moodId: "deep_space", now: at(19) + 10_000 }, { type: "tick", now: at(19) + 10_000 + PIN_MS - 1 });
  assert.equal(pins(s.history).length, 0);
  s = run(s, { type: "tick", now: at(19) + 10_000 + PIN_MS });
  assert.deepEqual(pins(s.history), [pin(5, "evening", "deep_space")]);
  s = run(s, { type: "tick", now: at(19) + PIN_MS + 5 * min });
  assert.equal(pins(s.history).length, 1, "one pin per stay");
  let b = initialState(moods, at(19));
  for (let i = 0; i < 4; i++) b = run(b, { type: "next", now: at(19) + i * 5_000 }, { type: "tick", now: at(19) + i * 5_000 + 1_000 });
  assert.equal(pins(b.history).length, 0);
});

test("taking over the mood Auto already plays is a pin, never a skip", () => {
  const auto = eveningAuto(5);
  let s = initialState(moods, at(19, 5));
  s = run(s, { type: "pick", moodId: auto, now: at(19, 5) + 60_000 }, { type: "tick", now: at(19, 5) + PIN_MS });
  assert.deepEqual(s.history, [pin(5, "evening", auto)]);
});

test("household preference wins the evening after two evenings and explains itself", () => {
  const h = evening(evening([], 1, off), 2, off);
  const c = chooseMood(moods, new Date(at(19, 3)), h);
  assert.equal(c.mood.id, off);
  assert.equal(c.reason, `Learned · you chose ${c.mood.title} on 2 of your last 2 evenings`);
  assert.equal(initialState(moods, at(19, 3), h).moodId, off, "Auto plays it with no key press");
  assert.equal(chooseMood(moods, new Date(at(8, 3)), h).mood.id, autoMood(moods, new Date(at(8, 3))).id, "mornings untouched");
});

test("one vote per day; a lone pin only ties the clock; votes expire after LEARN_DAYS", () => {
  let h: HistoryEvent[] = [];
  for (let i = 0; i < 5; i++) h = evening(h, 1, off);
  assert.equal(pins(h).length, 1);
  const lone = [pin(1, "evening", off)];
  // tie (1 vs 1) → rotation decides, so the clock mood still shows up on some evenings
  const picks = new Set([2, 3].map((d) => chooseMood(moods, new Date(at(19, d)), lone).mood.id));
  assert.equal(picks.size, 2);
  const two = [...lone, pin(2, "evening", off)];
  assert.equal(chooseMood(moods, new Date(at(19, 3)), two).mood.id, off);
  assert.notEqual(chooseMood(moods, new Date(at(19, 30)), two).mood.id, off, "28+ days later the votes are gone");
});

test("switching away from an Auto pick quickly is a skip and pushes it down", () => {
  const nightAuto = (d: number, h: HistoryEvent[] = []) => chooseMood(moods, new Date(at(23, d)), h).mood.id;
  const first = nightAuto(5);
  let s = initialState(moods, at(23, 5));
  s = run(s, { type: "next", now: at(23, 5) + SKIP_MS - 1 });
  assert.deepEqual(s.history, [{ day: "2026-09-05", part: "night", moodId: first, kind: "skip" }]);
  const watched = run(initialState(moods, at(23, 5)), { type: "next", now: at(23, 5) + SKIP_MS });
  assert.equal(watched.history.length, 0, "watched long enough = not a skip");
  assert.equal(nightAuto(7), first, "the two night moods alternate, so day 7 would repeat it");
  const c = chooseMood(moods, new Date(at(23, 7)), s.history);
  assert.notEqual(c.mood.id, first);
  assert.equal(c.reason, `Learned · passing over ${moods.find((m) => m.id === first)!.title}, which you skipped recently`);
});

test("a skip that did not change the pick is not claimed as learning", () => {
  // the only evening mood was skipped once, but nothing else scores higher → it still plays, on the plain schedule line
  const h: HistoryEvent[] = [{ day: "2026-09-05", part: "evening", moodId: eveningAuto(5), kind: "skip" }];
  const c = chooseMood(moods, new Date(at(19, 6)), h);
  assert.equal(c.mood.id, eveningAuto(6));
  assert.equal(c.reason, "Evening schedule");
});

test("Auto re-decides only when the day part or day changes, not as votes arrive", () => {
  const h = evening(evening([], 1, off), 2, off);
  let s = initialState(moods, at(18, 3), h);
  assert.equal(s.moodId, off);
  const since = s.since;
  s = run(s, { type: "tick", now: at(20, 3) }, { type: "tick", now: at(21, 3) });
  assert.equal(s.moodId, off);
  assert.equal(s.since, since);
  s = run(s, { type: "tick", now: at(22, 3) });
  assert.equal(s.reason, "Night schedule");
  assert.ok(moods.find((m) => m.id === s.moodId)!.tags.includes("night"));
});

test("forget clears the history and returns Auto to the clock", () => {
  const h = evening(evening([], 1, off), 2, off);
  let s = initialState(moods, at(19, 3), h);
  assert.equal(s.moodId, off);
  s = run(s, { type: "forget", now: at(19, 3) });
  assert.deepEqual(s.history, []);
  assert.equal(s.moodId, autoMood(moods, new Date(at(19, 3))).id);
  assert.equal(s.reason, "Evening schedule");
});

test("history is capped", () => {
  let h: HistoryEvent[] = [];
  for (let i = 0; i < HISTORY_CAP + 20; i++) h = record(h, { day: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, part: "day", moodId: `m${i}`, kind: "pin" });
  assert.equal(h.length, HISTORY_CAP);
  assert.equal(h[h.length - 1].moodId, `m${HISTORY_CAP + 19}`);
});

test("a mood left pinned across evenings earns one pin per day part it spans", () => {
  let s = initialState(moods, at(19, 1));
  s = run(s, { type: "pick", moodId: off, now: at(19, 1) + 10_000 });
  for (const d of [2, 3, 4]) s = run(s, { type: "tick", now: at(19, d) + 30 * 60_000 });
  assert.deepEqual(pins(s.history).map((h) => h.day), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  s = run(s, { type: "auto", now: at(19, 4) + 31 * 60_000 });
  assert.equal(s.moodId, off);
  assert.equal(s.reason, `Learned · you chose ${moods.find((m) => m.id === off)!.title} on 3 of your last 3 evenings`);
});
