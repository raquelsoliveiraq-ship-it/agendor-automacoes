import { loadState, saveState } from './stateStore.js';

// Cache das listas de opção dos filtros (categorias, empresas, setores...).
// Elas mudam devagar e algumas são lentas de buscar (a lista de empresas são
// vários requests paginados). Guardado em memória E em disco
// (`.state/options-cache.json`), para sobreviver ao restart do `node --watch`
// e ao primeiro acesso do dia — sem isso o dashboard fica "Carregando opções
// de filtro..." toda vez que o servidor reinicia.

const CACHE_KEY = 'options-cache';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

const mem = {}; // { [key]: { data, at } }
let disk = null; // snapshot compartilhado de .state/options-cache.json

function fresh(entry) {
  return entry && Date.now() - entry.at < TTL_MS;
}

function diskCache() {
  if (disk === null) disk = loadState(CACHE_KEY, {});
  return disk;
}

export async function cachedOptions(key, compute) {
  if (fresh(mem[key])) return mem[key].data;

  const d = diskCache();
  if (fresh(d[key])) {
    mem[key] = d[key];
    return d[key].data;
  }

  const data = await compute();
  const entry = { data, at: Date.now() };
  mem[key] = entry;
  // Chamadas concorrentes mutam o mesmo objeto `disk`, então cada gravação
  // carrega todas as chaves já resolvidas (a última a escrever não apaga as
  // outras).
  d[key] = entry;
  saveState(CACHE_KEY, d);
  return data;
}
