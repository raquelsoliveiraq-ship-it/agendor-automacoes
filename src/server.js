import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { automations, findAutomation } from './automations/index.js';
import { getAutomationSettings, setAutomationEnabled } from './settingsStore.js';
import { listTemplates, saveTemplate, deleteTemplate } from './templateStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4141;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/automations', (req, res) => {
  const list = automations.map((a) => ({
    meta: a.meta,
    state: a.getState(),
    settings: getAutomationSettings(a.meta.id),
  }));
  res.json(list);
});

app.put('/api/automations/:id/enabled', (req, res) => {
  const automation = findAutomation(req.params.id);
  if (!automation) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  const settings = setAutomationEnabled(req.params.id, req.body.enabled, req.body.changedBy ?? null);
  res.json({ ok: true, settings });
});

app.get('/api/automations/:id/templates', (req, res) => {
  if (!findAutomation(req.params.id)) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  res.json(listTemplates(req.params.id));
});

app.post('/api/automations/:id/templates', (req, res) => {
  if (!findAutomation(req.params.id)) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  try {
    const templates = saveTemplate(req.params.id, { name: req.body.name, values: req.body.values });
    res.json({ ok: true, templates });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message ?? String(err) });
  }
});

app.delete('/api/automations/:id/templates/:templateId', (req, res) => {
  if (!findAutomation(req.params.id)) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  res.json({ ok: true, templates: deleteTemplate(req.params.id, req.params.templateId) });
});

app.get('/api/automations/:id/options/:source', async (req, res) => {
  const automation = findAutomation(req.params.id);
  if (!automation?.getOptions) {
    res.status(404).json({ error: 'Automação ou fonte de opções não encontrada' });
    return;
  }
  try {
    const options = await automation.getOptions(req.params.source);
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message ?? String(err) });
  }
});

app.post('/api/automations/:id/preview', async (req, res) => {
  const automation = findAutomation(req.params.id);
  if (!automation?.preview) {
    res.status(404).json({ error: 'Automação não suporta pré-visualização' });
    return;
  }
  try {
    const result = await automation.preview(req.body.config || {});
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message ?? String(err) });
  }
});

app.post('/api/automations/:id/run', async (req, res) => {
  const automation = findAutomation(req.params.id);
  if (!automation) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }

  if (!getAutomationSettings(req.params.id).enabled) {
    res.status(409).json({ ok: false, error: 'Esta automação está desligada. Ligue no botão do topo para poder rodar.' });
    return;
  }

  const logs = [];
  const log = (msg) => logs.push(String(msg));

  try {
    const result = await automation.run({ log, config: req.body.config });
    res.json({ ok: true, logs, result, state: automation.getState(), settings: getAutomationSettings(req.params.id) });
  } catch (err) {
    log(`Falha ao rodar a automação: ${err.status ?? ''} ${JSON.stringify(err.body ?? err.message ?? err)}`);
    res.status(500).json({ ok: false, logs, error: err.message ?? String(err) });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Dashboard rodando em http://localhost:${PORT}`);
});

// Mensagem clara quando a porta já está ocupada — em vez do stack trace do
// Node — porque o caso comum é ter um dashboard antigo ainda rodando.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nA porta ${PORT} já está em uso. Provavelmente há outro "npm run dashboard" aberto.\n` +
        `Feche aquele terminal (ou o processo na porta ${PORT}) e rode de novo,\n` +
        `ou mude PORT no arquivo .env para outro número.\n`
    );
    process.exit(1);
  }
  throw err;
});
