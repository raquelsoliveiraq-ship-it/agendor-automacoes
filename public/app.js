let automations = [];
let activeId = null;
let optionsCache = {}; // { [automationId]: { [source]: [{value,label}] } }
let formValues = {}; // { [automationId]: { [fieldName]: value } }
let flowCanvases = {}; // { [automationId]: flowCanvasInstance }

const listEl = document.getElementById('automation-list');
const emptyStateEl = document.getElementById('empty-state');
const viewEl = document.getElementById('automation-view');
const nameEl = document.getElementById('automation-name');
const descriptionEl = document.getElementById('automation-description');
const dynamicContentEl = document.getElementById('dynamic-content');
const logOutputEl = document.getElementById('log-output');
const runButton = document.getElementById('run-button');
const previewButton = document.getElementById('preview-button');

function formatDate(iso) {
  if (!iso) return 'Nunca';
  return new Date(iso).toLocaleString('pt-BR');
}

function renderSidebar() {
  listEl.innerHTML = '';
  for (const a of automations) {
    const btn = document.createElement('button');
    btn.className = 'automation-item' + (a.meta.id === activeId ? ' active' : '');
    btn.textContent = a.meta.name;
    btn.addEventListener('click', () => selectAutomation(a.meta.id));
    listEl.appendChild(btn);
  }
}

function currentAutomation() {
  return automations.find((x) => x.meta.id === activeId);
}

function getFormValues() {
  if (!formValues[activeId]) formValues[activeId] = {};
  return formValues[activeId];
}

async function ensureOptionsLoaded(automationId, source) {
  optionsCache[automationId] = optionsCache[automationId] || {};
  if (optionsCache[automationId][source]) return optionsCache[automationId][source];
  const res = await fetch(`/api/automations/${automationId}/options/${source}`);
  const options = await res.json();
  optionsCache[automationId][source] = options;
  return options;
}

function labelFor(field, value) {
  if (!value) return field.allowEmpty ? field.emptyLabel || 'Qualquer' : '—';
  const staticOpt = (field.options || []).find((o) => o.value === value);
  if (staticOpt) return staticOpt.label;
  const dynamicOpts = (optionsCache[activeId] || {})[field.optionsSource] || [];
  const dynOpt = dynamicOpts.find((o) => o.value === value);
  return dynOpt ? dynOpt.label : value;
}

function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '—');
}

function computeSteps(automation) {
  if (automation.meta.configurable) {
    const values = getFormValues();
    const labels = {};
    for (const field of automation.meta.configSchema) {
      labels[field.name] = labelFor(field, values[field.name]);
    }
    return automation.meta.canvasTemplate.map((step) => ({
      label: step.label,
      title: step.title,
      detail: interpolate(step.detailTemplate, labels),
    }));
  }
  return automation.meta.steps || [];
}

function renderCanvasSection(automation) {
  const section = document.createElement('section');
  section.className = 'canvas-section';
  section.innerHTML = '<h2 class="section-title">Etapas <span class="section-hint">(arraste os cards, role para zoom)</span></h2>';
  const holder = document.createElement('div');
  section.appendChild(holder);
  const flow = createFlowCanvas(holder, automation.meta.id);
  flowCanvases[automation.meta.id] = flow;
  flow.setSteps(computeSteps(automation));
  return section;
}

function refreshCanvas(automation) {
  const flow = flowCanvases[automation.meta.id];
  if (flow) flow.setSteps(computeSteps(automation));
}

function renderStatusCards(state) {
  const section = document.createElement('section');
  section.className = 'status-row';
  section.innerHTML = `
    <div class="status-card">
      <span class="status-label">Última execução</span>
      <span class="status-value">${formatDate(state.lastRunAt)}</span>
    </div>
    <div class="status-card">
      <span class="status-label">Pessoas processadas</span>
      <span class="status-value">${(state.processedPersonIds || []).length}</span>
    </div>
  `;
  return section;
}

async function renderConfigForm(automation) {
  const values = getFormValues();
  const form = document.createElement('section');
  form.innerHTML = '<h2 class="section-title">Filtros e dados da tarefa</h2>';
  const grid = document.createElement('div');
  grid.className = 'config-form';

  for (const field of automation.meta.configSchema) {
    if (values[field.name] === undefined) {
      values[field.name] = field.default ?? '';
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'form-field' + (field.type === 'text' ? ' full-width' : '');
    const label = document.createElement('label');
    label.textContent = field.label;
    wrapper.appendChild(label);

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      if (field.allowEmpty) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = field.emptyLabel || 'Qualquer';
        input.appendChild(opt);
      }
      const options = field.options || (await ensureOptionsLoaded(activeId, field.optionsSource));
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        input.appendChild(opt);
      }
      input.value = values[field.name];
      input.addEventListener('input', () => {
        values[field.name] = input.value;
        refreshCanvas(automation);
      });
    } else if (field.type === 'autocomplete') {
      const options = await ensureOptionsLoaded(activeId, field.optionsSource);
      const listId = `datalist-${field.name}`;
      const datalist = document.createElement('datalist');
      datalist.id = listId;
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.label;
        datalist.appendChild(opt);
      }
      input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('list', listId);
      input.placeholder = field.emptyLabel || 'Digite para buscar...';
      const currentOpt = options.find((o) => o.value === values[field.name]);
      input.value = currentOpt ? currentOpt.label : '';
      input.addEventListener('input', () => {
        const typed = input.value.trim().toLowerCase();
        const match = options.find((o) => o.label.toLowerCase() === typed);
        values[field.name] = match ? match.value : '';
        refreshCanvas(automation);
      });
      wrapper.appendChild(datalist);
    } else {
      input = document.createElement('input');
      input.type = field.type; // 'date' | 'time' | 'text'
      input.value = values[field.name];
      input.addEventListener('input', () => {
        values[field.name] = input.value;
        refreshCanvas(automation);
      });
    }

    wrapper.appendChild(input);
    grid.appendChild(wrapper);
  }

  form.appendChild(grid);
  return form;
}

function renderHistoryTable(runs, configSchema) {
  const section = document.createElement('section');
  section.className = 'history-section';
  section.innerHTML = '<h2 class="section-title">Histórico de execuções</h2>';

  if (!runs || runs.length === 0) {
    const p = document.createElement('p');
    p.className = 'history-empty';
    p.textContent = 'Nenhuma execução registrada ainda.';
    section.appendChild(p);
    return section;
  }

  const table = document.createElement('table');
  table.className = 'history-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Quando</th>
        <th>Filtros</th>
        <th>Vencimento</th>
        <th>Encontradas</th>
        <th>Criadas</th>
        <th>Erros</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  const filterFields = configSchema.filter((f) => f.allowEmpty);
  for (const run of runs) {
    const filterSummary = filterFields
      .map((f) => `${f.label}: ${labelForHistorical(f, run.config[f.name])}`)
      .join(' · ');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(run.ranAt)}</td>
      <td>${filterSummary}</td>
      <td>${run.config.dueDate} ${run.config.dueTime}</td>
      <td>${run.matchedCount}</td>
      <td>${run.created}</td>
      <td>${run.errorCount || 0}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

function labelForHistorical(field, value) {
  if (!field || !value) return 'Qualquer';
  const dynamicOpts = (optionsCache[activeId] || {})[field.optionsSource] || [];
  const opt = dynamicOpts.find((o) => o.value === String(value));
  return opt ? opt.label : String(value);
}

async function renderAutomation(automation) {
  nameEl.textContent = automation.meta.name;
  descriptionEl.textContent = automation.meta.description;
  dynamicContentEl.innerHTML = '';

  previewButton.hidden = !automation.meta.configurable;

  if (automation.meta.configurable) {
    dynamicContentEl.innerHTML = '<p class="loading-hint">Carregando opções de filtro...</p>';
    // Preload dropdown options referenced by the config schema so labels
    // resolve immediately in the canvas and history table.
    for (const field of automation.meta.configSchema) {
      if (field.optionsSource) await ensureOptionsLoaded(activeId, field.optionsSource);
    }
    dynamicContentEl.innerHTML = '';
    dynamicContentEl.appendChild(await renderConfigForm(automation));
    dynamicContentEl.appendChild(renderCanvasSection(automation));
    dynamicContentEl.appendChild(renderHistoryTable(automation.state.runs, automation.meta.configSchema));
  } else {
    dynamicContentEl.appendChild(renderStatusCards(automation.state));
    dynamicContentEl.appendChild(renderCanvasSection(automation));
  }
}

function selectAutomation(id) {
  activeId = id;
  emptyStateEl.hidden = true;
  viewEl.hidden = false;
  renderSidebar();
  logOutputEl.textContent = 'Nenhuma execução ainda nesta sessão.';
  renderAutomation(currentAutomation());
}

async function loadAutomations() {
  const res = await fetch('/api/automations');
  automations = await res.json();
  renderSidebar();
  if (automations.length && !activeId) {
    selectAutomation(automations[0].meta.id);
  }
}

previewButton.addEventListener('click', async () => {
  if (!activeId) return;
  previewButton.disabled = true;
  previewButton.textContent = 'Verificando...';
  try {
    const res = await fetch(`/api/automations/${activeId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: getFormValues() }),
    });
    const data = await res.json();
    const existing = dynamicContentEl.querySelector('.preview-result');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.className = 'preview-result';
    box.textContent = data.ok
      ? `${data.result.matchedCount} pessoa(s) casam com os filtros atuais. Exemplos: ${data.result.sample.join(', ') || '—'}`
      : `Erro ao pré-visualizar: ${data.error}`;
    dynamicContentEl.querySelector('.canvas-section').insertAdjacentElement('afterend', box);
  } finally {
    previewButton.disabled = false;
    previewButton.textContent = 'Pré-visualizar';
  }
});

runButton.addEventListener('click', async () => {
  if (!activeId) return;
  runButton.disabled = true;
  runButton.textContent = 'Rodando...';
  logOutputEl.textContent = 'Executando...';

  try {
    const res = await fetch(`/api/automations/${activeId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: getFormValues() }),
    });
    const data = await res.json();
    logOutputEl.textContent = (data.logs || []).join('\n') || '(sem saída)';
    if (data.ok) {
      await loadAutomations();
      await renderAutomation(currentAutomation());
      logOutputEl.textContent = (data.logs || []).join('\n');
    }
  } catch (err) {
    logOutputEl.textContent = 'Erro ao chamar o servidor: ' + err.message;
  } finally {
    runButton.disabled = false;
    runButton.textContent = 'Rodar agora';
  }
});

loadAutomations();
