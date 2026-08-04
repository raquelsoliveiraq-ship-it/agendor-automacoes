# Automações Agendor

Dashboard local para rodar automações sobre a API do Agendor (v3).

## O que você precisa ter instalado

- **Node.js** (versão 18 ou mais nova) — é a única ferramenta obrigatória.
  Baixe em [nodejs.org](https://nodejs.org) (instale a versão "LTS"). Isso já
  inclui o `npm`, usado para instalar as dependências do projeto.
- Um terminal (Prompt de Comando, PowerShell ou Terminal do Mac/Linux).
- Não precisa de banco de dados, Docker, nem nada além disso.

## Instalação

1. Descompacte o `.zip` do projeto em uma pasta (ex: `Documentos\agendor-automacao`).
2. Abra um terminal **dentro dessa pasta**:
   - Windows: abra a pasta no Explorador, clique na barra de endereço, digite
     `cmd` e aperte Enter.
   - Mac: clique com o botão direito na pasta > "Novo Terminal na Pasta"
     (ou abra o Terminal e use `cd` até a pasta).
3. Rode `npm install` (baixa as dependências; só precisa fazer isso uma vez).
4. Copie o arquivo `.env.example` e renomeie a cópia para `.env`. Abra esse
   `.env` num editor de texto e preencha `AGENDOR_TOKEN` com o token da API
   da sua própria conta Agendor (`Configurações > Integrações > API Token`
   dentro do Agendor).
5. Rode `npm run dashboard`.
6. Abra `http://localhost:4141` no navegador.

Para rodar de novo depois (num outro dia), repete só os passos 5 e 6 — o
`npm install` e a configuração do `.env` são únicos.

## O que tem aqui

- `src/agendorClient.js` — wrapper da API v3 do Agendor (pessoas, categorias,
  usuários, tarefas). Contém correções de quirks reais da API: o campo de
  responsável da tarefa precisa da chave `assigned_users` (snake_case) e o
  de vencimento precisa de `due_date` (snake_case) — as variantes camelCase
  são silenciosamente ignoradas pela API.
- `src/automations/` — cada arquivo é uma automação independente, exportando
  `meta` (nome, descrição, filtros configuráveis) e `run()`. Novas automações
  entram em `src/automations/index.js` e aparecem sozinhas no dashboard.
- `src/server.js` + `public/` — o dashboard (Express + HTML/CSS/JS puro, sem
  build step).
- `.state/` — histórico e progresso de cada automação (arquivo JSON por
  automação). Começa vazio em uma instalação nova.

## Rodar sem o dashboard

Cada automação também pode ser chamada por script, ex:
`node src/runAutomation.js` (roda a automação "Cliente Efetivo → e-mail").

## Automações atuais

1. **E-mail para novo Cliente Efetivo** — quando uma pessoa é adicionada com
   Categoria = "Cliente efetivo", agenda uma tarefa de e-mail para 1 dia
   depois. Rodagem manual, sem retroatividade na primeira execução.
2. **Tarefas em massa por filtro** — cria uma tarefa igual para todas as
   pessoas que casam com os filtros escolhidos (categoria, responsável,
   empresa), numa data específica escolhida na tela. Tem pré-visualização
   (conta quantas pessoas casam com o filtro antes de criar) e histórico das
   últimas execuções.
