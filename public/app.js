let automations = [];
let activeId = null;
let optionsCache = {}; // { [automationId]: { [source]: [{value,label}] } }
let formValues = {}; // { [automationId]: { [fieldName]: value } }
let flowCanvases = {}; // { [automationId]: flowCanvasInstance }
// Rascunhos ficam só na sessão do navegador: ao recarregar a página somem, e a
// pessoa roda de novo. Nada de rascunho de dias atrás aparecendo como se fosse
// de agora.
let sessionResult = {}; // { [automationId]: resultadoDaÚltimaRodadaNestaSessão }

// Estimativa ao vivo: recalcula sozinha (com atraso) enquanto a pessoa mexe nos
// filtros, para ela ver de quantos contatos a rodada vai sair antes de rodar.
let livePreviewTimer = null;
let livePreviewToken = 0;

const listEl = document.getElementById('automation-list');
const emptyStateEl = document.getElementById('empty-state');
const viewEl = document.getElementById('automation-view');
const nameEl = document.getElementById('automation-name');
const descriptionEl = document.getElementById('automation-description');
const dynamicContentEl = document.getElementById('dynamic-content');
const logOutputEl = document.getElementById('log-output');
// O "Rodar agora" não fica mais no cabeçalho: entra no fim do formulário, logo
// depois do corpo do e-mail, que é onde a pessoa está quando termina de montar
// a rodada. É o mesmo nó sempre (os handlers e o estado disabled vivem nele),
// só muda de lugar a cada render.
const runButton = document.createElement('button');
runButton.type = 'button';
runButton.id = 'run-button';
runButton.className = 'run-button';
runButton.textContent = 'Rodar agora';
const enabledToggle = document.getElementById('enabled-toggle');
const enabledToggleText = document.getElementById('enabled-toggle-text');

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
    if (a.settings && a.settings.enabled === false) {
      const pill = document.createElement('span');
      pill.className = 'off-pill';
      pill.textContent = 'off';
      btn.appendChild(pill);
    }
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

// Chaves com `__` são controle da tela (qual modelo está escolhido) e não
// configuração da automação: não vão para o servidor nem para o histórico.
function configToSend() {
  const values = getFormValues();
  return Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('__')));
}

const optionsInFlight = {}; // { [automationId]: { [source]: Promise } }

async function ensureOptionsLoaded(automationId, source) {
  optionsCache[automationId] = optionsCache[automationId] || {};
  if (optionsCache[automationId][source]) return optionsCache[automationId][source];

  // Dedup: dois campos que usam a mesma lista (ex.: "Responsável" e "Atribuir
  // tarefa para", ambos `users`) compartilham uma requisição só.
  optionsInFlight[automationId] = optionsInFlight[automationId] || {};
  if (optionsInFlight[automationId][source]) return optionsInFlight[automationId][source];

  const load = (async () => {
    const res = await fetch(`/api/automations/${automationId}/options/${source}`);
    const options = await res.json();
    // Erro do servidor volta como objeto, não como lista. Sem esta checagem o
    // objeto ia parar no cache e a tela quebrava depois, longe da causa.
    if (!Array.isArray(options)) {
      throw new Error(`Não consegui carregar "${source}" de ${automationId}: ${options?.error ?? 'resposta inesperada'}`);
    }
    optionsCache[automationId][source] = options;
    return options;
  })();

  optionsInFlight[automationId][source] = load;
  try {
    return await load;
  } finally {
    delete optionsInFlight[automationId][source];
  }
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

// Campo escondido pelo `showWhen` vira este marcador, e o trecho do card que
// o contém some inteiro, em vez de mostrar "Etapa: —" num filtro por categoria.
const HIDDEN_MARK = '__oculto__';

function stripHiddenSegments(detail) {
  return detail
    .split(' · ')
    .filter((part) => !part.includes(HIDDEN_MARK))
    .join(' · ');
}

function computeSteps(automation) {
  if (automation.meta.configurable) {
    const values = getFormValues();
    const labels = {};
    for (const field of automation.meta.configSchema) {
      labels[field.name] = isFieldVisible(field, values) ? labelFor(field, values[field.name]) : HIDDEN_MARK;
    }
    return automation.meta.canvasTemplate.map((step) => ({
      label: step.label,
      title: step.title,
      detail: stripHiddenSegments(interpolate(step.detailTemplate, labels)),
    }));
  }
  return automation.meta.steps || [];
}

// Nota fixa explicando o que cada botão faz. Fica entre o formulário e o quadro
// de ETAPAS, que é onde a pessoa olha antes de clicar.
function renderHowItWorks(items) {
  const box = document.createElement('div');
  box.className = 'how-it-works';
  const title = document.createElement('strong');
  title.textContent = 'Como funciona';
  box.appendChild(title);
  const list = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}

// O quadro de Etapas é secundário no dia a dia (o filtro por categoria é o que
// importa), então entra fechado, como um título que a pessoa abre só se quiser.
function renderCanvasSection(automation) {
  const section = document.createElement('details');
  section.className = 'canvas-section';
  const summary = document.createElement('summary');
  summary.className = 'section-title';
  summary.innerHTML = 'Etapas <span class="section-hint">(arraste os cards, role para zoom)</span>';
  section.appendChild(summary);
  const holder = document.createElement('div');
  section.appendChild(holder);
  const flow = createFlowCanvas(holder, automation.meta.id);
  flowCanvases[automation.meta.id] = flow;
  flow.setSteps(computeSteps(automation));
  // O canvas nasce sem tamanho enquanto a seção está fechada; ao abrir pela
  // primeira vez, reajusta o zoom para caber tudo na tela.
  let fittedOnce = false;
  section.addEventListener('toggle', () => {
    if (section.open && !fittedOnce) {
      fittedOnce = true;
      requestAnimationFrame(() => flow.refit());
    }
  });
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

// Um campo com `showWhen` só aparece quando o campo que ele observa está no
// valor esperado, para não mostrar filtro de funil em cima de filtro de
// categoria. `equals` casa um valor; `in` casa qualquer valor da lista (para
// campos que servem a mais de um modo, como Categoria e Responsável).
function isFieldVisible(field, values) {
  if (!field.showWhen) return true;
  const current = values[field.showWhen.field];
  if (Array.isArray(field.showWhen.in)) return field.showWhen.in.includes(current);
  return current === field.showWhen.equals;
}

function controllingFieldNames(configSchema) {
  return new Set(configSchema.filter((f) => f.showWhen).map((f) => f.showWhen.field));
}

// Campos que mudam a contagem de contatos: quando um deles muda, vale recalcular
// a estimativa. Assunto/corpo/dados da tarefa não mexem em quem casa com o
// filtro, então não disparam nada. `taskType` é exceção: não muda quem casa
// com o filtro, mas muda quantos têm e-mail (só conta pra tarefa de e-mail).
const NON_FILTER_FIELDS = new Set([
  'subjectTemplate',
  'bodyTemplate',
  'taskText',
  'dueDate',
  'dueTime',
  'assignedUserId',
]);

function fieldAffectsCount(field) {
  return !NON_FILTER_FIELDS.has(field.name);
}

// Modelos de e-mail: assunto e corpo salvos com um nome, para não reescrever o
// mesmo texto toda semana. Ficam no servidor, então valem para as duas pessoas.
let templatesCache = {}; // { [automationId]: [{id, name, values, updatedAt}] }

async function loadTemplates(automationId) {
  const res = await fetch(`/api/automations/${automationId}/templates`);
  const list = await res.json();
  templatesCache[automationId] = Array.isArray(list) ? list : [];
  return templatesCache[automationId];
}

// Fecha o menu de modelos que estiver aberto (só um por vez). Guardado no
// módulo porque o rerender do formulário troca os nós e o listener de clique
// fora precisa ser removido mesmo sem passar pelo botão.
let closeTemplateMenu = null;

// Texto atual do assunto/corpo é diferente do que está salvo no modelo `tpl`?
// (ignora o texto padrão da automação, que não conta como "modelo próprio").
function templateTextDiffers(automation, values, tpl) {
  return automation.meta.templateFields.some((f) => {
    const atual = (values[f] ?? '').trim();
    const doModelo = (tpl?.values?.[f] ?? '').trim();
    const padrao = (automation.meta.configSchema.find((c) => c.name === f)?.default ?? '').trim();
    if (tpl) return atual !== doModelo;
    return atual && atual !== padrao;
  });
}

async function saveTemplateFromForm(automation, name) {
  const automationId = automation.meta.id;
  const values = getFormValues();
  const payload = {};
  for (const field of automation.meta.templateFields) payload[field] = values[field] ?? '';
  const res = await fetch(`/api/automations/${automationId}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, values: payload }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'não consegui salvar');
  templatesCache[automationId] = data.templates;
  const salvo = data.templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
  values.__templateId = salvo?.id || '';
  values.__templateName = salvo?.name || name;
  return name;
}

// Barra de modelos no estilo do Agendor: um botão que abre um menu com a lista
// de modelos salvos e, no rodapé, "+ Adicionar novo modelo".
function renderTemplateBar(automation) {
  const automationId = automation.meta.id;
  const templates = templatesCache[automationId] || [];
  const values = getFormValues();

  const bar = document.createElement('div');
  bar.className = 'template-bar';

  const label = document.createElement('label');
  label.textContent = 'Modelo de e-mail:';
  bar.appendChild(label);

  const picker = document.createElement('div');
  picker.className = 'template-picker';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'template-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML =
    `<span class="template-trigger-text">${values.__templateName || 'Escolher um modelo...'}</span>` +
    '<span class="template-caret" aria-hidden="true">▾</span>';

  const menu = document.createElement('div');
  menu.className = 'template-menu';
  menu.hidden = true;

  const status = document.createElement('span');
  status.className = 'template-status';

  function closeMenu() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onEsc);
    closeTemplateMenu = null;
  }
  function onOutside(e) {
    if (!picker.contains(e.target)) closeMenu();
  }
  function onEsc(e) {
    if (e.key === 'Escape') {
      closeMenu();
      trigger.focus();
    }
  }
  function openMenu() {
    if (closeTemplateMenu) closeTemplateMenu();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    closeTemplateMenu = closeMenu;
  }
  trigger.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));

  function applyTemplate(tpl) {
    const atualId = values.__templateId;
    if (tpl.id !== atualId) {
      const base = templates.find((t) => t.id === atualId) || null;
      if (
        templateTextDiffers(automation, values, base) &&
        !confirm(`Aplicar o modelo "${tpl.name}" vai substituir o assunto e o corpo escritos agora. Continuar?`)
      ) {
        return;
      }
    }
    for (const field of automation.meta.templateFields) values[field] = tpl.values[field] ?? '';
    values.__templateId = tpl.id;
    values.__templateName = tpl.name;
    closeMenu();
    rerenderConfigForm(automation);
  }

  async function deleteTemplate(tpl) {
    if (!confirm(`Excluir o modelo "${tpl.name}"? O texto que está na tela não é apagado.`)) return;
    const res = await fetch(`/api/automations/${automationId}/templates/${tpl.id}`, { method: 'DELETE' });
    const data = await res.json();
    templatesCache[automationId] = data.templates;
    if (values.__templateId === tpl.id) {
      values.__templateId = '';
      values.__templateName = '';
    }
    closeMenu();
    await rerenderConfigForm(automation);
  }

  // Título do menu
  const title = document.createElement('p');
  title.className = 'template-menu-title';
  title.textContent = 'Modelos de e-mail';
  menu.appendChild(title);

  // Lista de modelos salvos
  const list = document.createElement('div');
  list.className = 'template-menu-list';
  if (!templates.length) {
    const vazio = document.createElement('p');
    vazio.className = 'template-menu-empty';
    vazio.textContent = 'Nenhum modelo salvo ainda.';
    list.appendChild(vazio);
  }
  for (const tpl of templates) {
    const row = document.createElement('div');
    row.className = 'template-menu-row' + (tpl.id === values.__templateId ? ' is-active' : '');

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'template-menu-item';
    item.innerHTML = `<span class="template-menu-check" aria-hidden="true">✓</span><span>${tpl.name}</span>`;
    item.addEventListener('click', () => applyTemplate(tpl));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'template-menu-del';
    del.title = `Excluir o modelo "${tpl.name}"`;
    del.setAttribute('aria-label', del.title);
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTemplate(tpl);
    });

    row.append(item, del);
    list.appendChild(row);
  }
  menu.appendChild(list);

  // Rodapé: salvar alterações no modelo aberto + adicionar novo
  const footer = document.createElement('div');
  footer.className = 'template-menu-footer';

  const modeloAberto = templates.find((t) => t.id === values.__templateId);
  if (modeloAberto) {
    const saveChanges = document.createElement('button');
    saveChanges.type = 'button';
    saveChanges.className = 'template-menu-action';
    saveChanges.textContent = `Salvar alterações em "${modeloAberto.name}"`;
    saveChanges.addEventListener('click', async () => {
      saveChanges.disabled = true;
      try {
        await saveTemplateFromForm(automation, modeloAberto.name);
        closeMenu();
        await rerenderConfigForm(automation);
        const novo = dynamicContentEl.querySelector('.template-status');
        if (novo) novo.textContent = `Modelo "${modeloAberto.name}" atualizado.`;
      } catch (err) {
        status.textContent = 'Erro ao salvar: ' + err.message;
        saveChanges.disabled = false;
      }
    });
    footer.appendChild(saveChanges);
  }

  // "+ Adicionar novo modelo": vira um campo de nome + Salvar ao ser clicado.
  const addWrap = document.createElement('div');
  addWrap.className = 'template-menu-add';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'template-menu-action template-menu-add-btn';
  addBtn.textContent = '+ Adicionar novo modelo';
  addBtn.addEventListener('click', () => {
    addBtn.hidden = true;
    form.hidden = false;
    nameInput.focus();
  });

  const form = document.createElement('form');
  form.className = 'template-add-form';
  form.hidden = true;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Nome do novo modelo';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'submit';
  confirmBtn.className = 'primary';
  confirmBtn.textContent = 'Salvar';
  form.append(nameInput, confirmBtn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = nameInput.value.trim();
    if (!nome) {
      nameInput.focus();
      return;
    }
    const jaExiste = templates.some((t) => t.name.toLowerCase() === nome.toLowerCase());
    if (jaExiste && !confirm(`Já existe um modelo "${nome}". Substituir o conteúdo dele pelo texto atual?`)) return;
    confirmBtn.disabled = true;
    try {
      await saveTemplateFromForm(automation, nome);
      closeMenu();
      await rerenderConfigForm(automation);
      const novo = dynamicContentEl.querySelector('.template-status');
      if (novo) novo.textContent = `Modelo "${nome}" salvo.`;
    } catch (err) {
      status.textContent = 'Erro ao salvar: ' + err.message;
      confirmBtn.disabled = false;
    }
  });

  addWrap.append(addBtn, form);
  footer.appendChild(addWrap);
  menu.appendChild(footer);

  picker.append(trigger, menu);
  bar.append(picker, status);
  return bar;
}

function rerenderConfigForm(automation) {
  const existing = dynamicContentEl.querySelector('.config-section');
  if (!existing) return;
  existing.replaceWith(renderConfigForm(automation));
  // O formulário foi refeito com a caixa da estimativa zerada; recalcula para
  // ela não ficar vazia depois de aplicar/salvar um modelo ou trocar de filtro.
  if (isEnabled(automation)) runLivePreview(automation);
}

// A caixa da estimativa ao vivo: número grande em negrito com um círculo que
// gira enquanto a filtragem não terminou. Fica logo antes do modelo de e-mail.
function createPreviewBox(danger) {
  const box = document.createElement('div');
  box.className = 'preview-result full-width' + (danger ? ' is-danger' : '');
  box.hidden = true;
  box.innerHTML =
    '<span class="preview-spinner" aria-hidden="true"></span><span class="preview-text"></span>';
  return box;
}

function addOption(selectEl, { value, label }) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  selectEl.appendChild(opt);
  return opt;
}

// Quando uma lista de opções chega, os rótulos que dependiam dela (no quadro de
// etapas e na coluna "Filtros" do histórico) passam a resolver: id -> nome.
function refreshLabels(automation) {
  refreshCanvas(automation);
  const hist = dynamicContentEl.querySelector('.history-section');
  if (hist && automation.state) {
    hist.replaceWith(renderHistoryTable(automation.state.runs, automation.meta));
  }
}

// Preenche um <select> de lista dinâmica quando ela chega do servidor. Enquanto
// isso, o campo fica desabilitado mostrando "Carregando opções…".
async function fillSelectOptions(selectEl, placeholderOpt, automation, field, values) {
  try {
    const options = await ensureOptionsLoaded(automation.meta.id, field.optionsSource);
    placeholderOpt.remove();
    for (const o of options) addOption(selectEl, o);
    selectEl.disabled = false;
    selectEl.value = values[field.name] || '';
    refreshLabels(automation);
  } catch {
    placeholderOpt.textContent = 'Erro ao carregar a lista';
  }
}

function renderConfigForm(automation) {
  // O formulário vai ser refeito do zero: fecha o menu de modelos que estiver
  // aberto e solta os listeners de clique-fora presos nos nós antigos.
  if (closeTemplateMenu) closeTemplateMenu();
  const values = getFormValues();
  const form = document.createElement('section');
  form.className = 'config-section';
  const title = automation.meta.formTitle || 'Filtros e dados da tarefa';
  form.innerHTML = `<h2 class="section-title">${title}</h2>`;
  if (automation.meta.configSchema.some((f) => f.highlight)) {
    const legend = document.createElement('p');
    legend.className = 'field-highlight-legend';
    legend.textContent = '* filtro mais importante (não é obrigatório, só um guia)';
    form.appendChild(legend);
  }
  const grid = document.createElement('div');
  grid.className = 'config-form';
  const controllers = controllingFieldNames(automation.meta.configSchema);

  for (const field of automation.meta.configSchema) {
    if (values[field.name] === undefined) {
      values[field.name] = field.default ?? '';
    }
    if (!isFieldVisible(field, values)) continue;

    // A barra de modelos entra logo antes do primeiro campo que ela preenche
    // (o assunto), porque é do texto do e-mail que ela trata, não dos filtros.
    // A estimativa vem logo acima dela: fecha o bloco de filtros com a conta de
    // quantos contatos casaram antes de a pessoa passar para o texto do e-mail.
    if (automation.meta.templateFields?.[0] === field.name) {
      grid.appendChild(createPreviewBox());
      const bar = renderTemplateBar(automation);
      bar.classList.add('full-width');
      grid.appendChild(bar);
    }

    const wrapper = document.createElement('div');
    wrapper.className =
      'form-field' + (field.type === 'text' || field.type === 'textarea' ? ' full-width' : '');
    const label = document.createElement('label');
    label.textContent = field.label;
    if (field.highlight) {
      const star = document.createElement('span');
      star.className = 'field-highlight-star';
      star.title = 'Um dos filtros mais importantes (não obrigatório)';
      star.textContent = ' *';
      label.appendChild(star);
    }
    wrapper.appendChild(label);

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      if (field.allowEmpty) addOption(input, { value: '', label: field.emptyLabel || 'Qualquer' });
      if (field.options) {
        for (const o of field.options) addOption(input, o);
        input.value = values[field.name];
      } else {
        // Lista dinâmica: campo desabilitado com "Carregando opções…" até a
        // lista chegar (em paralelo com os outros campos).
        input.disabled = true;
        const loading = addOption(input, { value: '__loading', label: 'Carregando opções…' });
        loading.disabled = true;
        input.value = '__loading';
        fillSelectOptions(input, loading, automation, field, values);
      }
      input.addEventListener('input', () => {
        values[field.name] = input.value;
        refreshCanvas(automation);
        if (fieldAffectsCount(field)) scheduleLivePreview(automation);
        if (controllers.has(field.name)) rerenderConfigForm(automation);
      });
    } else if (field.type === 'autocomplete') {
      const listId = `datalist-${field.name}`;
      const datalist = document.createElement('datalist');
      datalist.id = listId;
      input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('list', listId);
      input.placeholder = 'Carregando opções…';
      input.disabled = true;
      wrapper.appendChild(datalist);
      // A lista pode demorar (empresas são vários requests). Chega depois e
      // preenche o datalist; o input só libera quando ela está pronta.
      const ac = { options: [] };
      ensureOptionsLoaded(automation.meta.id, field.optionsSource)
        .then((opts) => {
          ac.options = opts;
          for (const o of opts) {
            const opt = document.createElement('option');
            opt.value = o.label;
            datalist.appendChild(opt);
          }
          input.disabled = false;
          input.placeholder = field.emptyLabel || 'Digite para buscar...';
          const currentOpt = opts.find((o) => o.value === values[field.name]);
          if (currentOpt) input.value = currentOpt.label;
          refreshLabels(automation);
        })
        .catch(() => {
          input.placeholder = 'Erro ao carregar a lista';
        });
      input.addEventListener('input', () => {
        const typed = input.value.trim().toLowerCase();
        const match = ac.options.find((o) => o.label.toLowerCase() === typed);
        values[field.name] = match ? match.value : '';
        refreshCanvas(automation);
        if (fieldAffectsCount(field)) scheduleLivePreview(automation);
      });
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'body-template';
      input.value = values[field.name];
      input.addEventListener('input', () => {
        values[field.name] = input.value;
        refreshCanvas(automation);
      });
    } else {
      input = document.createElement('input');
      input.type = field.type; // 'date' | 'time' | 'text'
      if (field.placeholder) input.placeholder = field.placeholder;
      input.value = values[field.name];
      input.addEventListener('input', () => {
        values[field.name] = input.value;
        refreshCanvas(automation);
        if (fieldAffectsCount(field)) scheduleLivePreview(automation);
      });
    }

    wrapper.appendChild(input);

    // A lista de placeholders fica no último campo de texto livre, para não
    // repetir a mesma dica embaixo de assunto e corpo.
    if (field.type === 'textarea' && automation.meta.placeholders) {
      const hint = document.createElement('p');
      hint.className = 'placeholder-hint';
      hint.innerHTML =
        'Você pode usar: ' + automation.meta.placeholders.map((ph) => `<code>${ph}</code>`).join(' ');
      wrapper.appendChild(hint);
    }
    // Dica curta embaixo do campo, para casos em que o nome do filtro sozinho
    // engana (ex.: "Categoria" filtra empresa ou pessoa dependendo do modo).
    if (field.hint) {
      const hint = document.createElement('p');
      hint.className = 'placeholder-hint';
      hint.textContent = field.hint;
      wrapper.appendChild(hint);
    }
    grid.appendChild(wrapper);
  }

  // Automação com mais de uma "Ação" (ex.: apagar OU editar tarefas): só a
  // ação de apagar é irreversível, então o vermelho/rótulo de perigo segue o
  // valor atual do campo `action`, não a automação inteira.
  const actionLabels = automation.meta.actionLabels?.[values.action];
  const isDangerNow = automation.meta.destructive === true && (!automation.meta.actionLabels || values.action !== 'edit');

  // Sem modelo de e-mail (ex.: tarefas em massa) a estimativa fecha o formulário.
  if (!grid.querySelector('.preview-result')) grid.appendChild(createPreviewBox(isDangerNow));

  form.appendChild(grid);

  // "Rodar agora" no fim do formulário. appendChild move o nó do lugar anterior,
  // então ele sempre acaba aqui, no formulário recém-montado.
  runButton.textContent = actionLabels?.run || automation.meta.runLabel || 'Rodar agora';
  runButton.classList.toggle('is-danger', isDangerNow);
  const runRow = document.createElement('div');
  runRow.className = 'run-row';
  runRow.appendChild(runButton);
  form.appendChild(runRow);

  return form;
}

function renderHistoryTable(runs, meta) {
  const configSchema = meta.configSchema;
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

  // O histórico é referência, não a ação principal da tela: mostra só as duas
  // execuções mais recentes (a lista chega da mais nova para a mais antiga).
  const recentes = runs.slice(0, 2);

  const isDrafts = meta.resultView === 'drafts';
  // Automação com mais de uma ação (ex.: apagar OU editar) usa a mesma tabela
  // genérica pras duas — "Afetadas" cobre tanto "apagadas" quanto "atualizadas".
  const isAffect = meta.destructive === true;
  const table = document.createElement('table');
  table.className = 'history-table';
  table.innerHTML = isDrafts
    ? `
    <thead>
      <tr>
        <th>Quando</th>
        <th>Filtros</th>
        <th>Negócios</th>
        <th>Rascunhos</th>
        <th>Sem e-mail</th>
      </tr>
    </thead>
  `
    : isAffect
    ? `
    <thead>
      <tr>
        <th>Quando</th>
        <th>Filtros</th>
        <th>Afetadas</th>
        <th>Erros</th>
        <th></th>
      </tr>
    </thead>
  `
    : `
    <thead>
      <tr>
        <th>Quando</th>
        <th>Filtros</th>
        <th>Vencimento</th>
        <th>Encontradas</th>
        <th>Criadas</th>
        <th>Sem contato</th>
        <th>Erros</th>
        <th></th>
      </tr>
    </thead>
  `;
  // Quantas colunas o cabeçalho tem, pra linha de detalhe (que é uma célula só)
  // esticar por baixo de todas sem precisar repetir esse número na mão.
  const totalCols = table.querySelectorAll('thead th').length;
  const tbody = document.createElement('tbody');
  // Nos filtros do histórico entram os campos de escolha; os de texto livre
  // (assunto, corpo) ficariam ilegíveis numa célula de tabela. E cada linha só
  // mostra os filtros que valiam para a fonte usada naquela execução.
  const filterFields = configSchema.filter((f) => f.allowEmpty || (isDrafts && f.type === 'select'));
  for (const run of recentes) {
    const filterSummary = filterFields
      .filter((f) => isFieldVisible(f, run.config))
      .map((f) => `${f.label}: ${labelForHistorical(f, run.config[f.name])}`)
      .join(' · ');

    const tr = document.createElement('tr');
    tr.innerHTML = isDrafts
      ? `
      <td>${formatDate(run.ranAt)}</td>
      <td>${filterSummary}</td>
      <td>${run.matchedCount}</td>
      <td>${run.draftCount}</td>
      <td>${run.missingEmailCount || 0}</td>
    `
      : isAffect
      ? `
      <td>${formatDate(run.ranAt)}</td>
      <td>${filterSummary}</td>
      <td>${run.created}</td>
      <td>${run.errorCount || 0}</td>
    `
      : `
      <td>${formatDate(run.ranAt)}</td>
      <td>${filterSummary}</td>
      <td>${run.config.dueDate} ${run.config.dueTime}</td>
      <td>${run.matchedCount}</td>
      <td>${run.created}</td>
      <td${run.skippedLabel ? ` title="Sem ${run.skippedLabel} cadastrado"` : ''}>${run.skippedCount || 0}</td>
      <td>${run.errorCount || 0}</td>
    `;

    if (!isDrafts) {
      const toggleTd = document.createElement('td');
      if (run.items && run.items.length) {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'history-detail-toggle';
        toggleBtn.textContent = isAffect ? 'Ver detalhes' : 'Ver tarefas';
        toggleTd.appendChild(toggleBtn);

        const detailTr = document.createElement('tr');
        detailTr.className = 'history-detail-row';
        detailTr.hidden = true;
        const detailTd = document.createElement('td');
        detailTd.colSpan = totalCols;
        detailTd.appendChild(renderHistoryItems(run.items));
        detailTr.appendChild(detailTd);

        const showLabel = isAffect ? 'Ver detalhes' : 'Ver tarefas';
        toggleBtn.addEventListener('click', () => {
          detailTr.hidden = !detailTr.hidden;
          toggleBtn.textContent = detailTr.hidden ? showLabel : 'Esconder';
        });

        tbody.appendChild(tr);
        tr.appendChild(toggleTd);
        tbody.appendChild(detailTr);
        continue;
      }
      tr.appendChild(toggleTd);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);

  if (runs.length > recentes.length) {
    const mais = document.createElement('p');
    mais.className = 'history-more';
    const resto = runs.length - recentes.length;
    mais.textContent = `+ ${resto} execução(ões) mais antiga(s) não mostrada(s).`;
    section.appendChild(mais);
  }

  return section;
}

function renderHistoryItems(items) {
  const list = document.createElement('ul');
  list.className = 'history-detail-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = item.ok ? 'history-detail-ok' : 'history-detail-error';

    const name = document.createElement('span');
    name.textContent = item.name;
    li.appendChild(name);

    if (item.link) {
      const link = document.createElement('a');
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Ver no Agendor';
      li.appendChild(link);
    }

    if (!item.ok) {
      const err = document.createElement('span');
      err.className = item.skipped ? 'history-detail-skipped-msg' : 'history-detail-error-msg';
      err.textContent = item.error;
      li.appendChild(err);
    }

    list.appendChild(li);
  }
  return list;
}

function labelForHistorical(field, value) {
  if (!field || !value) return 'Qualquer';
  const staticOpt = (field.options || []).find((o) => o.value === String(value));
  if (staticOpt) return staticOpt.label;
  const dynamicOpts = (optionsCache[activeId] || {})[field.optionsSource] || [];
  const opt = dynamicOpts.find((o) => o.value === String(value));
  return opt ? opt.label : String(value);
}

// A conta do Gmail é escolha de cada pessoa, e cada uma abre o dashboard no
// seu próprio navegador — por isso fica no localStorage, e não no estado da
// automação, que é compartilhado.
const GMAIL_ACCOUNT_KEY = 'agendor:gmailAccount';

function getGmailAccount() {
  try {
    return localStorage.getItem(GMAIL_ACCOUNT_KEY) || '';
  } catch {
    return '';
  }
}

function setGmailAccount(value) {
  try {
    localStorage.setItem(GMAIL_ACCOUNT_KEY, value);
  } catch {
    // Navegador com armazenamento bloqueado: a conta vale só para esta visita.
  }
}

// `authuser` diz ao Gmail em qual conta abrir a janela de escrita, para quem
// está logado em mais de uma ao mesmo tempo.
function gmailUrlForAccount(baseUrl, account) {
  if (!account) return baseUrl;
  return `${baseUrl}&authuser=${encodeURIComponent(account)}`;
}

function renderAccountBar(section) {
  const bar = document.createElement('div');
  bar.className = 'account-bar';

  const label = document.createElement('label');
  label.textContent = 'Abrir na conta do Gmail:';
  label.htmlFor = 'gmail-account';

  const input = document.createElement('input');
  input.type = 'email';
  input.id = 'gmail-account';
  input.placeholder = 'voce@gmail.com';
  input.value = getGmailAccount();
  input.addEventListener('input', () => setGmailAccount(input.value.trim()));

  const hint = document.createElement('span');
  hint.className = 'account-hint';
  hint.textContent = 'Fica salvo neste navegador. Cada pessoa põe a sua.';

  bar.append(label, input, hint);
  section.appendChild(bar);
  return input;
}

// CSV pra mala direta (Planilhas Google + YAMM, ou Mesclagem de e-mails do
// Gmail com merge tags {{Assunto}}/{{Corpo}}). BOM no início pro Excel/Sheets
// reconhecerem acentuação UTF-8 direito.
function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function draftsToCsv(drafts) {
  const header = ['Nome', 'E-mail', 'Assunto', 'Corpo'];
  const rows = drafts.map((d) => [d.contactName, d.email, d.subject, d.body].map(csvEscape).join(','));
  return [header.join(','), ...rows].join('\r\n');
}

function downloadDraftsCsv(drafts) {
  const csv = '﻿' + draftsToCsv(drafts);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rascunhos-email-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderDrafts(result) {
  const section = document.createElement('section');
  section.className = 'drafts-section';
  const drafts = result.drafts || [];
  const missing = result.missingEmail || [];

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = `Rascunhos prontos (${drafts.length})`;
  section.appendChild(heading);

  // O "quadro que encontra": mesmo resumo da pré-visualização, agora fixo
  // depois de rodar, para você ver de quantos contatos os rascunhos saíram.
  const total = result.matchedCount ?? drafts.length + missing.length;
  const resumo = document.createElement('div');
  resumo.className = 'result-summary';
  resumo.textContent =
    `Encontrados ${total} contato(s) no filtro: ${drafts.length} com e-mail (rascunhos abaixo) ` +
    `e ${missing.length} sem e-mail. Nada foi enviado — os e-mails só saem quando você abre e envia um por um.`;
  section.appendChild(resumo);

  if (result.ranAt) {
    const when = document.createElement('p');
    when.className = 'placeholder-hint';
    when.textContent = `Gerados em ${formatDate(result.ranAt)}. Somem ao recarregar a página — rode de novo para gerar outra vez.`;
    section.appendChild(when);
  }

  if (drafts.length) {
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'primary';
    exportBtn.textContent = 'Exportar CSV (mala direta)';
    exportBtn.addEventListener('click', () => downloadDraftsCsv(drafts));
    section.appendChild(exportBtn);
  }

  if (drafts.length) renderAccountBar(section);

  if (drafts.length === 0) {
    const p = document.createElement('p');
    p.className = 'history-empty';
    p.textContent = 'Nenhum negócio dessa etapa tem contato com e-mail cadastrado.';
    section.appendChild(p);
  }

  for (const draft of drafts) {
    const card = document.createElement('div');
    card.className = 'draft-card';

    const head = document.createElement('div');
    head.className = 'draft-head';
    const who = document.createElement('div');
    who.className = 'draft-who';
    who.textContent = draft.contactName || '(sem nome)';
    const emailSpan = document.createElement('span');
    emailSpan.className = 'draft-email';
    emailSpan.textContent = ` ${draft.email}`;
    who.appendChild(emailSpan);
    const subtitle = document.createElement('div');
    subtitle.className = 'draft-deal';
    subtitle.textContent = draft.subtitle || '';
    head.append(who, subtitle);
    card.appendChild(head);

    const subject = document.createElement('div');
    subject.className = 'draft-subject';
    subject.innerHTML = '<strong>Assunto:</strong> ';
    subject.appendChild(document.createTextNode(draft.subject));
    card.appendChild(subject);

    const body = document.createElement('div');
    body.className = 'draft-body';
    body.textContent = draft.body;
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'draft-actions';

    const gmailButton = document.createElement('button');
    gmailButton.type = 'button';
    gmailButton.className = 'primary';
    gmailButton.textContent = 'Abrir no Gmail';
    gmailButton.addEventListener('click', () => openInGmail(card, draft));
    actions.appendChild(gmailButton);

    const feedback = document.createElement('span');
    feedback.className = 'copied';

    const copyBody = document.createElement('button');
    copyBody.type = 'button';
    copyBody.textContent = 'Copiar corpo';
    copyBody.addEventListener('click', () => copyToClipboard(draft.body, feedback, 'Corpo copiado'));
    actions.appendChild(copyBody);

    const copySubject = document.createElement('button');
    copySubject.type = 'button';
    copySubject.textContent = 'Copiar assunto';
    copySubject.addEventListener('click', () => copyToClipboard(draft.subject, feedback, 'Assunto copiado'));
    actions.appendChild(copySubject);

    if (draft.link) {
      const agendorLink = document.createElement('a');
      agendorLink.href = draft.link;
      agendorLink.target = '_blank';
      agendorLink.rel = 'noopener';
      agendorLink.textContent = 'Ver no Agendor';
      actions.appendChild(agendorLink);
    }

    actions.appendChild(feedback);
    card.appendChild(actions);
    section.appendChild(card);
  }

  if (missing.length) {
    const missingHeading = document.createElement('h2');
    missingHeading.className = 'section-title';
    missingHeading.textContent = `Sem e-mail no cadastro (${missing.length})`;
    section.appendChild(missingHeading);

    const hint = document.createElement('p');
    hint.className = 'placeholder-hint';
    hint.textContent = 'Preencha o e-mail desses contatos no Agendor para eles entrarem na próxima rodada.';
    section.appendChild(hint);

    const list = document.createElement('ul');
    list.className = 'missing-list';
    for (const item of missing) {
      const li = document.createElement('li');
      const label = item.name || 'sem contato vinculado';
      if (item.link) {
        const a = document.createElement('a');
        a.href = item.link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = label;
        li.appendChild(a);
      } else {
        li.appendChild(document.createTextNode(label));
      }
      if (item.subtitle) li.appendChild(document.createTextNode(` — ${item.subtitle}`));
      list.appendChild(li);
    }
    section.appendChild(list);
  }

  return section;
}

// Abre direto, sem confirmar a conta a cada clique — a conta é a que estiver
// no campo "Abrir na conta do Gmail" no topo da lista (ela já avisa ali, uma
// vez só, se nenhuma estiver escolhida). Marca o card como aberto, pra dar
// pra acompanhar visualmente quais dos rascunhos já foram tratados.
function openInGmail(card, draft) {
  const account = getGmailAccount();
  window.open(gmailUrlForAccount(draft.gmailUrl, account), '_blank', 'noopener');
  markDraftOpened(card);
}

function markDraftOpened(card) {
  card.classList.add('draft-card--done');
  if (card.querySelector('.draft-done-badge')) return;
  const badge = document.createElement('span');
  badge.className = 'draft-done-badge';
  badge.textContent = '✓ Aberto';
  card.querySelector('.draft-actions').appendChild(badge);
}

async function copyToClipboard(text, feedbackEl, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    feedbackEl.textContent = successMessage;
  } catch {
    // clipboard.writeText exige contexto seguro; em http://localhost o Chrome
    // permite, mas outros navegadores podem recusar.
    feedbackEl.textContent = 'Não consegui copiar, selecione o texto à mão.';
  }
  setTimeout(() => {
    feedbackEl.textContent = '';
  }, 2500);
}

function isEnabled(automation) {
  return !automation?.settings || automation.settings.enabled !== false;
}

function applyEnabledState(automation) {
  const enabled = isEnabled(automation);
  enabledToggle.checked = enabled;
  enabledToggleText.textContent = enabled ? 'Ligada' : 'Desligada';
  runButton.disabled = !enabled;
  viewEl.classList.toggle('is-disabled', !enabled);
}

function renderDisabledBanner(automation) {
  const banner = document.createElement('div');
  banner.className = 'disabled-banner';
  const changedAt = automation.settings?.changedAt;
  banner.textContent = changedAt
    ? `Automação desligada em ${formatDate(changedAt)}. Enquanto estiver assim, ninguém consegue rodá-la.`
    : 'Automação desligada. Enquanto estiver assim, ninguém consegue rodá-la.';
  return banner;
}

async function renderAutomation(automation) {
  nameEl.textContent = automation.meta.name;
  descriptionEl.textContent = automation.meta.description;
  dynamicContentEl.innerHTML = '';
  applyEnabledState(automation);

  if (automation.meta.configurable) {
    // Os modelos de e-mail vêm de um arquivo local (rápido). As listas de
    // filtro (categorias, empresas...) NÃO travam a tela: o formulário aparece
    // já, com cada campo mostrando "Carregando opções…" até a lista dele chegar.
    if (automation.meta.templateFields) {
      try {
        await loadTemplates(automation.meta.id);
      } catch {
        templatesCache[automation.meta.id] = templatesCache[automation.meta.id] || [];
      }
    }
    if (activeId !== automation.meta.id) return;
    dynamicContentEl.innerHTML = '';
    if (!isEnabled(automation)) dynamicContentEl.appendChild(renderDisabledBanner(automation));
    // A caixa da estimativa ao vivo agora é montada dentro do formulário
    // (renderConfigForm), logo antes do modelo de e-mail. Ela se recalcula
    // sozinha enquanto a pessoa mexe nos filtros.
    dynamicContentEl.appendChild(renderConfigForm(automation));
    if (automation.meta.howItWorks) dynamicContentEl.appendChild(renderHowItWorks(automation.meta.howItWorks));
    dynamicContentEl.appendChild(renderCanvasSection(automation));
    // Rascunhos: só os desta sessão (ver sessionResult). Recarregar a página
    // limpa; é preciso rodar de novo.
    if (automation.meta.resultView === 'drafts' && sessionResult[automation.meta.id]) {
      dynamicContentEl.appendChild(renderDrafts(sessionResult[automation.meta.id]));
    }
    dynamicContentEl.appendChild(renderHistoryTable(automation.state.runs, automation.meta));
    // Primeira estimativa assim que o filtro aparece.
    if (isEnabled(automation)) runLivePreview(automation);
  } else {
    if (!isEnabled(automation)) dynamicContentEl.appendChild(renderDisabledBanner(automation));
    dynamicContentEl.appendChild(renderStatusCards(automation.state));
    const runRow = document.createElement('div');
    runRow.className = 'run-row';
    runRow.appendChild(runButton);
    dynamicContentEl.appendChild(runRow);
    dynamicContentEl.appendChild(renderCanvasSection(automation));
  }
}

function selectAutomation(id) {
  activeId = id;
  emptyStateEl.hidden = true;
  viewEl.hidden = false;
  renderSidebar();
  logOutputEl.textContent = 'Nenhuma execução ainda nesta sessão.';
  renderAutomation(currentAutomation()).catch((err) => {
    dynamicContentEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'disabled-banner';
    box.textContent = 'Não consegui montar esta automação: ' + err.message;
    dynamicContentEl.appendChild(box);
  });
}

async function loadAutomations() {
  const res = await fetch('/api/automations');
  automations = await res.json();
  renderSidebar();
  if (automations.length && !activeId) {
    selectAutomation(automations[0].meta.id);
  }
}

// Agenda a estimativa para daqui a pouco. Chamado a cada mexida num filtro —
// o atraso junta várias mexidas seguidas numa requisição só.
function scheduleLivePreview(automation) {
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(() => runLivePreview(automation), 700);
}

function formatEstimate(automation, data) {
  if (!data.ok) return `Não consegui estimar: ${data.error}`;
  const examples = (sample) => {
    const shown = (sample || []).slice(0, 6).map((n) => n.trim());
    return shown.length ? `Ex.: ${shown.join(', ')}` : 'Ex.: —';
  };
  // Automação destrutiva (apagar/editar em massa): a estimativa é a última
  // chance de olhar antes de rodar, então lista os nomes em vez de só contar.
  if (automation.meta.destructive) {
    const r = data.result;
    const isEdit = getFormValues().action === 'edit';
    if (!r.count) return 'Nenhuma tarefa casa com esse filtro agora.';
    const verb = isEdit ? 'SERIAM ATUALIZADAS' : 'SERIAM APAGADAS — não tem como desfazer depois de rodar';
    const lines = [`${r.count} tarefa(s) ${verb}.`];
    if (typeof r.scannedCount === 'number' && r.scannedCount !== r.count) {
      lines.push(`(de ${r.scannedCount} encontrada(s) no dia, ${r.count} batem com o filtro.)`);
    }
    if (r.sample?.length) lines.push(...r.sample);
    if (r.count > (r.sample?.length || 0)) {
      lines.push(`+ ${r.count - r.sample.length} outra(s) — estreite o filtro pra ver todas antes de rodar.`);
    }
    return lines.join('\n');
  }
  if (automation.meta.resultView === 'drafts') {
    const r = data.result;
    const unidade = getFormValues().source === 'deals' ? 'negócio(s) nessa etapa' : 'contato(s) no filtro';
    return `${r.matchedCount} ${unidade}: ${r.readyCount} com e-mail e ${r.missingEmailCount} sem. ${examples(r.sample)}`;
  }
  const r = data.result;
  const alvo = r.kind === 'organizations' ? 'empresa(s) sem pessoa cadastrada' : 'pessoa(s)';
  const lines = [`${r.matchedCount} ${alvo} casam com os filtros atuais. ${examples(r.sample)}`];
  // Empresa/região com alvo "pessoas" dando zero costuma ser empresa sem
  // contato cadastrado — o caso que o alvo "empresas sem pessoa" resolve.
  if (r.kind === 'people' && r.matchedCount === 0 && getFormValues().source === 'organizations') {
    lines.push(
      'Se as empresas desse filtro não têm contato, troque "Criar tarefa para" para "Empresas que ainda não têm nenhuma pessoa cadastrada".'
    );
  }
  // Tarefa de e-mail/ligação: avisa em linha própria quantos do filtro não
  // têm o contato necessário, já que esses ficam de fora da criação.
  if (typeof r.missingCount === 'number' && r.missingCount > 0) {
    lines.push(`${r.missingCount} sem ${r.missingLabel} cadastrado — não vão receber tarefa.`);
  }
  return lines.join('\n');
}

async function runLivePreview(automation) {
  if (!automation || activeId !== automation.meta.id || !isEnabled(automation)) return;
  const box = dynamicContentEl.querySelector('.preview-result');
  if (!box) return;
  const text = box.querySelector('.preview-text');
  clearTimeout(livePreviewTimer);
  const token = ++livePreviewToken;
  box.hidden = false;
  box.classList.add('is-estimating');
  text.textContent = automation.meta.destructive
    ? 'Buscando quais tarefas o filtro pega…'
    : 'Calculando quantos contatos o filtro pega…';
  try {
    const res = await fetch(`/api/automations/${automation.meta.id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configToSend() }),
    });
    const data = await res.json();
    // Resposta que chegou tarde (a pessoa já mexeu no filtro de novo, ou trocou
    // de automação) não pode sobrescrever a estimativa atual.
    if (token !== livePreviewToken || activeId !== automation.meta.id) return;
    text.textContent = formatEstimate(automation, data);
  } catch (err) {
    if (token !== livePreviewToken) return;
    text.textContent = 'Não consegui estimar agora: ' + err.message;
  } finally {
    if (token === livePreviewToken) box.classList.remove('is-estimating');
  }
}

runButton.addEventListener('click', async () => {
  if (!activeId) return;
  const startedAutomation = currentAutomation();
  const startedActionLabels = startedAutomation?.meta.actionLabels?.[getFormValues().action];
  runButton.disabled = true;
  runButton.classList.add('is-running');
  runButton.textContent = startedActionLabels?.running || startedAutomation?.meta.runningLabel || 'Rodando...';
  logOutputEl.textContent = 'Executando...';

  try {
    const res = await fetch(`/api/automations/${activeId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configToSend() }),
    });
    const data = await res.json();
    logOutputEl.textContent = (data.logs || []).join('\n') || data.error || '(sem saída)';
    if (data.ok) {
      // O resultado da rodada vive só nesta sessão do navegador. renderAutomation
      // desenha os rascunhos a partir daqui; some ao recarregar a página.
      if (currentAutomation()?.meta.resultView === 'drafts' && data.result) {
        sessionResult[activeId] = data.result;
      }
      await loadAutomations();
      const automation = currentAutomation();
      await renderAutomation(automation);
      logOutputEl.textContent = (data.logs || []).join('\n');
      const drafts = dynamicContentEl.querySelector('.drafts-section');
      if (drafts) drafts.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    logOutputEl.textContent = 'Erro ao chamar o servidor: ' + err.message;
  } finally {
    runButton.disabled = false;
    runButton.classList.remove('is-running');
    runButton.textContent = startedActionLabels?.run || startedAutomation?.meta.runLabel || 'Rodar agora';
  }
});

enabledToggle.addEventListener('change', async () => {
  if (!activeId) return;
  const desired = enabledToggle.checked;
  enabledToggle.disabled = true;
  try {
    const res = await fetch(`/api/automations/${activeId}/enabled`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: desired }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'resposta inesperada do servidor');
    const automation = currentAutomation();
    automation.settings = data.settings;
    renderSidebar();
    await renderAutomation(automation);
  } catch (err) {
    // Volta o botão para onde estava: o estado que vale é o do servidor.
    enabledToggle.checked = !desired;
    logOutputEl.textContent = 'Não consegui mudar o liga/desliga: ' + err.message;
  } finally {
    enabledToggle.disabled = false;
  }
});

loadAutomations();
