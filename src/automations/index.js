import * as bulkTasksByFilter from './bulkTasksByFilter.js';
import * as bulkEditDeleteTasks from './bulkEditDeleteTasks.js';
import * as emailDrafts from './emailDrafts.js';

// Cada automação nova (ex: automacaoX.js) exporta { meta, run, getState } e
// entra nesta lista para aparecer automaticamente no dashboard.
export const automations = [emailDrafts, bulkTasksByFilter, bulkEditDeleteTasks];

export function findAutomation(id) {
  return automations.find((a) => a.meta.id === id);
}
