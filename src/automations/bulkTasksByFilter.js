import { listCategories, listUsers, listOrganizations, listPeopleByFilters, createPersonTask } from '../agendorClient.js';
import { loadState, saveState } from '../stateStore.js';

export const meta = {
  id: 'bulk-tasks-by-filter',
  name: 'Tarefas em massa por filtro',
  description: 'Cria uma tarefa igual para todas as pessoas que casam com os filtros escolhidos, numa data específica.',
  configurable: true,
  configSchema: [
    { name: 'categoryId', label: 'Categoria', type: 'select', optionsSource: 'categories', allowEmpty: true, emptyLabel: 'Qualquer categoria' },
    { name: 'ownerUserId', label: 'Responsável (dono do contato)', type: 'select', optionsSource: 'users', allowEmpty: true, emptyLabel: 'Qualquer responsável' },
    { name: 'organizationId', label: 'Empresa', type: 'autocomplete', optionsSource: 'organizations', allowEmpty: true, emptyLabel: 'Qualquer empresa' },
    { name: 'dueDate', label: 'Data de vencimento', type: 'date', required: true },
    { name: 'dueTime', label: 'Horário', type: 'time', default: '12:00', required: true },
    {
      name: 'taskType',
      label: 'Tipo de tarefa',
      type: 'select',
      options: [
        { value: 'EMAIL', label: 'E-mail' },
        { value: 'LIGACAO', label: 'Ligação' },
        { value: 'REUNIAO', label: 'Reunião' },
        { value: 'VISITA', label: 'Visita' },
      ],
      default: 'EMAIL',
      required: true,
    },
    { name: 'taskText', label: 'Texto da tarefa', type: 'text', required: true },
    { name: 'assignedUserId', label: 'Atribuir tarefa para', type: 'select', optionsSource: 'users', required: true },
  ],
  canvasTemplate: [
    {
      label: 'Filtro',
      title: 'Pessoas que casam com',
      detailTemplate: 'Categoria: {categoryId} · Responsável: {ownerUserId} · Empresa: {organizationId}',
    },
    {
      label: 'Ação',
      title: 'Criar tarefa em massa',
      detailTemplate: 'Tipo: {taskType} · Vencimento: {dueDate} {dueTime} · Atribuída a: {assignedUserId} · Texto: "{taskText}"',
    },
  ],
};

const MAX_PAGES = 50;
const PER_PAGE = 100;
const MAX_HISTORY = 30;

// Cache em memória do processo — categorias/usuários/empresas mudam pouco
// e a lista de empresas sozinha já leva vários requests paginados.
const optionsCache = {};
const OPTIONS_TTL_MS = 5 * 60 * 1000;

export async function getOptions(source) {
  const cached = optionsCache[source];
  if (cached && Date.now() - cached.at < OPTIONS_TTL_MS) return cached.data;

  let data;
  if (source === 'categories') {
    const categories = await listCategories();
    data = categories.map((c) => ({ value: String(c.id), label: c.name }));
  } else if (source === 'users') {
    const users = await listUsers();
    data = users.map((u) => ({ value: String(u.id), label: u.name }));
  } else if (source === 'organizations') {
    const organizations = await listOrganizations();
    data = organizations.map((o) => ({ value: String(o.id), label: o.name }));
  } else {
    throw new Error(`Fonte de opções desconhecida: ${source}`);
  }

  optionsCache[source] = { data, at: Date.now() };
  return data;
}

async function fetchAllMatching({ categoryId, ownerUserId, organizationId }) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await listPeopleByFilters({ categoryId, ownerUserId, organizationId, page, perPage: PER_PAGE });
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

function buildDueDate(config) {
  return new Date(`${config.dueDate}T${config.dueTime}:00-03:00`);
}

export function getState() {
  return loadState(meta.id, { runs: [] });
}

export async function preview(config) {
  const people = await fetchAllMatching(config);
  return {
    matchedCount: people.length,
    sample: people.slice(0, 10).map((p) => p.name),
  };
}

export async function run({ log = () => {}, config }) {
  if (!config?.dueDate || !config?.dueTime || !config?.taskText || !config?.assignedUserId) {
    throw new Error('Preencha data, horário, texto da tarefa e responsável antes de rodar.');
  }

  const people = await fetchAllMatching(config);
  log(`Encontradas ${people.length} pessoa(s) com os filtros selecionados.`);

  const dueDate = buildDueDate(config);
  let created = 0;
  const errors = [];

  for (const person of people) {
    try {
      const task = await createPersonTask({
        personId: person.id,
        text: config.taskText,
        dueDate,
        assignedUsers: [Number(config.assignedUserId)],
        type: config.taskType || 'EMAIL',
      });
      log(`  -> tarefa ${task.id} criada para "${person.name}" (pessoa ${person.id})`);
      created += 1;
    } catch (err) {
      const message = `ERRO ao criar tarefa para "${person.name}" (pessoa ${person.id}): ${err.status ?? ''} ${JSON.stringify(err.body ?? err.message)}`;
      log(`  -> ${message}`);
      errors.push(message);
    }
  }

  log(`\nConcluído. ${created}/${people.length} tarefa(s) criada(s).`);

  const state = getState();
  const historyEntry = {
    ranAt: new Date().toISOString(),
    config,
    matchedCount: people.length,
    created,
    errorCount: errors.length,
  };
  const runs = [historyEntry, ...state.runs].slice(0, MAX_HISTORY);
  saveState(meta.id, { runs });

  return { created, matchedCount: people.length, errors, historyEntry };
}
