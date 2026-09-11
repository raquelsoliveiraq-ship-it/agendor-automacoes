import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, '..', '.state', 'settings.json');

// Liga/desliga por automação, num arquivo só, separado do estado de execução de
// cada uma. Fica aqui isolado porque na fase de servidor compartilhado este é o
// único pedaço que precisa sair do disco e ir para o banco.
function loadAll() {
  if (!fs.existsSync(SETTINGS_FILE)) return { automations: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { automations: parsed.automations || {} };
  } catch {
    return { automations: {} };
  }
}

function saveAll(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Automação sem registro nenhum começa ligada, para não deixar o dashboard
// mudo numa instalação nova.
export function getAutomationSettings(automationId) {
  const entry = loadAll().automations[automationId];
  return {
    enabled: entry?.enabled !== false,
    changedAt: entry?.changedAt ?? null,
    changedBy: entry?.changedBy ?? null,
  };
}

export function setAutomationEnabled(automationId, enabled, changedBy = null) {
  const settings = loadAll();
  settings.automations[automationId] = {
    enabled: Boolean(enabled),
    changedAt: new Date().toISOString(),
    changedBy,
  };
  saveAll(settings);
  return getAutomationSettings(automationId);
}
