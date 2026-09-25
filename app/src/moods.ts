/**
 * Mood catalog for the shell — single source of truth stays in ../../content/moods/*.json
 * (Metro reaches them through `watchFolders` in metro.config.js). Each mood maps to one
 * pre-rendered MP4 bundled at assets/raw/<id>.mp4 (rendered by ../../content/render_all.sh).
 */
import type {MoodMeta} from '../../engine/scheduler';

import deepSpace from '../../content/moods/deep_space.json';
import rainWindow from '../../content/moods/rain_window.json';
import fireplace from '../../content/moods/fireplace.json';
import dawnAurora from '../../content/moods/dawn_aurora.json';
import midnightOcean from '../../content/moods/midnight_ocean.json';

interface MoodFile {
  id: string;
  title: string;
  tags: string[];
  palette: string[];
}

const files: MoodFile[] = [deepSpace, rainWindow, fireplace, dawnAurora, midnightOcean];

export const MOODS: MoodMeta[] = files.map(({id, title, tags}) => ({id, title, tags}));

/** Accent colour for the overlay (last palette entry = the mood's highlight). */
export const ACCENT: Record<string, string> = Object.fromEntries(
  files.map((m) => [m.id, m.palette[m.palette.length - 1]]),
);

/** Bundled raw asset path — `/pkg` is the stable prefix for files under assets/raw (Vega community answer, 2025). */
export const moodUri = (id: string): string => `/pkg/assets/raw/${id}.mp4`;
