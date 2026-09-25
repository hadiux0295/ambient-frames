/**
 * Household history persistence — one AsyncStorage key, JSON array of HistoryEvent.
 * Everything stays on this TV. If the storage module is missing or throws, the app keeps
 * learning in memory for the session (a lost history is a cold start, never a crash).
 */
import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import {HISTORY_CAP, type HistoryEvent} from '../../engine/scheduler';

const KEY = 'af.history.v1';

const isEvent = (e: unknown): e is HistoryEvent => {
  const h = e as HistoryEvent;
  return (
    typeof h?.day === 'string' &&
    ['morning', 'day', 'evening', 'night'].includes(h.part) &&
    typeof h.moodId === 'string' &&
    (h.kind === 'pin' || h.kind === 'skip')
  );
};

export async function loadHistory(): Promise<HistoryEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEvent).slice(-HISTORY_CAP) : [];
  } catch (e) {
    console.warn('[AmbientFrames] history load failed — starting fresh', e);
    return [];
  }
}

export async function saveHistory(history: HistoryEvent[]): Promise<void> {
  try {
    if (history.length === 0) {
      await AsyncStorage.removeItem(KEY);
    } else {
      await AsyncStorage.setItem(KEY, JSON.stringify(history));
    }
  } catch (e) {
    console.warn('[AmbientFrames] history save failed — kept in memory only', e);
  }
}
