const BASE_URL = 'https://api.agendor.com.br/v3';

async function request(path, options = {}) {
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

export async function listPeopleByCategory({ categoryId, page = 1, perPage = 100 }) {
  const body = await request(`/people?category=${categoryId}&page=${page}&per_page=${perPage}`);
  return body.data;
}

// Generic filtered listing. Only `category` and `ownerUser` are confirmed to
// actually narrow results server-side (verified empirically); other people
// fields are silently ignored by the API if passed as query params.
export async function listPeopleByFilters({ categoryId, ownerUserId, organizationId, page = 1, perPage = 100 }) {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (categoryId) params.set('category', String(categoryId));
  if (ownerUserId) params.set('ownerUser', String(ownerUserId));
  if (organizationId) params.set('organization', String(organizationId));
  const body = await request(`/people?${params.toString()}`);
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

export async function updatePersonTask({ personId, taskId, text, dueDate, assignedUsers, type }) {
  const body = await request(`/people/${personId}/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ text, due_date: toAgendorDueDate(dueDate), assigned_users: assignedUsers, type }),
  });
  return body.data;
}

export { request, BASE_URL, toAgendorDueDate };
