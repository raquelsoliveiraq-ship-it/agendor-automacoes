import { readJSON, writeJSON } from './storage.js';

// Liga/desliga por automação, num registro só, separado do estado de execução
// de cada uma.
async function loadAll() {
  const parsed = await readJSON('settings', { automations: {} });
  return { automations: parsed.automations || {} };
}

async function saveAll(settings) {
  await writeJSON('settings', settings);
}

// Automação sem registro nenhum começa ligada, para não deixar o dashboard
// mudo numa instalação nova.
export async function getAutomationSettings(automationId) {
  const entry = (await loadAll()).automations[automationId];
  return {
    enabled: entry?.enabled !== false,
    changedAt: entry?.changedAt ?? null,
    changedBy: entry?.changedBy ?? null,
  };
}

export async function setAutomationEnabled(automationId, enabled, changedBy = null) {
  const settings = await loadAll();
  settings.automations[automationId] = {
    enabled: Boolean(enabled),
    changedAt: new Date().toISOString(),
    changedBy,
  };
  await saveAll(settings);
  return getAutomationSettings(automationId);
}
