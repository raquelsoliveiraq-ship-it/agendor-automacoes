import 'dotenv/config';
import { run } from './automations/clienteEfetivoEmail.js';

run({ log: console.log }).catch((err) => {
  console.error('Falha ao rodar a automação:', err.status ?? '', err.body ?? err.message ?? err);
  process.exit(1);
});
