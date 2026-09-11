# Automações Agendor

Dashboard local para rodar automações sobre a API do Agendor (v3).

> **Uso compartilhado (Vercel):** o plano para publicar este dashboard num
> endereço fixo, para Raquel e Plínio usarem as automações "Rascunhos de e-mail"
> e "Tarefas em massa por filtro", está em
> [`docs/deploy-vercel.md`](docs/deploy-vercel.md) — com os ajustes de código,
> o passo a passo do deploy e o plano de testes.
>
> **Filtros do Agendor:** [`docs/filtros-agendor.md`](docs/filtros-agendor.md) —
> o modo "Empresa / região" das duas automações, os nomes de parâmetro que a API
> aceita (a doc oficial não documenta nenhum) e o que cada filtro depende dos
> dados no Agendor.

## O que você precisa ter instalado

- **Node.js** (versão 18 ou mais nova) — é a única ferramenta obrigatória.
  Baixe em [nodejs.org](https://nodejs.org) (instale a versão "LTS"). Isso já
  inclui o `npm`, usado para instalar as dependências do projeto.
- Um terminal (Prompt de Comando, PowerShell ou Terminal do Mac/Linux).
- Não precisa de banco de dados, Docker, nem nada além disso.

## Instalação

1. Baixe o projeto: no botão verde "Code" no topo desta página, clique em
   "Download ZIP" e descompacte numa pasta (ex: `Documentos\agendor-automacao`).
   Se preferir e já usar Git, também pode rodar
   `git clone https://github.com/raquelsoliveiraq-ship-it/agendor-automacoes.git`.
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

O dashboard sempre roda na porta 4141 (`localhost:4141`), a mesma sempre. Se
aparecer erro dizendo que a porta está em uso, é porque tem outro
`npm run dashboard` aberto — feche aquele terminal e rode de novo.

### Editando o código

O `npm run dashboard` usa `node --watch`: ao salvar um arquivo em `src/`, o
servidor se reinicia sozinho em ~1 segundo, na mesma porta. Basta atualizar a
página no navegador (F5). Não precisa fechar e abrir o terminal a cada
mudança. Arquivos de tela (`public/`) nem exigem o reinício — só o F5.

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
  automação), mais `settings.json` com o liga/desliga e `templates.json` com
  os modelos de e-mail salvos. Começa
  vazio em uma instalação nova.

## Liga/desliga

Cada automação tem um botão no topo da tela. Desligada, ela fica apagada e o
botão "Rodar agora" para de funcionar — e o servidor também recusa o pedido,
não é só a tela que bloqueia. O estado fica em `.state/settings.json`.

Enquanto o dashboard roda em `localhost`, esse estado é da máquina de quem
rodou: o liga/desliga de uma pessoa não aparece para a outra. Compartilhar de
verdade exige subir o dashboard para um servidor com endereço fixo.

## Automações atuais

1. **Rascunhos de e-mail** — monta um e-mail pronto para cada contato. O
   seletor "Filtrar por" tem três modos: **Categoria de cliente** (filtra as
   pessoas por categoria, empresa e responsável), **Empresa / região** (filtra
   as empresas por categoria, origem, setor, responsável, estado, cidade e
   produto, e pega as pessoas delas) e **Etapa do funil de vendas** (filtra os
   negócios por etapa e situação). **Não envia e não cria nada no Agendor**:
   devolve os textos na tela, cada um com botão de copiar e um link que abre a
   janela de escrita do Gmail já preenchida. Assunto e corpo aceitam os
   placeholders
   `{nome}`, `{primeiroNome}`, `{empresa}`, `{responsavel}`, `{categoria}`,
   `{titulo}`, `{valor}` e `{etapa}`; o que não existir naquele contato sai
   como travessão, de propósito, para o buraco no cadastro ficar visível.
   Contatos sem e-mail cadastrado aparecem numa lista à parte, com link para
   o Agendor, em vez de sumirem em silêncio. Os rascunhos ficam **só na sessão
   do navegador**: ao recarregar a página eles somem e é preciso rodar de novo
   — assim ninguém abre o dashboard e confunde rascunhos de dias atrás com os
   de agora. Só o histórico de execuções (os números de cada rodada, sem os
   textos) é salvo, em `.state/email-drafts.json`.

   Assunto e corpo podem ser salvos como **modelos** com nome. O botão
   "Modelo de e-mail", no estilo do Agendor, abre um menu com os modelos
   salvos (clicar aplica), "Salvar alterações" no modelo aberto e "+ Adicionar
   novo modelo", que pede um nome e guarda o assunto e o corpo atuais. Salvar
   com um nome que já existe atualiza aquele modelo em vez de criar um segundo
   igual, e aplicar um modelo por cima de texto não salvo pede confirmação. Os
   modelos ficam em
   `.state/templates.json`, ou seja, no projeto e não no navegador, porque são
   texto da empresa e valem para as duas pessoas. Os filtros ficam de fora do
   modelo de propósito: o mesmo texto serve para categorias e empresas
   diferentes.

   Antes de abrir o Gmail, o botão pergunta em qual conta abrir. O endereço
   escolhido fica salvo no `localStorage` do navegador (não no `.state/`),
   porque é escolha de cada pessoa, e entra na URL como `authuser`.

   Entre os filtros e o modelo de e-mail há uma **estimativa em destaque que se
   recalcula sozinha** (com um pequeno atraso) enquanto você mexe nos campos:
   um círculo gira enquanto a filtragem não terminou e depois aparece "X
   contato(s) no filtro, Y com e-mail, Z sem". **Rodar agora** monta os
   rascunhos e repete esse resumo fixo no topo do bloco "Rascunhos prontos".
2. **Tarefas em massa por filtro** — cria uma tarefa igual para todas as
   pessoas que casam com os filtros escolhidos, numa data específica escolhida
   na tela. O seletor "Filtrar por" tem dois modos: **Categoria de cliente**
   (categoria, responsável, empresa da pessoa) e **Empresa / região** (filtra as
   empresas por categoria, origem, setor, responsável, estado, cidade e produto,
   e a tarefa vai para as pessoas delas). Tem pré-visualização (conta quantas
   pessoas casam com o filtro antes de criar) e histórico das últimas execuções.

Os nomes de parâmetro de filtro da API do Agendor (que a doc oficial não
documenta) e o que cada filtro depende dos dados no Agendor estão em
[`docs/filtros-agendor.md`](docs/filtros-agendor.md).
