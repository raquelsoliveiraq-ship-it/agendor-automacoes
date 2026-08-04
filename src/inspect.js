import 'dotenv/config';
import { listCategories, getCurrentUser } from './agendorClient.js';

// Utilitário read-only para checar se o token no .env está funcionando
// e ver as categorias/usuário disponíveis, antes de rodar a automação.

const categories = await listCategories();
console.log('Categorias disponíveis:');
for (const c of categories) console.log(`  - ${c.name} (id ${c.id})`);

const user = await getCurrentUser();
console.log(`\nToken válido para: ${user.name} (id ${user.id})`);
