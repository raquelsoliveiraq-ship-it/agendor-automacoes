import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', '.state');

// Adaptador único de persistência: usa o banco (KV/Upstash Redis) quando as
// variáveis de ambiente dele existem — caso da Vercel, onde o disco é só
// leitura — e cai no arquivo local (`.state/*.json`) quando não existem, que é
// o caso do `npm run dashboard` sem nada configurado. A API REST da Vercel KV
// é compatível com a do Upstash, então o mesmo cliente serve para as duas
// (`KV_REST_API_URL`/`KV_REST_API_TOKEN` ou `UPSTASH_REDIS_REST_URL`/
// `UPSTASH_REDIS_REST_TOKEN` — usa o par que existir).
let redisClient;

async function getRedis() {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisClient = null;
    return redisClient;
  }
  // Import tardio: em dev local sem essas variáveis, o pacote nem precisa
  // inicializar um cliente.
  const { Redis } = await import('@upstash/redis');
  redisClient = new Redis({ url, token });
  return redisClient;
}

// No arquivo local, cada automação/registro já tinha seu próprio arquivo antes
// do KV existir (`bulk-tasks-by-filter.json`, `settings.json`...). O prefixo
// `state:` das chaves é só para não colidir nomes dentro do KV (que é um
// espaço só); no disco ele não faz falta — tirar mantém os nomes de arquivo
// iguais aos de antes, para não perder o histórico já salvo.
function filePath(key) {
  const name = key.startsWith('state:') ? key.slice('state:'.length) : key;
  return path.join(STATE_DIR, `${name}.json`);
}

export async function readJSON(key, fallback) {
  const redis = await getRedis();
  if (redis) {
    const value = await redis.get(key);
    return value ?? { ...fallback };
  }
  const file = filePath(key);
  if (!fs.existsSync(file)) return { ...fallback };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Arquivo corrompido (escrita interrompida, etc.) — volta ao padrão em vez
    // de derrubar o dashboard.
    return { ...fallback };
  }
}

export async function writeJSON(key, value) {
  const redis = await getRedis();
  if (redis) {
    await redis.set(key, value);
    return;
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(filePath(key), JSON.stringify(value, null, 2));
}
