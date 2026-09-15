const BASE_URL = 'https://api.agendor.com.br/v3';

const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// As automações fazem muitos requests seguidos (listar empresas + pessoas), e a
// tela ainda recalcula a estimativa a cada mexida no filtro. A API às vezes
// responde 429 — aqui a gente espera e tenta de novo em vez de falhar.
async function request(path, options = {}, attempt = 1) {
  const token = process.env.AGENDOR_TOKEN;
  if (!token) throw new Error('AGENDOR_TOKEN não definido no .env');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 429 && attempt <= MAX_RETRIES) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000;
    await sleep(waitMs);
    return request(path, options, attempt + 1);
  }

  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }

  if (!res.ok) {
    const err = new Error(`Agendor API ${options.method || 'GET'} ${path} -> ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

export async function listCategories() {
  const body = await request('/categories');
  return body.data;
}

export async function listLeadOrigins() {
  const body = await request('/lead_origins');
  return body.data;
}

export async function listSectors() {
  const body = await request('/sectors');
  return body.data;
}

export async function listProducts() {
  const body = await request('/products');
  return body.data;
}

export async function getCurrentUser() {
  const body = await request('/users/me');
  return body.data;
}

export async function listUsers() {
  const body = await request('/users?per_page=100');
  return body.data;
}

export async function listOrganizations() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const body = await request(`/organizations?page=${page}&per_page=100`);
    all.push(...body.data);
    if (body.data.length < 100) break;
  }
  return all;
}

// Filtros de listagem — nomes de parâmetro verificados empiricamente na API
// (a doc oficial não lista nenhum). O que funciona em /people:
//   category, organization, userOwner (dono do contato — NÃO `ownerUser`, que é
//   ignorado em silêncio), leadOrigin, state (UF maiúscula), cityName, role
//   (cargo — casa por prefixo/substring, não precisa ser o texto exato; ex.:
//   role=Analista Cultura pega também "Analista Cultura (Teatro)" etc.).
// Ignorados por /people: sector, products, qualquer filtro de tarefa/data.
// Vários filtros juntos = interseção (E). Um valor por filtro (CSV dá 400).
export async function listPeopleByFilters({
  categoryId,
  userOwnerId,
  organizationId,
  leadOriginId,
  stateUf,
  cityName,
  role,
  page = 1,
  perPage = 100,
}) {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (categoryId) params.set('category', String(categoryId));
  if (userOwnerId) params.set('userOwner', String(userOwnerId));
  if (organizationId) params.set('organization', String(organizationId));
  if (leadOriginId) params.set('leadOrigin', String(leadOriginId));
  if (stateUf) params.set('state', String(stateUf).toUpperCase());
  if (cityName) params.set('cityName', String(cityName));
  if (role) params.set('role', String(role));
  const body = await request(`/people?${params.toString()}`);
  return body.data;
}

// Filtros de /organizations (verificados): category, leadOrigin, sector,
// userOwner, state (UF maiúscula), cityName, products. Um valor por filtro.
export async function listOrganizationsByFilters({
  categoryId,
  leadOriginId,
  sectorId,
  userOwnerId,
  stateUf,
  cityName,
  productId,
  page = 1,
  perPage = 100,
}) {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (categoryId) params.set('category', String(categoryId));
  if (leadOriginId) params.set('leadOrigin', String(leadOriginId));
  if (sectorId) params.set('sector', String(sectorId));
  if (userOwnerId) params.set('userOwner', String(userOwnerId));
  if (stateUf) params.set('state', String(stateUf).toUpperCase());
  if (cityName) params.set('cityName', String(cityName));
  if (productId) params.set('products', String(productId));
  const body = await request(`/organizations?${params.toString()}`);
  return body.data;
}

// Agendor's task API only honors the due date when sent as snake_case
// `due_date`, and it always applies a +3h shift on top of whatever instant
// is provided (as if the input clock time were America/Sao_Paulo wall-clock
// mislabeled as UTC). Sending it 3h early compensates so the value actually
// stored/displayed matches the real intended UTC instant.
function toAgendorDueDate(date) {
  const brazilOffsetMs = 3 * 60 * 60 * 1000;
  return new Date(date.getTime() - brazilOffsetMs).toISOString();
}

export async function createPersonTask({ personId, text, dueDate, assignedUsers, type }) {
  const body = await request(`/people/${personId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ text, due_date: toAgendorDueDate(dueDate), assigned_users: assignedUsers, type }),
  });
  return body.data;
}

// A API só cria tarefa em pessoa quando a empresa tem contato. Para empresas
// sem nenhuma pessoa cadastrada, a tarefa vai direto na empresa por esta rota
// (mesmo shape de payload, mesmo shift de +3h no due_date). Verificado
// empiricamente em 10/09/2026: POST e DELETE de /organizations/{id}/tasks
// funcionam igual aos de /people/{id}/tasks.
export async function createOrganizationTask({ organizationId, text, dueDate, assignedUsers, type }) {
  const body = await request(`/organizations/${organizationId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ text, due_date: toAgendorDueDate(dueDate), assigned_users: assignedUsers, type }),
  });
  return body.data;
}

export async function updatePersonTask({ personId, taskId, text, dueDate, assignedUsers, type }) {
  const body = await request(`/people/${personId}/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ text, due_date: toAgendorDueDate(dueDate), assigned_users: assignedUsers, type }),
  });
  return body.data;
}

// Testado 15/09/2026: o PUT em tarefa de empresa funciona igual ao de pessoa
// (mesmo payload, mesmo shift de +3h) — a API não documenta essa rota, mas
// segue o mesmo par create/update/delete das outras duas.
export async function updateOrganizationTask({ organizationId, taskId, text, dueDate, assignedUsers, type }) {
  const body = await request(`/organizations/${organizationId}/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ text, due_date: toAgendorDueDate(dueDate), assigned_users: assignedUsers, type }),
  });
  return body.data;
}

// Testado 15/09/2026: as duas rotas de DELETE funcionam (tarefa em pessoa e
// tarefa direto na empresa, mesmo par de rotas do create).
export async function deletePersonTask({ personId, taskId }) {
  const body = await request(`/people/${personId}/tasks/${taskId}`, { method: 'DELETE' });
  return body.data;
}

export async function deleteOrganizationTask({ organizationId, taskId }) {
  const body = await request(`/organizations/${organizationId}/tasks/${taskId}`, { method: 'DELETE' });
  return body.data;
}

// `/tasks` é um endpoint separado de listagem (sem doc oficial, achado
// 15/09/2026): junta tarefas de pessoa E de empresa, mas só filtra de verdade
// por data — `type`/`assignedUser` são ignorados em silêncio (mesmo padrão de
// /people e /organizations). `createdDateGt` sozinho tem limite de 31 dias
// pra trás; `dueDateGt` + `dueDateLt` juntos NÃO têm esse limite e dão pra
// isolar um dia exato de vencimento (testado com datas em 2025 e no fim de
// 2026, sem erro). Cada item vem com `organization` OU `person` (nunca os
// dois), e o `type` volta capitalizado em PT-BR ("Email", "Ligação",
// "Reunião", "Visita" — não o código que a gente manda pra criar).
export async function listTasksByDueRange({ dueDateGtISO, dueDateLtISO, page = 1, perPage = 100 }) {
  const params = new URLSearchParams({
    dueDateGt: dueDateGtISO,
    dueDateLt: dueDateLtISO,
    page: String(page),
    per_page: String(perPage),
  });
  const body = await request(`/tasks?${params.toString()}`);
  return body.data;
}

export async function listFunnels() {
  const body = await request('/funnels');
  return body.data;
}

export async function listDealStages() {
  const body = await request('/deal_stages');
  return body.data;
}

// Verified empirically: `dealStage` and `dealStatus` (camelCase) do narrow the
// result server-side; the snake_case variants are silently ignored and return
// everything. Status ids: 1 = Em andamento, 2 = Ganho, 3 = Perdido.
export async function listDealsByStage({ dealStageId, dealStatusId, page = 1, perPage = 100 }) {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (dealStageId) params.set('dealStage', String(dealStageId));
  if (dealStatusId) params.set('dealStatus', String(dealStatusId));
  const body = await request(`/deals?${params.toString()}`);
  return body.data;
}

export async function getPerson(personId) {
  const body = await request(`/people/${personId}`);
  return body.data;
}

export async function getOrganization(organizationId) {
  const body = await request(`/organizations/${organizationId}`);
  return body.data;
}

export { request, BASE_URL, toAgendorDueDate };
