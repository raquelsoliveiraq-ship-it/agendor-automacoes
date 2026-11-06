import {
  listCategories,
  listUsers,
  listOrganizations,
  listDealStages,
  listDealsByStage,
  listTasksByDueRange,
  getPerson,
  getOrganization,
} from '../agendorClient.js';
import { loadState, saveState } from '../stateStore.js';
import { cachedOptions } from '../optionsCache.js';
import { collectContacts as queryContacts, orgFilterOptions, ORG_FILTER_FIELDS } from './peopleQuery.js';

export const meta = {
  id: 'email-drafts',
  name: 'Rascunhos de e-mail',
  description:
    'Monta um e-mail pronto para cada contato, filtrando por categoria de cliente, por empresa/região ou por etapa do funil. Não envia nada: devolve os textos para copiar ou abrir no Gmail.',
  configurable: true,
  resultView: 'drafts',
  formTitle: 'Filtros e conteúdo do e-mail',
  // Campos que um modelo salvo preenche. Os filtros ficam de fora de propósito:
  // o mesmo texto serve para categorias e empresas diferentes.
  templateFields: ['subjectTemplate', 'bodyTemplate'],
  howItWorks: [
    'A estimativa em destaque, entre os filtros e o modelo de e-mail, se recalcula sozinha enquanto você mexe nos campos: o círculo fica girando enquanto a filtragem não terminou e depois mostra quantos contatos o filtro pega e quantos têm e-mail.',
    'Rodar agora: monta um rascunho por contato com e-mail e mostra o resumo do que encontrou logo abaixo, no bloco "Rascunhos prontos".',
    '"Tarefas planejadas para um dia": pega as tarefas ainda não concluídas com vencimento naquele dia (dá pra afinar por tipo, responsável, texto e categoria da empresa) e monta o rascunho para a empresa ou pessoa de cada tarefa. "Para quem enviar" vale igual ao modo Empresa / região.',
    'Nada é enviado e nada é criado no Agendor. Os e-mails só saem quando você abre cada rascunho e clica em enviar.',
    'Os rascunhos ficam só nesta sessão do navegador: ao recarregar a página eles somem e é preciso rodar de novo. O histórico de execuções (só os números) fica salvo.',
  ],
  configSchema: [
    {
      name: 'source',
      label: 'Filtrar por',
      type: 'select',
      options: [
        { value: 'people', label: 'Categoria de cliente' },
        { value: 'organizations', label: 'Empresa / região' },
        { value: 'deals', label: 'Etapa do funil de vendas' },
        { value: 'tasks', label: 'Tarefas planejadas para um dia' },
      ],
      default: 'people',
      required: true,
    },
    {
      name: 'categoryId',
      label: 'Categoria',
      type: 'select',
      optionsSource: 'categories',
      allowEmpty: true,
      emptyLabel: 'Qualquer categoria',
      showWhen: { field: 'source', in: ['people', 'organizations', 'tasks'] },
      hint: 'Em "Tarefas planejadas para um dia" vale a categoria da empresa (ou da pessoa, quando a tarefa está direto numa pessoa).',
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
      // Mesma lista fixa de "Tarefas em massa" (sem endpoint de cargos na API).
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
    // Filtros do modo "Empresa / região" (origem, setor, estado, cidade,
    // produto). Filtram as empresas; a automação depois pega as pessoas delas.
    ...ORG_FILTER_FIELDS,
    {
      name: 'orgRecipient',
      label: 'Para quem enviar',
      type: 'select',
      options: [
        { value: 'contact', label: 'Contato da empresa (e a empresa, se não tiver contato)' },
        { value: 'company', label: 'E-mail da empresa (sempre)' },
        { value: 'both', label: 'Contato e e-mail da empresa' },
      ],
      default: 'contact',
      required: true,
      showWhen: { field: 'source', in: ['organizations', 'tasks'] },
    },
    {
      name: 'taskDate',
      label: 'Tarefas planejadas para o dia',
      type: 'date',
      required: true,
      showWhen: { field: 'source', equals: 'tasks' },
    },
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
      allowEmpty: true,
      emptyLabel: 'Qualquer tipo',
      showWhen: { field: 'source', equals: 'tasks' },
    },
    {
      name: 'taskAssignedUserId',
      label: 'Tarefa atribuída a',
      type: 'select',
      optionsSource: 'users',
      allowEmpty: true,
      emptyLabel: 'Qualquer responsável',
      showWhen: { field: 'source', equals: 'tasks' },
    },
    {
      name: 'taskTextContains',
      label: 'Texto da tarefa contém',
      type: 'text',
      showWhen: { field: 'source', equals: 'tasks' },
    },
    {
      name: 'dealStageId',
      label: 'Etapa do funil',
      type: 'select',
      optionsSource: 'dealStages',
      required: true,
      showWhen: { field: 'source', equals: 'deals' },
    },
    {
      name: 'dealStatusId',
      label: 'Situação do negócio',
      type: 'select',
      options: [
        { value: '1', label: 'Em andamento' },
        { value: '2', label: 'Ganho' },
        { value: '3', label: 'Perdido' },
      ],
      default: '1',
      allowEmpty: true,
      emptyLabel: 'Qualquer situação',
      showWhen: { field: 'source', equals: 'deals' },
    },
    { name: 'subjectTemplate', label: 'Assunto', type: 'text', required: true, default: 'Retomando nosso contato' },
    {
      name: 'bodyTemplate',
      label: 'Corpo do e-mail',
      type: 'richtext',
      required: true,
      default: 'Olá, {primeiroNome}!\n\nEstou retomando o contato para saber como você está.\n\nFico à disposição.\n\nAbraço,',
    },
  ],
  canvasTemplate: [
    {
      label: 'Filtro',
      title: 'Contatos selecionados',
      detailTemplate:
        'Fonte: {source} · Categoria: {categoryId} · Cargo: {role} · Responsável: {ownerUserId} · Empresa: {organizationId} · ' +
        'Origem: {leadOriginId} · Setor: {sectorId} · Estado: {stateUf} · Cidade: {cityName} · Produto: {productId} · ' +
        'Etapa: {dealStageId} · Situação: {dealStatusId} · Tarefas do dia: {taskDate} · Tipo da tarefa: {taskType}',
    },
    {
      label: 'Ação',
      title: 'Montar rascunho de e-mail',
      detailTemplate: 'Assunto: "{subjectTemplate}" · Um rascunho por contato que tenha e-mail cadastrado',
    },
  ],
  // Placeholders aceitos no assunto e no corpo. Os que não se aplicam à fonte
  // escolhida saem como travessão em vez de quebrar o texto.
  placeholders: ['{nome}', '{primeiroNome}', '{empresa}', '{responsavel}', '{categoria}', '{titulo}', '{valor}', '{etapa}'],
};

const MAX_PAGES = 20;
const PER_PAGE = 100;
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
  if (source === 'dealStages') {
    // O nome do funil entra no rótulo porque a conta pode ter mais de um funil
    // com etapas de mesmo nome.
    return (await listDealStages()).map((s) => ({
      value: String(s.id),
      label: `${s.funnel?.name ?? 'Funil'} › ${s.name}`,
    }));
  }
  throw new Error(`Fonte de opções desconhecida: ${source}`);
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function firstName(name) {
  if (!name) return '';
  return String(name).trim().split(/\s+/)[0];
}

function interpolate(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

// Cada candidato vira este formato antes de virar rascunho, para que as duas
// fontes (pessoas e negócios) sigam o mesmo caminho daqui pra frente.
function candidateFromPerson(person) {
  return {
    key: `person:${person.id}`,
    name: person.name,
    email: person.contact?.email || person.email || null,
    link: person._webUrl || null,
    subtitle: person.organization?.name || person.role || '',
    values: {
      nome: person.name || '—',
      primeiroNome: firstName(person.name) || 'tudo bem',
      empresa: person.organization?.name || '—',
      responsavel: person.ownerUser?.name || '—',
      categoria: person.category?.name || '—',
      titulo: '—',
      valor: '—',
      etapa: '—',
    },
  };
}

function candidateFromDeal(deal, contactName, email) {
  return {
    key: `deal:${deal.id}`,
    name: contactName,
    email,
    link: deal._webUrl || null,
    subtitle: deal.title || '',
    values: {
      nome: contactName || '—',
      primeiroNome: firstName(contactName) || 'tudo bem',
      empresa: deal.organization?.name || '—',
      responsavel: deal.owner?.name || '—',
      categoria: '—',
      titulo: deal.title || '—',
      valor: formatValue(deal.value),
      etapa: deal.dealStage?.name || '—',
    },
  };
}

// Rascunho para o e-mail da própria empresa, com o nome dela.
// `{primeiroNome}` vira "pessoal" ("Olá, pessoal!"), já que não há uma pessoa.
function candidateFromOrg(org) {
  return {
    key: `org:${org.id}`,
    name: org.name,
    email: org.contact?.email || org.email || null,
    link: org._webUrl || null,
    subtitle: 'E-mail da empresa',
    values: {
      nome: org.name || '—',
      primeiroNome: 'pessoal',
      empresa: org.name || '—',
      responsavel: org.ownerUser?.name || '—',
      categoria: org.category?.name || '—',
      titulo: '—',
      valor: '—',
      etapa: '—',
    },
  };
}

// Modos 'people' e 'organizations' saem daqui (ver src/automations/peopleQuery.js).
// No modo 'organizations', `orgRecipient` decide se o destino é o contato, o
// e-mail da empresa, ou os dois.
async function collectPeople(config) {
  const { people, orgs } = await queryContacts(config, {
    maxPages: MAX_PAGES,
    orgRecipient: config.orgRecipient || 'contact',
  });
  return [...people.map(candidateFromPerson), ...orgs.map(candidateFromOrg)];
}

// O negócio traz person/organization resumidos, sem e-mail. O contato completo
// só vem no GET individual, então busca uma vez por id e reaproveita.
async function collectDeals(config) {
  const deals = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await listDealsByStage({
      dealStageId: config.dealStageId,
      dealStatusId: config.dealStatusId,
      page,
      perPage: PER_PAGE,
    });
    deals.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  const cache = new Map();
  const candidates = [];
  for (const deal of deals) {
    const ref = deal.person
      ? { kind: 'person', id: deal.person.id, name: deal.person.name }
      : deal.organization
        ? { kind: 'organization', id: deal.organization.id, name: deal.organization.name }
        : null;

    if (!ref) {
      candidates.push(candidateFromDeal(deal, null, null));
      continue;
    }

    const cacheKey = `${ref.kind}:${ref.id}`;
    if (!cache.has(cacheKey)) {
      const full = ref.kind === 'person' ? await getPerson(ref.id) : await getOrganization(ref.id);
      cache.set(cacheKey, full?.contact?.email || full?.email || null);
    }
    candidates.push(candidateFromDeal(deal, ref.name, cache.get(cacheKey)));
  }
  return candidates;
}

// Tarefas planejadas para um dia (ainda não concluídas). A listagem de /tasks só
// filtra de verdade por data; tipo, responsável e texto são filtrados aqui.
// Cada tarefa está numa empresa OU numa pessoa. O cadastro completo (categoria e
// e-mail) só vem no GET individual, então busca uma vez por id, poucos por vez.
const TASK_TYPE_DISPLAY = { EMAIL: 'Email', LIGACAO: 'Ligação', REUNIAO: 'Reunião', VISITA: 'Visita' };

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function collectTasks(config) {
  if (!config.taskDate) throw new Error('Escolha o dia das tarefas.');
  const start = new Date(`${config.taskDate}T00:00:00-03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await listTasksByDueRange({
      dueDateGtISO: start.toISOString(),
      dueDateLtISO: end.toISOString(),
      page,
      perPage: PER_PAGE,
    });
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  const typeFilter = config.taskType ? TASK_TYPE_DISPLAY[config.taskType] : null;
  const textFilter = config.taskTextContains ? config.taskTextContains.trim().toLowerCase() : null;
  const tasks = all.filter((t) => {
    if (t.finishedAt) return false;
    if (!t.organization && !t.person) return false;
    if (typeFilter && t.type !== typeFilter) return false;
    if (
      config.taskAssignedUserId &&
      !(t.assignedUsers || []).some((u) => String(u.id) === String(config.taskAssignedUserId))
    ) {
      return false;
    }
    if (textFilter && !String(t.text || '').toLowerCase().includes(textFilter)) return false;
    return true;
  });

  // Alvos únicos: a mesma empresa pode ter mais de uma tarefa no dia.
  const refs = new Map();
  for (const t of tasks) {
    const kind = t.organization ? 'org' : 'person';
    refs.set(`${kind}:${(t.organization || t.person).id}`, { kind, id: (t.organization || t.person).id });
  }
  const fulls = await mapLimit([...refs.values()], 5, async (r) => ({
    kind: r.kind,
    data: r.kind === 'org' ? await getOrganization(r.id) : await getPerson(r.id),
  }));

  const orgRecipient = config.orgRecipient || 'contact';
  const candidates = [];
  for (const { kind, data } of fulls) {
    if (config.categoryId && String(data.category?.id) !== String(config.categoryId)) continue;
    if (kind === 'person') {
      candidates.push(candidateFromPerson(data));
      continue;
    }
    const orgCandidate = candidateFromOrg(data);
    // `people` da empresa já traz id, nome e e-mail de cada contato.
    const contacts = (data.people || []).map((p) => ({
      ...orgCandidate,
      key: `person:${p.id}`,
      name: p.name,
      email: p.email || null,
      subtitle: data.name,
      values: { ...orgCandidate.values, nome: p.name || '—', primeiroNome: firstName(p.name) || 'tudo bem' },
    }));
    if (orgRecipient === 'company') {
      candidates.push(orgCandidate);
    } else if (orgRecipient === 'both') {
      candidates.push(...contacts);
      if (orgCandidate.email) candidates.push(orgCandidate);
    } else {
      const withEmail = contacts.filter((c) => c.email);
      candidates.push(...(withEmail.length ? withEmail : [orgCandidate]));
    }
  }
  return candidates;
}

async function collect(config) {
  const candidates =
    config.source === 'deals'
      ? await collectDeals(config)
      : config.source === 'tasks'
        ? await collectTasks(config)
        : await collectPeople(config);
  const ready = candidates.filter((c) => c.email);
  const missingEmail = candidates
    .filter((c) => !c.email)
    .map((c) => ({ name: c.name, subtitle: c.subtitle, link: c.link }));
  return { candidates, ready, missingEmail };
}

// O corpo vira HTML quando a pessoa colou um e-mail formatado (imagem, arte,
// links) no editor; texto simples continua sendo texto simples.
const HTML_TAG = /<[a-z][\s\S]*>/i;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Versão em texto do HTML, para o CSV e para o link do Gmail (que só leva texto).
function htmlToText(html) {
  return String(html)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildDraft(candidate, config) {
  const subject = interpolate(config.subjectTemplate, candidate.values);
  const isHtml = HTML_TAG.test(config.bodyTemplate);
  // No HTML os valores entram escapados, para um nome com "&" não quebrar a marcação.
  const bodyHtml = isHtml
    ? interpolate(
        config.bodyTemplate,
        Object.fromEntries(Object.entries(candidate.values).map(([k, v]) => [k, escapeHtml(v)])),
      )
    : null;
  const body = isHtml ? htmlToText(bodyHtml) : interpolate(config.bodyTemplate, candidate.values);

  // Abre a janela de escrita do Gmail já preenchida. Assunto e corpo viajam na
  // URL, então textos muito longos podem ser cortados pelo navegador — daí o
  // botão de copiar ao lado, que nunca corta. A URL só leva texto: com corpo em
  // HTML ele fica de fora e a tela copia o corpo formatado para colar no Gmail.
  // Com corpo em HTML, a URL leva a versão em texto (sem imagem/formatação) para
  // o Gmail já abrir preenchido; a tela ainda copia a versão formatada para
  // colar por cima. Textos longos demais ficam de fora para a URL não estourar.
  const encodedBody = encodeURIComponent(body);
  const textInUrl = encodedBody.length <= 6000;
  const gmailUrl =
    'https://mail.google.com/mail/?view=cm&fs=1&tf=cm' +
    `&to=${encodeURIComponent(candidate.email)}` +
    `&su=${encodeURIComponent(subject)}` +
    (textInUrl ? `&body=${encodedBody}` : '');

  return {
    key: candidate.key,
    contactName: candidate.name,
    subtitle: candidate.subtitle,
    link: candidate.link,
    email: candidate.email,
    subject,
    body,
    bodyHtml,
    textInUrl,
    gmailUrl,
  };
}

function validate(config) {
  if (!config?.subjectTemplate || !config?.bodyTemplate) {
    throw new Error('Preencha o assunto e o corpo do e-mail.');
  }
  if (config.source === 'deals' && !config.dealStageId) {
    throw new Error('Escolha a etapa do funil.');
  }
  if (config.source === 'tasks' && !config.taskDate) {
    throw new Error('Escolha o dia das tarefas.');
  }
}

export async function getState() {
  return loadState(meta.id, { runs: [] });
}

export async function preview(config) {
  if (config?.source === 'deals' && !config.dealStageId) {
    throw new Error('Escolha a etapa do funil antes de pré-visualizar.');
  }
  if (config?.source === 'tasks' && !config.taskDate) {
    throw new Error('Escolha o dia das tarefas antes de pré-visualizar.');
  }
  const { candidates, ready, missingEmail } = await collect(config);
  return {
    matchedCount: candidates.length,
    readyCount: ready.length,
    missingEmailCount: missingEmail.length,
    sample: ready.slice(0, 10).map((c) => c.name),
    missingEmail: missingEmail.slice(0, 20),
  };
}

export async function run({ log = () => {}, config }) {
  validate(config);

  const unit = config.source === 'deals' ? 'negócio(s)' : 'pessoa(s)';
  const { candidates, ready, missingEmail } = await collect(config);
  log(`Encontrados ${candidates.length} ${unit} com os filtros selecionados.`);
  log(`${ready.length} com e-mail no cadastro, ${missingEmail.length} sem e-mail.`);

  const drafts = ready.map((candidate) => buildDraft(candidate, config));
  for (const draft of drafts) {
    log(`  -> rascunho para ${draft.contactName} <${draft.email}>`);
  }

  if (missingEmail.length) {
    log('\nSem e-mail no cadastro (preencha no Agendor para entrarem na próxima rodada):');
    for (const item of missingEmail) {
      log(`  -> ${item.name || 'sem contato vinculado'}${item.subtitle ? ` — ${item.subtitle}` : ''}`);
    }
  }

  log(`\nConcluído. ${drafts.length} rascunho(s) montado(s). Nada foi enviado.`);

  const state = await getState();
  const ranAt = new Date().toISOString();
  const historyEntry = {
    ranAt,
    config,
    matchedCount: candidates.length,
    draftCount: drafts.length,
    missingEmailCount: missingEmail.length,
  };

  // Só o resumo de cada rodada é guardado (para o histórico). Os rascunhos em si
  // ficam só na tela desta sessão: ao recarregar a página eles somem, e é
  // preciso rodar de novo. Assim ninguém abre o dashboard e vê rascunhos de
  // dias atrás achando que são de agora.
  await saveState(meta.id, {
    runs: [historyEntry, ...state.runs].slice(0, MAX_HISTORY),
  });

  return { drafts, missingEmail, matchedCount: candidates.length, ranAt };
}
