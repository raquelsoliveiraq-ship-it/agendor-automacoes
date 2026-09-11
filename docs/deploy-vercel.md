# Deploy compartilhado na Vercel — plano de ajustes e testes

Objetivo: publicar o dashboard num endereço fixo para **Raquel e Plínio** usarem
as automações **Rascunhos de e-mail** e **Tarefas em massa por filtro**. A
automação "E-mail para novo Cliente Efetivo" sai do projeto.

Este documento é o roteiro. Cada bloco de ajuste tem uma checklist; siga na
ordem da seção 7.

---

## 1. Decisões já tomadas

| Tema | Decisão | Motivo |
|------|---------|--------|
| Plano Vercel | **Hobby (grátis)** | Suficiente para 2 pessoas. Limite: 60s por execução (via `maxDuration`). |
| Armazenamento | **Vercel KV / Upstash Redis** | Os stores atuais já gravam/leem blocos JSON inteiros — adaptação mínima. |
| Acesso | **Senha compartilhada** (HTTP Basic Auth) | Plínio não precisa de conta em lugar nenhum. Uma senha só, em variável de ambiente. |
| Token Agendor | **1 token só**, em variável de ambiente | É a "conta criadora" das tarefas. Ver seção 5. |

---

## 2. O que quebra na Vercel hoje (e por quê)

1. **Persistência em arquivo.** `src/stateStore.js`, `src/settingsStore.js` e
   `src/templateStore.js` gravam em `.state/*.json` com `fs.writeFileSync`. Na
   Vercel o disco do projeto é **somente leitura** e o `/tmp` é **efêmero e não
   compartilhado** entre execuções. Resultado: rascunhos salvos, modelos,
   liga/desliga e histórico não sobreviveriam. → **Seção 3.2**
2. **`app.listen()`.** A Vercel não roda um servidor de porta; roda uma função.
   O Express precisa ser exportado como handler. → **Seção 3.3**
3. **Sem autenticação.** Em `localhost` tudo bem; num endereço público qualquer
   um com o link dispararia criação de tarefas no Agendor. → **Seção 3.4**
4. **`node --watch` / porta 4141.** Só fazem sentido local. Continuam existindo
   para desenvolvimento; a Vercel os ignora.

---

> **Filtros do Agendor:** já implementados (Opção B — modo "Empresa / região" nas
> duas automações). Detalhes, o que a API aceita e o que depende dos dados no
> Agendor: [`filtros-agendor.md`](filtros-agendor.md). O modo empresa faz o dobro
> de páginas (empresas + pessoas) — de olho no limite de 60s do plano Hobby em
> filtros sem recorte.

## 3. Ajustes no código

### 3.1 Remover a automação "E-mail para novo Cliente Efetivo" ✅ FEITO (10/09/2026)

- [x] `src/automations/index.js`: removido o `import` e a entrada do array.
- [x] Apagado `src/automations/clienteEfetivoEmail.js`.
- [x] Apagado `src/runAutomation.js` e removido o script `"start"` do `package.json`.
- [x] `README.md`: removido o item da lista "Automações atuais" e a seção
      "Rodar sem o dashboard".
- [x] `src/inspect.js` mantido — utilitário read-only de diagnóstico do token.
- [x] `.state/cliente-efetivo-email.json` apagado (era local, gitignored).

**Teste:** `npm run dashboard`, abrir `localhost:4141`, confirmar que a barra
lateral mostra só as duas automações e ambas abrem sem erro.

---

### 3.2 Trocar persistência de arquivo → Vercel KV (com fallback local)

A ideia: um adaptador único que usa o KV quando as variáveis dele existem
(ambiente Vercel) e cai no arquivo `.state/` quando não existem (dev local sem
Redis). Assim o `npm run dashboard` continua funcionando sem configurar nada.

- [ ] `npm install @vercel/kv` (ou `@upstash/redis` — ver nota no fim da seção).
- [ ] Criar `src/storage.js` com duas funções genéricas:
  - `readJSON(key, fallback)` → objeto
  - `writeJSON(key, value)` → void
  - Dentro: se `process.env.KV_REST_API_URL` existir, usa o KV; senão,
    lê/grava `.state/<key>.json` (comportamento de hoje).
  - **Ambas assíncronas.**
- [ ] Reescrever os três stores por cima de `src/storage.js`:
  - `stateStore.js`: `loadState(id)` → `readJSON('state:'+id, default)`;
    `saveState(id, s)` → `writeJSON('state:'+id, s)`. **Viram async.**
  - `settingsStore.js`: chave `settings`. `getAutomationSettings` e
    `setAutomationEnabled` **viram async**.
  - `templateStore.js`: chave `templates`. `listTemplates`, `saveTemplate`,
    `deleteTemplate` **viram async**.
- [ ] Propagar o `await` (o compilador não avisa — é preciso caçar cada chamada):
  - `src/automations/emailDrafts.js`: `getState()` vira `async`; dentro de
    `run()` trocar `const state = getState()` por `await getState()`.
  - `src/automations/bulkTasksByFilter.js`: idem.
  - `src/automations/index.js`: o `/api/automations` monta a lista chamando
    `getState()` e `getAutomationSettings()` — passar para
    `await Promise.all(automations.map(async (a) => ({...})))`.
  - `src/server.js`: `await` em todos os handlers que tocam os stores
    (`/api/automations`, `PUT .../enabled`, os quatro de `/templates`,
    `/run`). Todos os handlers já são `async` ou podem virar.
- [ ] `.gitignore` mantém `.state/` ignorado (continua sendo o fallback local).

**Chaves no KV:**

| Chave | Conteúdo |
|-------|----------|
| `settings` | `{ automations: { "<id>": { enabled, changedAt, changedBy } } }` |
| `templates` | `{ "<id>": [ {id, name, values, updatedAt} ] }` |
| `state:email-drafts` | `{ runs: [...], lastResult: {...} }` |
| `state:bulk-tasks-by-filter` | `{ runs: [...] }` |

**Teste local:** sem variáveis de KV, `npm run dashboard` deve se comportar
igual a hoje (lê/grava `.state/`). Rodar as duas automações, recarregar a
página, conferir que rascunhos/histórico/modelos persistem.

> **Nota sobre o pacote:** a Vercel migrou o "KV" para o marketplace da Upstash.
> Ao criar o banco (seção 4) o painel diz qual pacote usar e injeta as
> variáveis. Se for `@vercel/kv`, as vars são `KV_REST_API_URL` /
> `KV_REST_API_TOKEN`. Se for `@upstash/redis`, são `UPSTASH_REDIS_REST_URL` /
> `UPSTASH_REDIS_REST_TOKEN`. O adaptador em `src/storage.js` só precisa checar a
> que existir.

---

### 3.3 Porta de entrada serverless

- [ ] Extrair o app do `src/server.js` para `src/app.js`:
  - `src/app.js` monta o Express (`express()`, `app.use`, todas as rotas) e faz
    `export default app`. **Sem `app.listen`.**
  - `src/server.js` passa a ser só: `import app from './app.js'` +
    `app.listen(PORT, ...)` + a mensagem de porta ocupada. É o entrypoint local
    (`npm run dashboard`).
- [ ] Criar `api/index.js` na raiz:
  ```js
  import app from '../src/app.js';
  export default app;
  ```
- [ ] Criar `vercel.json` na raiz:
  ```json
  {
    "functions": { "api/index.js": { "maxDuration": 60 } },
    "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
  }
  ```
  Todo o tráfego (inclusive `index.html`, `styles.css`, `app.js`, `canvas.js`)
  passa pelo Express — que já serve `public/` via `express.static`. Isso deixa a
  senha (3.4) proteger tudo, não só a API.
- [ ] `package.json`: adicionar `"engines": { "node": ">=18" }`. Não precisa de
      script de build — não há build.

**Teste:** `npx vercel dev` (simula o ambiente da Vercel localmente) e abrir a
URL que ele imprime. Tudo deve funcionar como no `npm run dashboard`.

---

### 3.4 Senha compartilhada (HTTP Basic Auth)

- [ ] Middleware em `src/app.js`, **antes de todas as rotas**:
  - Lê o header `Authorization: Basic ...`.
  - Compara com `process.env.DASHBOARD_USER` (default `equipe`) e
    `process.env.DASHBOARD_PASSWORD`.
  - Sem `DASHBOARD_PASSWORD` definida → libera tudo (dev local).
  - Senha errada → `401` com `WWW-Authenticate: Basic realm="Automações Agendor"`
    (o navegador mostra o popup nativo de login).
  - Comparar com `crypto.timingSafeEqual` para não vazar timing.
- [ ] Sem dependência nova — dá para fazer com o `Buffer` e `crypto` nativos.

**Teste:** com `DASHBOARD_PASSWORD` setada, abrir a URL → navegador pede
usuário/senha. Senha errada barra; certa entra e fica salva na sessão do
navegador.

---

## 4. Passo a passo do deploy

Pré-requisito: os ajustes da seção 3 commitados e no GitHub
(`raquelsoliveiraq-ship-it/agendor-automacoes`). Sugestão: fazer numa branch
(`deploy-vercel`) e abrir Pull Request, para testar no *preview* antes de mexer
no `main`.

1. **Criar conta na Vercel** (login com o GitHub) — plano Hobby.
2. **Import Project** → escolher o repositório `agendor-automacoes`.
   - Framework Preset: **Other**. Build Command: vazio. Output: vazio.
   - Não fazer deploy ainda (ou deixar falhar — falta env).
3. **Storage** → *Create Database* → **KV / Upstash for Redis** → região mais
   perto do Brasil (por ex. `us-east-1`) → *Connect to Project*. Isso injeta as
   variáveis `KV_*` / `UPSTASH_*` automaticamente.
4. **Settings → Environment Variables** → adicionar (nos 3 ambientes:
   Production, Preview, Development):
   - `AGENDOR_TOKEN` = token da API do Agendor (ver seção 5)
   - `DASHBOARD_PASSWORD` = a senha combinada entre vocês dois
   - `DASHBOARD_USER` = opcional (default `equipe`)
5. **Deploy** (Deployments → Redeploy, ou push na branch).
6. Abrir a URL de **preview** e rodar a seção 6.2.
7. Se tudo passar: **Promote to Production** (ou fazer merge do PR no `main`).
8. Guardar a URL de produção e a senha num lugar que os dois acessem.

---

## 5. Sobre o token do Agendor

- É **um token só** para o dashboard inteiro. Quem for o dono desse token
  aparece como **criador** das tarefas geradas por "Tarefas em massa".
- Em "Tarefas em massa" o **responsável pela tarefa** é escolhido no formulário
  (campo "Atribuir tarefa para"), então isso independe do token.
- "Rascunhos de e-mail" **não escreve nada** no Agendor — só lê. O token serve
  para listar pessoas/negócios/categorias.
- Sugestão: usar o token da conta da Raquel, ou criar um usuário dedicado de
  integração no Agendor se quiserem separar. Trocar depois é só editar a
  variável e redeployar.
- O token **nunca** chega ao navegador — fica só no servidor.

---

## 6. Plano de testes

### 6.1 Local (antes de subir) — `npm run dashboard`

- [ ] Servidor sobe sem erro; barra lateral mostra **só 2** automações.
- [ ] **Rascunhos de e-mail:**
  - [ ] A estimativa abaixo do filtro se recalcula sozinha ao mudar um campo, e
        a conta bate com a mesma busca no Agendor.
  - [ ] *Rodar agora* → monta os rascunhos; resumo "encontrados X, Y com e-mail,
        Z sem" aparece.
  - [ ] Recarregar a página (F5) → **os rascunhos somem** (ficam só na sessão);
        o histórico de execuções continua.
  - [ ] Salvar um modelo com nome; recarregar; aplicar o modelo → assunto/corpo
        voltam (modelos continuam salvos).
  - [ ] Contato sem e-mail aparece na lista à parte (não some).
  - [ ] Botão "abrir no Gmail" abre a janela de escrita preenchida.
- [ ] **Tarefas em massa por filtro:**
  - [ ] A estimativa abaixo do filtro se recalcula sozinha e a conta bate.
  - [ ] *Rodar agora* com um filtro **pequeno** (1–2 pessoas, ex. filtrar por uma
        empresa específica) → tarefas criadas; conferir **no Agendor** que
        apareceram com data/hora/responsável certos.
  - [ ] Histórico da execução aparece na tela.
- [ ] Liga/desliga: desligar uma automação, **reiniciar o servidor**, abrir de
      novo → continua desligada (persistiu).

### 6.2 Preview na Vercel

- [ ] Abrir a URL → navegador pede senha. Senha errada barra; certa entra.
- [ ] Primeira carga do formulário demora alguns segundos (lista de empresas, e
      o *cold start* perde o cache em memória) mas **completa**.
- [ ] **Rascunhos** com filtro pequeno → roda em menos de 60s.
- [ ] **Persistência entre execuções:** rodar rascunhos, fechar a aba, abrir a
      URL **em outro dispositivo/navegador**, logar → os mesmos rascunhos e
      modelos estão lá.
- [ ] Plínio abre a URL no computador dele, loga com a senha → vê os mesmos
      dados que a Raquel.
- [ ] **Tarefas em massa** com filtro pequeno → cria; conferir no Agendor.
- [ ] **Teste de limite (proposital):** rodar "Rascunhos" **sem filtro nenhum**
      (pega todo mundo) e anotar se estoura os 60s. Serve para saber o tamanho
      máximo de lote seguro e escrever isso no README.

### 6.3 Produção

- [ ] Promover o deploy.
- [ ] Uma rodada real pequena de cada automação.
- [ ] Conferir no Agendor.
- [ ] Anotar URL + senha no lugar combinado.

---

## 7. Ordem de execução recomendada

1. **3.1** — remover a automação. Mudança isolada, testável de imediato (6.1
   parcial).
2. **3.2** — KV com fallback local. Testar local sem KV (tem que continuar
   funcionando via `.state/`). Rodar 6.1 inteira.
3. **3.3 + 3.4** — serverless + senha. Testar com `npx vercel dev`.
4. **Deploy em branch/PR** (seção 4) → preview → testes 6.2.
5. **Produção** (seção 4, passo 7) → testes 6.3.
6. Atualizar o `README.md`: seção nova "Uso compartilhado (Vercel)" com a URL, e
   o limite prático de lote descoberto no teste 6.2.

---

## 8. Riscos e limites conhecidos

- **Timeout de 60s.** Rodadas com muitos contatos/negócios podem falhar no meio.
  "Tarefas em massa" cria **uma tarefa por vez** — se cortar no meio, as
  primeiras já foram criadas e **não há retomada**: rodar de novo criaria
  duplicatas. Mitigação: sempre filtrar (por responsável, empresa ou categoria)
  para lotes menores.
  - *Melhoria futura possível:* marcar quais pessoas já receberam tarefa naquela
    rodada e pular na re-execução (idempotência).
- **Cold start.** A cada função "fria", a lista de empresas é re-paginada (até 50
  requests) porque o cache é em memória. Aceitável para 2 usuários; a primeira
  tela do dia é mais lenta.
- **Estimativa ao vivo.** Cada mudança de filtro dispara uma pré-visualização
  (com atraso de 700 ms para juntar mudanças seguidas). No modo "Empresa /
  região" isso é ~9 requisições / alguns segundos por estimativa. Nunca cria
  nada — no pior caso a estimativa demora ou falha e some. Se ficar pesado na
  Vercel, dá para aumentar o atraso ou voltar a estimativa para um botão.
- **Sem registro de quem fez o quê.** A senha é única, então o `changedBy` do
  liga/desliga fica `null` e o histórico não distingue Raquel de Plínio. Se
  quiserem isso depois: duas senhas nomeadas (`DASHBOARD_USERS` = JSON) e passar
  o usuário para os stores.
- **Limites do KV grátis (Upstash).** ~10 mil comandos/dia e ~256 MB. Folgado
  para este uso — cada ação do dashboard são poucos comandos.
- **`AGENDOR_TOKEN` compartilhado.** Todas as tarefas saem como criadas pela
  mesma conta. Ver seção 5.
- **Rascunhos volumosos.** `state:email-drafts` guarda a última rodada inteira
  (hoje ~14 KB). Uma rodada com centenas de contatos pode gerar um valor grande
  no KV — dentro do limite, mas de olho se as rodadas crescerem muito.

---

## 9. Arquivos que vão mudar (resumo)

| Arquivo | Mudança |
|---------|---------|
| `src/automations/index.js` | tira a automação Cliente Efetivo |
| `src/automations/clienteEfetivoEmail.js` | **apagado** |
| `src/runAutomation.js` | **apagado** |
| `src/inspect.js` | sem mudança |
| `package.json` | tira `"start"`, adiciona `"engines"`, adiciona `@vercel/kv` |
| `src/storage.js` | **novo** — adaptador KV / arquivo |
| `src/stateStore.js` | usa `storage.js`, vira async |
| `src/settingsStore.js` | usa `storage.js`, vira async |
| `src/templateStore.js` | usa `storage.js`, vira async |
| `src/app.js` | **novo** — Express sem `listen` + middleware de senha |
| `src/server.js` | vira só o entrypoint local (`listen`) |
| `api/index.js` | **novo** — handler da Vercel |
| `vercel.json` | **novo** — `maxDuration` + rewrites |
| `src/automations/emailDrafts.js` | `await` nos stores |
| `src/automations/bulkTasksByFilter.js` | `await` nos stores |
| `src/automations/peopleQuery.js` | `await` nos stores (se algum dia guardar estado — hoje não guarda) |
| `src/server.js` handlers → `src/app.js` | `await` nos stores |
| `README.md` | tira automação 2, adiciona seção Vercel |

> Filtros por empresa/região (`peopleQuery.js`, `listOrganizationsByFilters`
> etc.) já entraram — ver `filtros-agendor.md`.
