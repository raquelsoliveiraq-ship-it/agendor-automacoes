import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { automations, findAutomation } from './automations/index.js';
import { getAutomationSettings, setAutomationEnabled } from './settingsStore.js';
import { listTemplates, saveTemplate, deleteTemplate } from './templateStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Senha compartilhada (HTTP Basic Auth). Sem DASHBOARD_PASSWORD definida —
// caso do dev local — libera tudo, para não exigir configuração para rodar
// `npm run dashboard`. Protege a app inteira (inclusive os arquivos estáticos
// de public/), não só a API, porque o middleware vem antes de tudo.
function checkAuth(req, res, next) {
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedPassword) return next();

  const expectedUser = process.env.DASHBOARD_USER || 'equipe';
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const [user, password] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    const userBuf = Buffer.from(String(user || ''));
    const passBuf = Buffer.from(String(password || ''));
    const expectedUserBuf = Buffer.from(expectedUser);
    const expectedPassBuf = Buffer.from(expectedPassword);
    const userOk =
      userBuf.length === expectedUserBuf.length && crypto.timingSafeEqual(userBuf, expectedUserBuf);
    const passOk =
      passBuf.length === expectedPassBuf.length && crypto.timingSafeEqual(passBuf, expectedPassBuf);
    if (userOk && passOk) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Automações Agendor"');
  res.status(401).send('Autenticação necessária.');
}

app.use(checkAuth);
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/automations', async (req, res) => {
  const list = await Promise.all(
    automations.map(async (a) => ({
      meta: a.meta,
      state: await a.getState(),
      settings: await getAutomationSettings(a.meta.id),
    }))
  );
  res.json(list);
});

app.put('/api/automations/:id/enabled', async (req, res) => {
  const automation = findAutomation(req.params.id);
  if (!automation) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  const settings = await setAutomationEnabled(req.params.id, req.body.enabled, req.body.changedBy ?? null);
  res.json({ ok: true, settings });
});

app.get('/api/automations/:id/templates', async (req, res) => {
  if (!findAutomation(req.params.id)) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  res.json(await listTemplates(req.params.id));
});

app.post('/api/automations/:id/templates', async (req, res) => {
  if (!findAutomation(req.params.id)) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  try {
    const templates = await saveTemplate(req.params.id, { name: req.body.name, values: req.body.values });
    res.json({ ok: true, templates });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message ?? String(err) });
  }
});

app.delete('/api/automations/:id/templates/:templateId', async (req, res) => {
  if (!findAutomation(req.params.id)) {
    res.status(404).json({ error: 'Automação não encontrada' });
    return;
  }
  res.json({ ok: true, templates: await deleteTemplate(req.params.id, req.params.templateId) });
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

  if (!(await getAutomationSettings(req.params.id)).enabled) {
    res.status(409).json({ ok: false, error: 'Esta automação está desligada. Ligue no botão do topo para poder rodar.' });
    return;
  }

  const logs = [];
  const log = (msg) => logs.push(String(msg));

  try {
    const result = await automation.run({ log, config: req.body.config });
    res.json({ ok: true, logs, result, state: await automation.getState(), settings: await getAutomationSettings(req.params.id) });
  } catch (err) {
    log(`Falha ao rodar a automação: ${err.status ?? ''} ${JSON.stringify(err.body ?? err.message ?? err)}`);
    res.status(500).json({ ok: false, logs, error: err.message ?? String(err) });
  }
});

export default app;
