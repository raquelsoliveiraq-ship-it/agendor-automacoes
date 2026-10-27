import { listCategories, listUsers, listOrganizations, createPersonTask, createOrganizationTask } from '../agendorClient.js';
import { loadState, saveState } from '../stateStore.js';
import { cachedOptions } from '../optionsCache.js';
import {
  collectContacts as queryContacts,
  collectOrgsWithoutPeople,
  collectOrgsWithEmail,
  collectPhoneTargets,
  hasPhone,
  orgFilterOptions,
  ORG_FILTER_FIELDS,
} from './peopleQuery.js';

export const meta = {
  id: 'bulk-tasks-by-filter',
  name: 'Tarefas em massa por filtro',
  description:
    'Cria uma tarefa igual para todas as pessoas que casam com os filtros escolhidos (por categoria de cliente ou por empresa/região), numa data específica. No modo empresa também dá para criar a tarefa direto na empresa: nas que ainda não têm nenhuma pessoa cadastrada (pra ir atrás do responsável) ou nas que já têm e-mail cadastrado, mesmo com pessoas vinculadas.',
  configurable: true,
  howItWorks: [
    'Quando o tipo é "E-mail", quem não tem e-mail cadastrado (nem na pessoa, nem na empresa) fica de fora: a tarefa não é criada para eles e eles aparecem separados no resultado e no histórico.',
    'Quando o tipo é "Ligação", vale a mesma regra pra quem não tem telefone cadastrado (comercial, celular ou WhatsApp — fax e ramal não contam).',
    'Reunião e Visita não têm essa checagem — todo mundo que casa com o filtro recebe a tarefa.',
    '"Pessoas vinculadas com telefone" e "Empresas e pessoas vinculadas" (em "Criar tarefa para") são pra ligação: juntam empresa e pessoas da empresa que tenham telefone. A primeira evita ligar duas vezes pro mesmo lugar (só manda pra empresa se ninguém vinculado tiver telefone); a segunda manda pros dois sempre que os dois tiverem.',
  ],
  configSchema: [
    {
      name: 'source',
      label: 'Filtrar por',
      type: 'select',
      options: [
        { value: 'organizations', label: 'Empresa / região' },
        { value: 'people', label: 'Categoria de cliente' },
      ],
      default: 'organizations',
      required: true,
      highlight: true,
    },
    {
      // Categoria é cadastrada separadamente na empresa e na pessoa, e podem
      // divergir (ex.: empresa "Cliente efetivo" com uma pessoa dela marcada
      // "Contato Sesc"). Em "Empresa / região" esse filtro olha a categoria da
      // EMPRESA, então uma pessoa com a categoria certa pode ficar de fora se
      // a empresa dela tiver outra.
      name: 'categoryId',
      label: 'Categoria',
      type: 'select',
      optionsSource: 'categories',
      allowEmpty: true,
      emptyLabel: 'Qualquer categoria',
      showWhen: { field: 'source', in: ['people', 'organizations'] },
      hint: 'Em "Empresa / região" filtra a categoria da EMPRESA, não da pessoa — se a pessoa e a empresa dela tiverem categorias diferentes, use "Categoria de cliente" pra filtrar pela categoria da pessoa.',
    },
    {
      name: 'ownerUserId',
      label: 'Responsável',
      type: 'select',
      optionsSource: 'users',
      allowEmpty: true,
      emptyLabel: 'Qualquer responsável',
      showWhen: { field: 'source', in: ['people', 'organizations'] },
    },
    {
      // Cargo é texto livre no cadastro (105 variações na conta), mas a API
      // casa `role` por prefixo/substring — então "Analista Cultura" pega
      // também "Analista Cultura (Teatro)", "Analista Cultura (Música)" etc.
      // Lista fixa com os cargos SESC que a Raquel usa pra filtrar (sem
      // endpoint de cargos na API, igual à Cidade).
      name: 'role',
      label: 'Cargo',
      type: 'select',
      options: [
        { value: 'Analista Cultura', label: 'Analista Cultura' },
        { value: 'Analista Ambiental', label: 'Analista Ambiental' },
        { value: 'Analista Educação', label: 'Analista Educação' },
        { value: 'Analista Social', label: 'Analista Social' },
        { value: 'Analista Saúde', label: 'Analista Saúde' },
      ],
      allowEmpty: true,
      emptyLabel: 'Qualquer cargo',
      showWhen: { field: 'source', in: ['people', 'organizations'] },
    },
    {
      name: 'organizationId',
      label: 'Empresa',
      type: 'autocomplete',
      optionsSource: 'organizations',
      allowEmpty: true,
      emptyLabel: 'Qualquer empresa',
      showWhen: { field: 'source', equals: 'people' },
    },
    // Filtros do modo "Empresa / região" (origem, setor, estado, cidade,
    // produto). Filtram as empresas; a tarefa vai para as pessoas delas.
    ...ORG_FILTER_FIELDS,
    {
      name: 'orgTarget',
      label: 'Criar tarefa para',
      type: 'select',
      options: [
        { value: 'no-people', label: 'Empresas que ainda não têm nenhuma pessoa cadastrada' },
        { value: 'with-email', label: 'Empresas que têm e-mail cadastrado (mesmo com pessoas vinculadas)' },
        {
          value: 'phone-coverage',
          label: 'Pessoas vinculadas com telefone (empresa só entra se ninguém vinculado tiver telefone)',
        },
        { value: 'phone-both', label: 'Empresas e pessoas vinculadas, sempre que os dois tiverem telefone' },
        { value: 'people', label: 'Pessoas das empresas filtradas' },
      ],
      default: 'no-people',
      required: true,
      highlight: true,
      showWhen: { field: 'source', equals: 'organizations' },
    },
    { name: 'dueDate', label: 'Data de vencimento', type: 'date', required: true, highlight: true },
    { name: 'dueTime', label: 'Horário', type: 'time', default: '12:00', required: true, highlight: true },
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
      highlight: true,
    },
    { name: 'taskText', label: 'Texto da tarefa', type: 'text', required: true },
    {
      name: 'assignedUserId',
      label: 'Atribuir tarefa para',
      type: 'select',
      optionsSource: 'users',
      required: true,
      highlight: true,
    },
  ],
  canvasTemplate: [
    {
      label: 'Filtro',
      title: 'Pessoas que casam com',
      detailTemplate:
        'Fonte: {source} · Alvo: {orgTarget} · Categoria: {categoryId} · Cargo: {role} · Responsável: {ownerUserId} · Empresa: {organizationId} · ' +
        'Origem: {leadOriginId} · Setor: {sectorId} · Estado: {stateUf} · Cidade: {cityName} · Produto: {productId}',
    },
    {
      label: 'Ação',
      title: 'Criar tarefa em massa',
      detailTemplate: 'Tipo: {taskType} · Vencimento: {dueDate} {dueTime} · Atribuída a: {assignedUserId} · Texto: "{taskText}"',
    },
  ],
};

const MAX_PAGES = 50;
const MAX_HISTORY = 30;

export function getOptions(source) {
  return cachedOptions(source, () => computeOptions(source));
}

async function computeOptions(source) {
  const org = await orgFilterOptions(source); // leadOrigins / sectors / products
  if (org) return org;

  if (source === 'categories') {
    return (await listCategories()).map((c) => ({ value: String(c.id), label: c.name }));
  }
  if (source === 'users') {
    return (await listUsers()).map((u) => ({ value: String(u.id), label: u.name }));
  }
  if (source === 'organizations') {
    return (await listOrganizations()).map((o) => ({ value: String(o.id), label: o.name }));
  }
  throw new Error(`Fonte de opções desconhecida: ${source}`);
}

// Devolve { kind, targets }, onde targets é sempre [{ id, name, ... }]:
//   kind 'people'        — tarefa por pessoa (POST /people/{id}/tasks).
//   kind 'organizations' — tarefa por empresa (POST /organizations/{id}/tasks).
//   kind 'mixed'         — os dois casos no mesmo lote; cada item carrega seu
//                          próprio `_kind` ('people' ou 'organizations').
//
// 'people' (categoria) e o modo empresa com alvo "pessoas" caem no primeiro
// caso. "Empresas sem pessoa" ou "empresas com e-mail" caem no segundo: filtra
// as empresas e a tarefa vai direto pra elas. "phone-coverage"/"phone-both"
// caem no terceiro: juntam empresa e pessoas vinculadas com telefone.
async function collectTargets(config) {
  if (config.source === 'organizations' && config.orgTarget === 'no-people') {
    const orgs = await collectOrgsWithoutPeople(config, { maxPages: MAX_PAGES });
    return { kind: 'organizations', targets: orgs };
  }
  if (config.source === 'organizations' && config.orgTarget === 'with-email') {
    const orgs = await collectOrgsWithEmail(config, { maxPages: MAX_PAGES });
    return { kind: 'organizations', targets: orgs };
  }
  if (config.source === 'organizations' && (config.orgTarget === 'phone-coverage' || config.orgTarget === 'phone-both')) {
    const { people, orgs } = await collectPhoneTargets(config, { maxPages: MAX_PAGES, orgTarget: config.orgTarget });
    const targets = [
      ...people.map((p) => ({ ...p, _kind: 'people' })),
      ...orgs.map((o) => ({ ...o, _kind: 'organizations' })),
    ];
    return { kind: 'mixed', targets };
  }
  const { people } = await queryContacts(config, { maxPages: MAX_PAGES });
  return { kind: 'people', targets: people };
}

function buildDueDate(config) {
  return new Date(`${config.dueDate}T${config.dueTime}:00-03:00`);
}

// Mesma regra de e-mail usada nos rascunhos (peopleQuery.js): contato/empresa
// tem e-mail quando `contact.email` (pessoa) ou `email` (fallback/empresa)
// está preenchido.
function hasEmail(target) {
  return Boolean(target.contact?.email || target.email);
}

// Só esses dois tipos de tarefa exigem um jeito específico de contato pra
// fazer sentido (sem e-mail não tem pra onde mandar; sem telefone não tem pra
// onde ligar). Reunião e Visita são presenciais e não entram aqui.
const REQUIRED_CONTACT_BY_TASK_TYPE = {
  EMAIL: { check: hasEmail, label: 'e-mail' },
  LIGACAO: { check: hasPhone, label: 'telefone' },
};

// Separa quem entra na criação (tem o contato exigido pelo tipo de tarefa) de
// quem fica de fora, e por quê. Tipos sem regra (Reunião, Visita) não filtram
// nada — todo mundo casa.
function splitByRequiredContact(config, targets) {
  const rule = REQUIRED_CONTACT_BY_TASK_TYPE[config.taskType];
  if (!rule) return { ready: targets, missing: [], label: null };
  return {
    ready: targets.filter(rule.check),
    missing: targets.filter((t) => !rule.check(t)),
    label: rule.label,
  };
}

export async function getState() {
  return loadState(meta.id, { runs: [] });
}

export async function preview(config) {
  const { kind, targets } = await collectTargets(config);
  const { ready, missing, label } = splitByRequiredContact(config, targets);
  return {
    matchedCount: targets.length,
    kind,
    sample: targets.slice(0, 10).map((t) => t.name),
    missingCount: label ? missing.length : undefined,
    missingLabel: label,
    missing: label ? missing.slice(0, 20).map((t) => ({ name: t.name, link: t._webUrl || null })) : undefined,
    readyCount: label ? ready.length : undefined,
  };
}

export async function run({ log = () => {}, config }) {
  if (!config?.dueDate || !config?.dueTime || !config?.taskText || !config?.assignedUserId) {
    throw new Error('Preencha data, horário, texto da tarefa e responsável antes de rodar.');
  }

  const { kind, targets } = await collectTargets(config);
  const unit =
    kind === 'organizations'
      ? config.orgTarget === 'with-email'
        ? 'empresa(s) com e-mail cadastrado'
        : 'empresa(s) sem pessoa cadastrada'
      : kind === 'mixed'
        ? 'empresa(s)/pessoa(s) com telefone cadastrado'
        : 'pessoa(s)';
  // No alvo "mixed" (phone-coverage/phone-both) cada item já sabe se é
  // empresa ou pessoa (`_kind`); nos outros alvos o lote inteiro é de um
  // tipo só, então usa o `kind` do lote.
  const nounFor = (target) => ((target._kind || kind) === 'organizations' ? 'empresa' : 'pessoa');
  log(`Encontradas ${targets.length} ${unit} com os filtros selecionados.`);

  const { ready, missing, label } = splitByRequiredContact(config, targets);
  if (label && missing.length) {
    log(`${missing.length} sem ${label} cadastrado — não vão receber tarefa.`);
  }

  const dueDate = buildDueDate(config);
  const assignedUsers = [Number(config.assignedUserId)];
  const type = config.taskType || 'EMAIL';
  let created = 0;
  const errors = [];
  const items = [];

  for (const target of missing) {
    const noun = nounFor(target);
    const message = `SEM ${label.toUpperCase()}: "${target.name}" (${noun} ${target.id}) não tem ${label} cadastrado — tarefa não criada.`;
    log(`  -> ${message}`);
    items.push({ targetId: target.id, name: target.name, link: target._webUrl || null, ok: false, skipped: true, error: message });
  }

  for (const target of ready) {
    const noun = nounFor(target);
    try {
      const task =
        noun === 'empresa'
          ? await createOrganizationTask({ organizationId: target.id, text: config.taskText, dueDate, assignedUsers, type })
          : await createPersonTask({ personId: target.id, text: config.taskText, dueDate, assignedUsers, type });
      log(`  -> tarefa ${task.id} criada para "${target.name}" (${noun} ${target.id})`);
      created += 1;
      items.push({ taskId: task.id, targetId: target.id, name: target.name, link: target._webUrl || null, ok: true });
    } catch (err) {
      const message = `ERRO ao criar tarefa para "${target.name}" (${noun} ${target.id}): ${err.status ?? ''} ${JSON.stringify(err.body ?? err.message)}`;
      log(`  -> ${message}`);
      errors.push(message);
      items.push({ targetId: target.id, name: target.name, link: target._webUrl || null, ok: false, error: message });
    }
  }

  log(`\nConcluído. ${created}/${targets.length} tarefa(s) criada(s).`);

  const state = await getState();
  const historyEntry = {
    ranAt: new Date().toISOString(),
    config,
    matchedCount: targets.length,
    created,
    errorCount: errors.length,
    skippedCount: missing.length,
    skippedLabel: label,
    items,
  };
  const runs = [historyEntry, ...state.runs].slice(0, MAX_HISTORY);
  await saveState(meta.id, { runs });

  return { created, matchedCount: targets.length, errors, historyEntry };
}
