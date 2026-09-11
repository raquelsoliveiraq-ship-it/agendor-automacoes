# Filtros do Agendor nas automações

Objetivo: oferecer nas automações "Rascunhos de e-mail" e "Tarefas em massa por
filtro" os mesmos filtros que existem na busca avançada do Agendor (o painel
"Filtrar" das telas de Pessoas / Empresas / Negócios).

Este documento tem: (1) o que a API **realmente** aceita como filtro — testado na
conta de vocês em 10/09/2026, porque **a documentação oficial da Agendor não lista
nenhum parâmetro de filtro**; (2) o que foi implementado; (3) o que ainda depende
dos dados no Agendor.

> **Status (10/09/2026): implementado.** Decisão tomada: **Opção B** (filtrar
> empresas e agir sobre as pessoas delas), nas **duas** automações. Ver seção 3.

---

## 1. Bug corrigido ✅

`src/agendorClient.js → listPeopleByFilters()` mandava o responsável como
`ownerUser=<id>`. **A API ignora esse parâmetro em silêncio** — o nome certo é
`userOwner`. O filtro "Responsável" das duas automações **não fazia nada**;
parecia funcionar só porque o Plínio é dono de 293 das 300 pessoas. Corrigido:
agora manda `userOwner`.

---

## 2. O que a API aceita como filtro (testado empiricamente)

Método do teste: pegar a contagem total, aplicar o filtro com um id/valor real e
ver se a contagem cai (funciona) ou fica idêntica (ignorado). Conta de vocês:
300 pessoas, 598 empresas, 38 negócios.

### `GET /people`

| Filtro (no Agendor) | Parâmetro | Funciona? | Observação |
|---|---|---|---|
| Categoria | `category=<id>` | ✅ | já usado hoje |
| Origem | `leadOrigin=<id>` | ✅ | ids em `GET /lead_origins` |
| Responsável | `userOwner=<userId>` | ✅ | **não** `ownerUser` (ver bug acima) |
| Empresa | `organization=<id>` | ✅ | já usado hoje |
| Estado | `state=<UF>` | ✅ | sigla **maiúscula** (`RJ`, `SP`); minúscula dá erro 400 |
| Cidade | `cityName=<nome>` | ✅ | texto livre, **não** `city` |
| Setor | — | ❌ | setor é atributo da empresa, não da pessoa |
| Produtos | — | ❌ | ignorado em `/people` |
| Próxima tarefa / com ou sem tarefa | — | ❌ | `hasTasks`, `withoutTasks`, `nextTaskBefore` — todos ignorados |

> ⚠️ **Importante para a conta de vocês:** quase nenhuma *pessoa* tem
> estado/cidade preenchidos — `state=RJ` devolveu **1 pessoa**. Esses dados
> moram na *empresa* (lá `state=RJ` devolveu 150). Ver a decisão na seção 3.

### `GET /organizations`

| Filtro | Parâmetro | Funciona? | Observação |
|---|---|---|---|
| Categoria | `category=<id>` | ✅ | mesma lista de `/categories` |
| Origem | `leadOrigin=<id>` | ✅ | |
| Setor | `sector=<id>` | ✅ | ids em `GET /sectors` |
| Responsável | `userOwner=<userId>` | ✅ | |
| Estado | `state=<UF>` | ✅ | sigla maiúscula |
| Cidade | `cityName=<nome>` | ✅ | texto livre (**não** `city`) |
| Produtos | `products=<id>` | ⚠️ | parâmetro reconhecido (plural `products`, não `product`); devolveu 0 no teste porque **nenhum produto da conta está ligado a uma empresa** — os produtos estão nos negócios. Vai funcionar quando/se vocês vincularem produtos às empresas. |
| Próxima tarefa | — | ❌ | |

### `GET /deals` (negócios — usado no modo "por etapa do funil" dos Rascunhos)

| Filtro | Parâmetro | Funciona? |
|---|---|---|
| Etapa do funil | `dealStage=<id>` | ✅ já usado |
| Situação (andamento/ganho/perdido) | `dealStatus=<1\|2\|3>` | ✅ já usado |
| Responsável | `userOwner=<userId>` | ✅ funciona, mas **não** foi adicionado ao modo "Etapa do funil" ainda (fora do escopo da Opção B) |
| Categoria / Origem / Funil inteiro | — | ❌ ignorados |

### Listas para os menus (dropdowns)

| Menu | Endpoint | Qtd na conta |
|---|---|---|
| Categoria | `GET /categories` | 6 |
| Origem | `GET /lead_origins` | 3 |
| Setor | `GET /sectors` | 8 |
| Produtos | `GET /products` | 5 |
| Responsável | `GET /users` | (já usado) |
| Etapa do funil | `GET /deal_stages` | (já usado) |
| Estado | lista fixa de UFs (não há endpoint) | 27 |
| Cidade | **não há endpoint** — `orgFilterOptions('cities')` monta a lista com as cidades que aparecem no endereço das empresas (`address.city`), sem repetir, em ordem alfabética | 12 na conta (todas RJ) |

### Limitações gerais

- **Um valor por filtro.** `category=1,2` e `category[]=1&category[]=2` dão erro
  400. Não dá pra "categoria A ou B" numa automação só.
- Vários filtros juntos = **E** (interseção): `category=X&userOwner=Y` devolve
  quem é da categoria X **e** do responsável Y.
- Sem filtro de data que funcione (`updatedAfter`, `nextTaskBefore` etc. são
  ignorados).

---

## 3. O que foi implementado (Opção B)

As duas automações agem sobre **pessoas** (montam e-mail / criam tarefa para a
pessoa). O print que você mandou é a tela de **Empresas**, e na conta de vocês os
dados de **Setor, Estado, Cidade e Origem estão na empresa, não na pessoa**. Por
isso a Opção B: um modo que filtra as **empresas** e age sobre as **pessoas**
delas.

### Seletor "Filtrar por"

**Rascunhos de e-mail** — três modos:
`Categoria de cliente` (pessoas) · **`Empresa / região`** (empresas, novo) ·
`Etapa do funil de vendas` (negócios).

**Tarefas em massa por filtro** — dois modos (não tinha nenhum antes):
`Categoria de cliente` (pessoas) · **`Empresa / região`** (empresas, novo).

### Filtros de cada modo

| Campo | `Categoria de cliente` | `Empresa / região` |
|---|:---:|:---:|
| Categoria | ✅ (da pessoa) | ✅ (da empresa) |
| Responsável | ✅ (da pessoa) | ✅ (da empresa) |
| Empresa (uma específica) | ✅ | — |
| Origem | — | ✅ |
| Setor | — | ✅ |
| Estado (UF) | — | ✅ |
| Cidade | — | ✅ |
| Produto | — | ✅ |

### Como o modo "Empresa / região" funciona por dentro

Não busca as pessoas empresa por empresa (seriam centenas de requests). Lista as
empresas que casam com o filtro, puxa **todas** as pessoas paginando uma vez e
fica com as que têm `organization.id` entre as empresas casadas. Custo: páginas
de empresas + páginas de pessoas — na conta de hoje, ~9 requisições.
(código em `src/automations/peopleQuery.js`, função `collectContacts`.)

**Para quem enviar (só nos "Rascunhos de e-mail"):** no modo "Empresa / região"
há o campo **"Para quem enviar"**, com três opções:

- **Contato da empresa (e a empresa, se não tiver contato)** — padrão. Manda
  para a pessoa de contato; usa o e-mail da empresa só quando a empresa não tem
  nenhum contato com e-mail. É o que resolve o caso das ~149 escolas de "Setor:
  Educação" (cadastradas sem pessoa, só com o e-mail da empresa).
- **E-mail da empresa (sempre)** — ignora os contatos, manda sempre para o
  e-mail da empresa.
- **Contato e e-mail da empresa** — os dois: um rascunho para a pessoa e outro
  para o e-mail da empresa.

Rascunhos para a empresa aparecem com o subtítulo "E-mail da empresa" e
`{primeiroNome}` vira "pessoal" ("Olá, pessoal!"). Empresas sem e-mail vão para
a lista "sem e-mail".

**Criar tarefa para (só em "Tarefas em massa"):** no modo "Empresa / região" há
o campo **"Criar tarefa para"**, com duas opções:

- **Pessoas das empresas filtradas** — padrão, comportamento antigo: uma tarefa
  por pessoa das empresas que casam com o filtro. Empresas sem contato ficam de
  fora.
- **Empresas que ainda não têm nenhuma pessoa cadastrada** — cria a tarefa
  direto na empresa (`POST /organizations/{id}/tasks`), justamente nas que a
  opção anterior deixa de fora. Serve para disparar em massa um "ir atrás do
  responsável". Testado em 10/09/2026: `POST` e `DELETE` de
  `/organizations/{id}/tasks` funcionam igual aos de `/people/{id}/tasks`
  (mesmo payload, mesmo shift de +3h no `due_date`). No filtro "Categoria:
  Contato" da conta isso pega 158 empresas.

### ⚠️ Sobre os dados no Agendor

Testado na conta em 10/09/2026:

- **`Categoria` no modo empresa:** filtrar empresas por "Cliente efetivo" → 169
  empresas → 52 pessoas + empresas sem contato com e-mail. ✅
- **`Setor: Educação` + `Categoria: Contato`:** 149 empresas, **0 pessoas**
  vinculadas (as escolas cadastradas em 09/2026 não têm contato), mas **74 têm
  e-mail próprio** → 74 rascunhos, 75 na lista "sem e-mail". Antes do fallback
  de empresa isso dava 0.
- **`Estado`, `Cidade`, `Origem`:** idem — as empresas com esses campos
  preenchidos em geral não têm contato; agora o rascunho ainda sai, pelo e-mail
  da empresa, quando ela tem um.
- **`Produto` devolve 0** — nenhum produto está vinculado a empresa na conta
  (produtos vivem nos negócios).

Preencher Setor/Estado/Cidade e o e-mail nas empresas certas continua sendo o
que dá alcance máximo aos filtros regionais.

### Limite prático

O modo empresa faz o dobro de páginas (empresas + pessoas). Hoje é rápido; se a
base crescer muito, um filtro sem nenhum recorte pode se aproximar dos 60s da
Vercel Hobby. Recomendação: sempre marcar pelo menos um filtro.

---

## 4. Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/agendorClient.js` | bug `ownerUser`→`userOwner` corrigido; `listPeopleByFilters` ganhou `leadOrigin`/`state`/`cityName`; novos `listOrganizationsByFilters`, `listLeadOrigins`, `listSectors`, `listProducts`; removido `listPeopleByCategory` (sem uso); novo `createOrganizationTask` (tarefa direto na empresa) |
| `src/automations/peopleQuery.js` | **novo** — `collectContacts` (modos people/organizations, com fallback de empresa sem contato), `collectOrgsWithoutPeople` (empresas sem nenhuma pessoa, via `org.people` do próprio `/organizations`), `ORG_FILTER_FIELDS` (Cidade virou `select` com `optionsSource: 'cities'`), lista de UFs, `orgFilterOptions` (+ fonte `cities`) |
| `src/automations/emailDrafts.js` | `source` ganhou `organizations`; filtros de empresa no schema; `getOptions` novo; `collectPeople` usa o módulo compartilhado; canvas atualizado |
| `src/automations/bulkTasksByFilter.js` | ganhou o seletor `source`; filtros de empresa; `getOptions` novo; `collectTargets` (pessoas ou empresas sem pessoa) usa o módulo compartilhado; seletor `orgTarget`; canvas atualizado |
| `public/app.js` | `isFieldVisible` aceita `showWhen.in: [...]`; input `text` aceita `placeholder` |

---

## 5. Referência rápida dos ids da conta (10/09/2026)

Categorias: `Cliente efetivo` 4077793 · `Cliente em potencial` 4077794 ·
`Concorrente` 4077795 · `Contato` 4210532 · (+2)
Origens: `Indicação` 2581641 · `Evento` 2581642 · `Site` 2581643
Setores (8): ex. `Educação` 6039755, `Comércio Atacadista` 5849181
Usuários: `Raquel Oliveira` 960119 · `Plínio Valiante` 960122

(ids servem só para teste manual; o código sempre lê as listas da API)
