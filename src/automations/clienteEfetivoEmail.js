import { listCategories, getCurrentUser, listPeopleByCategory, createPersonTask } from '../agendorClient.js';
import { loadState, saveState } from '../stateStore.js';

export const meta = {
  id: 'cliente-efetivo-email',
  name: 'E-mail para novo Cliente Efetivo',
  description: 'Quando uma pessoa é adicionada com Categoria = "Cliente efetivo", agenda uma tarefa de e-mail para 1 dia depois.',
  steps: [
    {
      type: 'trigger',
      label: 'Quando',
      title: 'Uma pessoa for adicionada',
      detail: 'Filtro: Categoria é igual a "Cliente efetivo"',
    },
    {
      type: 'action',
      label: 'Então',
      title: 'Agendar uma atividade',
      detail: 'Tipo: E-mail · Para: 1 dia depois · Responsável: dono do token da API',
    },
  ],
};

const TARGET_CATEGORY_NAME = 'Cliente efetivo';
const TASK_TYPE = 'EMAIL';
const TASK_TEXT = 'Enviar e-mail de boas-vindas — novo Cliente efetivo';
const DELAY_DAYS = 1;
const MAX_PAGES = 50;
const PER_PAGE = 100;

async function fetchAllPeopleInCategory(categoryId) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await listPeopleByCategory({ categoryId, page, perPage: PER_PAGE });
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

export function getState() {
  return loadState(meta.id, { lastRunAt: null, processedPersonIds: [] });
}

export async function run({ log = () => {} } = {}) {
  const state = getState();
  const isFirstRun = state.lastRunAt === null;

  const categories = await listCategories();
  const category = categories.find((c) => c.name === TARGET_CATEGORY_NAME);
  if (!category) {
    throw new Error(
      `Categoria "${TARGET_CATEGORY_NAME}" não encontrada. Categorias disponíveis: ${categories.map((c) => c.name).join(', ')}`
    );
  }

  const currentUser = await getCurrentUser();
  const people = await fetchAllPeopleInCategory(category.id);

  const processedIds = new Set(state.processedPersonIds);
  const lastRunAt = state.lastRunAt ? new Date(state.lastRunAt) : null;

  const candidates = people.filter((p) => {
    if (processedIds.has(p.id)) return false;
    if (isFirstRun) return false; // primeira execução só define o ponto de partida, não processa histórico
    return lastRunAt ? new Date(p.createdAt) > lastRunAt : true;
  });

  if (isFirstRun) {
    log(
      `Primeira execução: encontrei ${people.length} pessoa(s) já na categoria "${TARGET_CATEGORY_NAME}", mas nenhuma será processada agora (o ponto de partida é definido a partir de agora).`
    );
  } else {
    log(`Encontrei ${candidates.length} pessoa(s) nova(s) em "${TARGET_CATEGORY_NAME}" desde a última execução (${lastRunAt?.toISOString()}).`);
  }

  let created = 0;
  const errors = [];
  for (const person of candidates) {
    try {
      const dueDate = new Date(Date.now() + DELAY_DAYS * 24 * 60 * 60 * 1000);
      const task = await createPersonTask({
        personId: person.id,
        text: TASK_TEXT,
        dueDate,
        assignedUsers: [currentUser.id],
        type: TASK_TYPE,
      });
      log(`  -> tarefa ${task.id} criada para "${person.name}" (pessoa ${person.id}), vencimento ${dueDate.toISOString()}`);
      processedIds.add(person.id);
      created += 1;
    } catch (err) {
      const message = `ERRO ao criar tarefa para "${person.name}" (pessoa ${person.id}): ${err.status ?? ''} ${JSON.stringify(err.body ?? err.message)}`;
      log(`  -> ${message}`);
      errors.push(message);
    }
  }

  const newState = {
    lastRunAt: new Date().toISOString(),
    processedPersonIds: [...processedIds],
  };
  saveState(meta.id, newState);

  log(`\nConcluído. ${created} tarefa(s) criada(s).`);

  return { created, candidatesCount: candidates.length, isFirstRun, errors, state: newState };
}
