import { readJSON, writeJSON } from './storage.js';

// Modelos de e-mail são texto da empresa, não preferência de quem está na
// máquina: ficam no projeto, para as duas pessoas verem os mesmos. Guardados
// por automação, para uma automação nova poder ter os seus sem misturar.
async function loadAll() {
  const parsed = await readJSON('templates', {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

async function saveAll(all) {
  await writeJSON('templates', all);
}

export async function listTemplates(automationId) {
  const list = (await loadAll())[automationId] || [];
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Salvar com um nome que já existe atualiza aquele modelo, em vez de criar um
// segundo com o mesmo nome — que é o que a pessoa espera ao reeditar um texto.
export async function saveTemplate(automationId, { name, values }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('O modelo precisa de um nome.');
  if (!values || typeof values !== 'object') throw new Error('O modelo veio sem conteúdo.');

  const all = await loadAll();
  const list = all[automationId] || [];
  const existing = list.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  if (existing) {
    existing.values = values;
    existing.updatedAt = new Date().toISOString();
  } else {
    list.push({
      id: `tpl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      values,
      updatedAt: new Date().toISOString(),
    });
  }

  all[automationId] = list;
  await saveAll(all);
  return listTemplates(automationId);
}

export async function deleteTemplate(automationId, templateId) {
  const all = await loadAll();
  all[automationId] = (all[automationId] || []).filter((t) => t.id !== templateId);
  await saveAll(all);
  return listTemplates(automationId);
}
