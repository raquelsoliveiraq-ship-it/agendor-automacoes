import * as clienteEfetivoEmail from './clienteEfetivoEmail.js';
import * as bulkTasksByFilter from './bulkTasksByFilter.js';

// Cada automação nova (ex: automacaoX.js) exporta { meta, run, getState } e
// entra nesta lista para aparecer automaticamente no dashboard.
export const automations = [bulkTasksByFilter, clienteEfetivoEmail];

export function findAutomation(id) {
  return automations.find((a) => a.meta.id === id);
}
