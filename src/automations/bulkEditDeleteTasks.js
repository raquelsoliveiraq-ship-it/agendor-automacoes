import { loadState, saveState } from '../stateStore.js';
import { cachedOptions } from '../optionsCache.js';
import {
  listUsers,
  listTasksByDueRange,
  deletePersonTask,
  deleteOrganizationTask,
  updatePersonTask,
  updateOrganizationTask,
  getOrganization,
  getPerson,
} from '../agendorClient.js';

export const meta = {
  id: 'bulk-edit-delete-tasks',
  name: 'Tarefas em massa: apagar ou editar',
  description:
    'Apaga ou muda o tipo/data de várias tarefas de uma vez no Agendor — pra desfazer um "Tarefas em massa" que saiu errado, ou pra ajustar tarefas antigas que casem com um filtro. Sempre mostra a lista de quem vai ser afetado antes de rodar.',
  configurable: true,
  destructive: true,
  formTitle: 'Filtro e ação',
  runLabel: 'Apagar tarefas',
  runningLabel: 'Apagando...',
  actionLabels: {
    delete: { run: 'Apagar tarefas', running: 'Apagando...' },
    edit: { run: 'Mudar tarefas', running: 'Mudando...' },
  },
  howItWorks: [
    'Modo "Desfazer execução": escolhe uma das execuções recentes de "Tarefas em massa por filtro" (só entram as que guardaram o ID de cada tarefa criada) e afeta exatamente essas tarefas, pelo ID.',
    'Modo "Buscar por filtro": procura direto no Agendor as tarefas planejadas pra um dia específico, e deixa afinar por tipo, responsável, texto e — pro caso de "mandei pra todo mundo, só queria quem tinha e-mail/telefone" — só as que foram pra uma empresa ou pessoa SEM e-mail ou SEM telefone cadastrado.',
    'Ação "Apagar": some com a tarefa, sem volta.',
    'Ação "Mudar tipo e/ou data": reescreve a tarefa com o novo tipo e/ou nova data — o que você não preencher continua como estava. Dá pra corrigir de novo depois, ao contrário de apagar.',
    'Tarefa já concluída nunca entra na lista, mesmo que case com o filtro.',
    'Acima de 300 tarefas no mesmo filtro, a automação recusa rodar — é sinal de que o filtro tá largo demais.',
  ],
  configSchema: [
    {
      name: 'action',
      label: 'Ação',
      type: 'select',
      options: [
        { value: 'delete', label: 'Apagar' },
        { value: 'edit', label: 'Mudar tipo e/ou data' },
      ],
      default: 'delete',
      required: true,
      highlight: true,
    },
    {
      name: 'mode',
      label: 'Como escolher',
      type: 'select',
      options: [
        { value: 'history', label: 'Desfazer uma execução do histórico' },
        { value: 'search', label: 'Buscar tarefas por filtro' },
      ],
      default: 'history',
      required: true,
      highlight: true,
    },
    {
      name: 'runId',
      label: 'Execução',
      type: 'select',
      optionsSource: 'pickableRuns',
      required: true,
      highlight: true,
      showWhen: { field: 'mode', equals: 'history' },
    },
    {
      name: 'plannedDate',
      label: 'Planejada para o dia',
      type: 'date',
      required: true,
      highlight: true,
      showWhen: { field: 'mode', equals: 'search' },
    },
    {
      name: 'searchTaskType',
      label: 'Tipo de tarefa',
      type: 'select',
      options: [
        { value: 'EMAIL', label: 'E-mail' },
        { value: 'LIGACAO', label: 'Ligação' },
        { value: 'REUNIAO', label: 'Reunião' },
        { value: 'VISITA', label: 'Visita' },
      ],
      allowEmpty: true,
      emptyLabel: 'Qualquer tipo',
      showWhen: { field: 'mode', equals: 'search' },
    },
    {
      name: 'searchAssignedUserId',
      label: 'Atribuída a',
      type: 'select',
      optionsSource: 'users',
      allowEmpty: true,
      emptyLabel: 'Qualquer responsável',
      showWhen: { field: 'mode', equals: 'search' },
    },
    {
      name: 'searchTextContains',
      label: 'Texto da tarefa contém',
      type: 'text',
      showWhen: { field: 'mode', equals: 'search' },
    },
    {
      // Caso real que motivou isso: e-mail criado pra TODAS as empresas de um
      // filtro, quando devia ter ido só pras que tinham e-mail cadastrado. Esse
      // campo isola exatamente as que ficaram de fora dessa regra — pra apagar,
      // ou (melhor ainda) pra virar tarefa de Ligação em vez de sumir.
      name: 'onlyMissing',
      label: 'Só quem não tem',
      type: 'select',
      options: [
        { value: 'missingEmail', label: 'E-mail cadastrado' },
        { value: 'missingPhone', label: 'Telefone cadastrado' },
      ],
      allowEmpty: true,
      emptyLabel: 'Não filtrar por isso',
      showWhen: { field: 'mode', equals: 'search' },
    },
    {
      name: 'newTaskType',
      label: 'Novo tipo de tarefa',
      type: 'select',
      options: [
        { value: 'EMAIL', label: 'E-mail' },
        { value: 'LIGACAO', label: 'Ligação' },
        { value: 'REUNIAO', label: 'Reunião' },
        { value: 'VISITA', label: 'Visita' },
      ],
      allowEmpty: true,
      emptyLabel: 'Não mudar o tipo',
      showWhen: { field: 'action', equals: 'edit' },
    },
    {
      name: 'newDate',
      label: 'Nova data de vencimento',
      type: 'date',
      showWhen: { field: 'action', equals: 'edit' },
    },
    {
      name: 'newTime',
      label: 'Novo horário',
      type: 'time',
      default: '12:00',
      showWhen: { field: 'action', equals: 'edit' },
    },
  ],
  canvasTemplate: [
    {
      label: 'Alvo',
      title: 'Tarefas afetadas',
      detailTemplate:
        'Ação: {action} · Modo: {mode} · Execução: {runId} · Planejadas para: {plannedDate} · Tipo: {searchTaskType} · ' +
        'Atribuída a: {searchAssignedUserId} · Texto contém: {searchTextContains} · Só sem: {onlyMissing}',
    },
    {
      label: 'Mudança',
      title: 'Novo tipo/data (se Ação = editar)',
      detailTemplate: 'Novo tipo: {newTaskType} · Nova data: {newDate} {newTime}',
    },
  ],
};

const MAX_HISTORY = 30;
const MAX_PAGES = 50;
// Trava de segurança: acima disso o filtro provavelmente tá largo demais pra
// afetar de uma vez sem revisar em partes menores.
const MAX_AFFECTED = 300;

// A API cria a tarefa com o código em maiúsculas (EMAIL, LIGACAO...) mas
// devolve/espera o tipo em PT-BR na listagem de /tasks (testado 15/09/2026).
const TASK_TYPE_DISPLAY = {
  EMAIL: 'Email',
  LIGACAO: 'Ligação',
  REUNIAO: 'Reunião',
  VISITA: 'Visita',
};
const TASK_TYPE_CODE = Object.fromEntries(Object.entries(TASK_TYPE_DISPLAY).map(([code, label]) => [label, code]));

// Única automação que cria tarefa hoje — é de lá que "Desfazer execução" lê o
// histórico.
const SOURCE_AUTOMATION_ID = 'bulk-tasks-by-filter';

function webUrl(kind, id) {
  return kind === 'organizations'
    ? `https://web.agendor.com.br/sistema/empresas/historico.php?id=${id}`
    : `https://web.agendor.com.br/sistema/pessoas/historico.php?id=${id}`;
}

// Mesma regra de `bulkTasksByFilter.js`: modo empresa com alvo "empresas sem
// pessoa" cria a tarefa na empresa; o resto cria na pessoa.
function kindForConfig(config) {
  return config?.source === 'organizations' && config?.orgTarget === 'no-people' ? 'organizations' : 'people';
}

function hasPhone(target) {
  const c = target?.contact;
  return Boolean(c?.work || c?.mobile || c?.whatsapp);
}

function formatDueDate(date) {
  if (!date) return '?';
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export async function getOptions(source) {
  if (source === 'pickableRuns') return computePickableRunOptions();
  if (source === 'users') {
    return cachedOptions('users', async () => (await listUsers()).map((u) => ({ value: String(u.id), label: u.name })));
  }
  throw new Error(`Fonte de opções desconhecida: ${source}`);
}

// Sem cache: a lista de execuções precisa refletir o histórico atual (uma
// tarefa já apagada não pode continuar oferecida pra afetar de novo).
async function computePickableRunOptions() {
  const state = await loadState(SOURCE_AUTOMATION_ID, { runs: [] });
  return state.runs
    .filter((r) => (r.items || []).some((i) => i.ok && i.taskId))
    .map((r) => {
      const count = r.items.filter((i) => i.ok && i.taskId).length;
      const when = new Date(r.ranAt).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const typeLabel = TASK_TYPE_DISPLAY[r.config?.taskType] || r.config?.taskType || '?';
      const text = (r.config?.taskText || '').slice(0, 50);
      return { value: r.ranAt, label: `${when} · ${count} de ${typeLabel} · "${text}"` };
    });
}

export async function getState() {
  return loadState(meta.id, { runs: [] });
}

// Candidatos a afetar: [{ taskId, kind, targetId, name, link, typeCode,
// typeDisplay, dueDate (Date|null), text, assignedUsers (number[]) }]
async function collectCandidates(config) {
  if (config.mode === 'history') {
    if (!config.runId) throw new Error('Escolha qual execução usar.');
    const state = await loadState(SOURCE_AUTOMATION_ID, { runs: [] });
    const run = state.runs.find((r) => r.ranAt === config.runId);
    if (!run) {
      throw new Error('Essa execução não existe mais no histórico (só ficam as 30 mais recentes de "Tarefas em massa por filtro").');
    }
    const kind = kindForConfig(run.config);
    const dueDate = new Date(`${run.config.dueDate}T${run.config.dueTime}:00-03:00`);
    const candidates = (run.items || [])
      .filter((i) => i.ok && i.taskId)
      .map((i) => ({
        taskId: i.taskId,
        kind,
        targetId: i.targetId,
        name: i.name,
        link: i.link || webUrl(kind, i.targetId),
        typeCode: run.config.taskType,
        typeDisplay: TASK_TYPE_DISPLAY[run.config.taskType] || run.config.taskType,
        dueDate,
        text: run.config.taskText,
        assignedUsers: [Number(run.config.assignedUserId)],
      }));
    return { candidates, scannedCount: candidates.length };
  }

  if (config.mode === 'search') {
    if (!config.plannedDate) throw new Error('Preencha "Planejada para o dia".');
    const start = new Date(`${config.plannedDate}T00:00:00-03:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await listTasksByDueRange({
        dueDateGtISO: start.toISOString(),
        dueDateLtISO: end.toISOString(),
        page,
        perPage: 100,
      });
      all.push(...batch);
      if (batch.length < 100) break;
    }

    const typeFilter = config.searchTaskType ? TASK_TYPE_DISPLAY[config.searchTaskType] : null;
    const textFilter = config.searchTextContains ? config.searchTextContains.trim().toLowerCase() : null;

    // `type` e `assignedUser` são ignorados pelo `/tasks` da API (mesmo padrão
    // de /people e /organizations) — o filtro de verdade é feito aqui.
    let filtered = all.filter((t) => {
      if (t.finishedAt) return false; // nunca mexe em tarefa já concluída
      if (typeFilter && t.type !== typeFilter) return false;
      if (
        config.searchAssignedUserId &&
        !(t.assignedUsers || []).some((u) => String(u.id) === String(config.searchAssignedUserId))
      ) {
        return false;
      }
      if (textFilter && !String(t.text || '').toLowerCase().includes(textFilter)) return false;
      return true;
    });

    if (config.onlyMissing === 'missingEmail') {
      // O e-mail já vem na listagem de /tasks (organization.email / person.email).
      filtered = filtered.filter((t) => {
        const target = t.organization || t.person;
        return Boolean(target) && !target.email;
      });
    } else if (config.onlyMissing === 'missingPhone') {
      // Telefone não vem na listagem — busca o cadastro completo só de quem
      // sobrou depois dos outros filtros, e só uma vez por empresa/pessoa
      // repetida em várias tarefas.
      const cache = new Map();
      const checked = await Promise.all(
        filtered.map(async (t) => {
          const isOrg = Boolean(t.organization);
          const target = t.organization || t.person;
          if (!target) return [t, false];
          const cacheKey = `${isOrg ? 'org' : 'person'}:${target.id}`;
          if (!cache.has(cacheKey)) {
            const full = isOrg ? await getOrganization(target.id) : await getPerson(target.id);
            cache.set(cacheKey, hasPhone(full));
          }
          return [t, cache.get(cacheKey)];
        })
      );
      filtered = checked.filter(([, has]) => !has).map(([t]) => t);
    }

    const candidates = filtered.map((t) => {
      const isOrg = Boolean(t.organization);
      const target = t.organization || t.person;
      const kind = isOrg ? 'organizations' : 'people';
      return {
        taskId: t.id,
        kind,
        targetId: target?.id,
        name: target?.name || '(sem empresa/pessoa vinculada)',
        link: target ? webUrl(kind, target.id) : null,
        typeCode: TASK_TYPE_CODE[t.type] || null,
        typeDisplay: t.type,
        dueDate: t.dueDate ? new Date(t.dueDate) : null,
        text: t.text,
        assignedUsers: (t.assignedUsers || []).map((u) => u.id),
      };
    });

    return { candidates, scannedCount: all.length };
  }

  throw new Error(`Modo desconhecido: ${config.mode}`);
}

export async function preview(config) {
  const { candidates, scannedCount } = await collectCandidates(config);
  return {
    count: candidates.length,
    scannedCount,
    sample: candidates
      .slice(0, 15)
      .map((c) => `${c.name} — ${c.typeDisplay || '?'} (${formatDueDate(c.dueDate)})`),
  };
}

export async function run({ log = () => {}, config }) {
  const { candidates } = await collectCandidates(config);

  if (candidates.length === 0) {
    log('Nada casa com esse filtro.');
  }
  if (candidates.length > MAX_AFFECTED) {
    throw new Error(
      `${candidates.length} tarefas casam com o filtro — acima do limite de segurança (${MAX_AFFECTED}). Estreite o filtro (data, tipo, responsável ou texto) antes de rodar.`
    );
  }
  if (config.action === 'edit' && !config.newTaskType && !config.newDate) {
    throw new Error('Preencha "Novo tipo de tarefa" e/ou "Nova data de vencimento" — sem um dos dois não há o que mudar.');
  }

  const verb = config.action === 'edit' ? 'atualizadas' : 'apagadas';
  log(`${candidates.length} tarefa(s) vão ser ${verb}.`);

  let affected = 0;
  const errors = [];
  const items = [];

  for (const c of candidates) {
    try {
      if (config.action === 'edit') {
        const newDueDate = config.newDate ? new Date(`${config.newDate}T${config.newTime || '12:00'}:00-03:00`) : c.dueDate;
        if (!newDueDate) {
          throw Object.assign(new Error('tarefa sem data de vencimento e nenhuma nova data foi informada'), { status: '', body: '' });
        }
        const newType = config.newTaskType || c.typeCode;
        if (!newType) {
          throw Object.assign(new Error('não consegui identificar o tipo atual da tarefa pra manter — informe um novo tipo'), {
            status: '',
            body: '',
          });
        }
        const payload = { text: c.text, dueDate: newDueDate, assignedUsers: c.assignedUsers, type: newType };
        if (c.kind === 'organizations') {
          await updateOrganizationTask({ organizationId: c.targetId, taskId: c.taskId, ...payload });
        } else {
          await updatePersonTask({ personId: c.targetId, taskId: c.taskId, ...payload });
        }
        log(`  -> atualizada: tarefa ${c.taskId} de "${c.name}"`);
      } else {
        if (c.kind === 'organizations') {
          await deleteOrganizationTask({ organizationId: c.targetId, taskId: c.taskId });
        } else {
          await deletePersonTask({ personId: c.targetId, taskId: c.taskId });
        }
        log(`  -> apagada: tarefa ${c.taskId} de "${c.name}"`);
      }
      affected += 1;
      items.push({ taskId: c.taskId, targetId: c.targetId, name: c.name, link: c.link, ok: true });
    } catch (err) {
      const message = `ERRO em "${c.name}" (tarefa ${c.taskId}): ${err.status ?? ''} ${JSON.stringify(err.body ?? err.message)}`;
      log(`  -> ${message}`);
      errors.push(message);
      items.push({ taskId: c.taskId, targetId: c.targetId, name: c.name, link: c.link, ok: false, error: message });
    }
  }

  log(`\nConcluído. ${affected}/${candidates.length} tarefa(s) ${verb}.`);

  const state = await getState();
  const historyEntry = {
    ranAt: new Date().toISOString(),
    config,
    matchedCount: candidates.length,
    created: affected, // reaproveita o campo que a tabela de histórico genérica já lê
    errorCount: errors.length,
    items,
  };
  const runs = [historyEntry, ...state.runs].slice(0, MAX_HISTORY);
  await saveState(meta.id, { runs });

  return { affected, matchedCount: candidates.length, errors, historyEntry };
}
