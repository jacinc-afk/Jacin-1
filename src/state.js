import { readFile, writeFile } from 'node:fs/promises';

const STATE_PATH = process.env.STATE_FILE || 'state/processed.json';

const DEFAULT_STATE = { lastRunIso: null, processedMessageIds: [] };

// Keep only recent IDs so the file doesn't grow forever.
const MAX_TRACKED_IDS = 2000;

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_STATE };
    throw err;
  }
}

async function saveState(state) {
  const trimmed = {
    ...state,
    processedMessageIds: state.processedMessageIds.slice(-MAX_TRACKED_IDS),
  };
  await writeFile(STATE_PATH, JSON.stringify(trimmed, null, 2));
}

export { loadState, saveState, STATE_PATH };
