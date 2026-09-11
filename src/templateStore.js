import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_FILE = path.join(__dirname, '..', '.state', 'templates.json');

// Modelos de e-mail são texto da empresa, não preferência de quem está na
// máquina: ficam no projeto, para as duas pessoas verem os mesmos. Guardados
// por automação, para uma automação nova poder ter os seus sem misturar.
function loadAll() {
  if (!fs.existsSync(TEMPLATES_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(all) {
  fs.mkdirSync(path.dirname(TEMPLATES_FILE), { recursive: true });
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(all, null, 2));
}

export function listTemplates(automationId) {
  const list = loadAll()[automationId] || [];
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Salvar com um nome que já existe atualiza aquele modelo, em vez de criar um
// segundo com o mesmo nome — que é o que a pessoa espera ao reeditar um texto.
export function saveTemplate(automationId, { name, values }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('O modelo precisa de um nome.');
  if (!values || typeof values !== 'object') throw new Error('O modelo veio sem conteúdo.');

  const all = loadAll();
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
  saveAll(all);
  return listTemplates(automationId);
}

export function deleteTemplate(automationId, templateId) {
  const all = loadAll();
  all[automationId] = (all[automationId] || []).filter((t) => t.id !== templateId);
  saveAll(all);
  return listTemplates(automationId);
}
