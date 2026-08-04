import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { automations, findAutomation } from './automations/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4141;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/automations', (req, res) => {
  const list = automations.map((a) => ({
    meta: a.meta,
    state: a.getState(),
  }));
  res.json(list);
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

  const logs = [];
  const log = (msg) => logs.push(String(msg));

  try {
    const result = await automation.run({ log, config: req.body.config });
    res.json({ ok: true, logs, result, state: automation.getState() });
  } catch (err) {
    log(`Falha ao rodar a automação: ${err.status ?? ''} ${JSON.stringify(err.body ?? err.message ?? err)}`);
    res.status(500).json({ ok: false, logs, error: err.message ?? String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard rodando em http://localhost:${PORT}`);
});
