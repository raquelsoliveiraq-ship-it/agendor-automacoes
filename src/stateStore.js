import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', '.state');

function statePath(automationId) {
  return path.join(STATE_DIR, `${automationId}.json`);
}

export function loadState(automationId, defaultState) {
  const file = statePath(automationId);
  if (!fs.existsSync(file)) return { ...defaultState };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveState(automationId, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(statePath(automationId), JSON.stringify(state, null, 2));
}
