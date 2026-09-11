import { readJSON, writeJSON } from './storage.js';

export async function loadState(automationId, defaultState) {
  return readJSON(`state:${automationId}`, defaultState);
}

export async function saveState(automationId, state) {
  await writeJSON(`state:${automationId}`, state);
}
