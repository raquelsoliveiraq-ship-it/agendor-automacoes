import {
  listPeopleByFilters,
  listOrganizationsByFilters,
  listOrganizations,
  listLeadOrigins,
  listSectors,
  listProducts,
} from '../agendorClient.js';

// Coleta de contatos compartilhada pelas automações. Dois modos, controlados
// por `config.source`:
//
//   'people'        — filtra /people direto (categoria, empresa, responsável).
//   'organizations' — filtra /organizations (categoria, origem, setor,
//                     responsável, estado, cidade, produto) e devolve os
//                     contatos dessas empresas.
//
// O modo 'organizations' NÃO busca as pessoas empresa por empresa (seriam
// centenas de requests). Ele lista as empresas que casam com o filtro, puxa
// todas as pessoas paginando uma vez e fica com as que têm `organization.id`
// entre as empresas casadas.
//
// Muitas empresas são cadastradas SEM um contato (pessoa) vinculado, só com o
// e-mail da própria empresa. O `orgRecipient` decide para quem o rascunho vai
// quando o modo é 'organizations':
//   'contact' — contato da pessoa; usa o e-mail da empresa só quando a empresa
//               não tem nenhum contato com e-mail (padrão).
//   'company' — sempre o e-mail da empresa; ignora os contatos.
//   'both'    — os contatos E o e-mail da empresa.

const PER_PAGE = 100;

// Devolve { people, orgs }:
//   people — pessoas que casam com o filtro (shape da API /people).
//   orgs   — empresas casadas para mandar no e-mail da empresa (shape da API
//            /organizations); depende do `orgRecipient`.
export async function collectContacts(config, { maxPages, orgRecipient = 'contact' }) {
  if (config.source !== 'organizations') {
    const people = await paginatePeople(
      {
        categoryId: config.categoryId,
        userOwnerId: config.ownerUserId,
        organizationId: config.organizationId,
        role: config.role,
      },
      maxPages
    );
    return { people, orgs: [] };
  }

  const orgs = await collectOrgs(config, maxPages);
  if (orgs.length === 0) return { people: [], orgs: [] };

  const orgEmail = (o) => o.contact?.email || o.email || null;

  let people = [];
  if (orgRecipient !== 'company') {
    const orgIds = new Set(orgs.map((o) => o.id));
    const allPeople = await paginatePeople({ role: config.role }, maxPages);
    people = allPeople.filter((p) => p.organization && orgIds.has(p.organization.id));
  }

  if (orgRecipient === 'company') {
    // Sempre a empresa. As que não têm e-mail entram como candidatas também,
    // para caírem na lista "sem e-mail" e a pessoa saber quais preencher.
    return { people: [], orgs };
  }

  if (orgRecipient === 'both') {
    // Contato + empresa. Aqui só as empresas que TÊM e-mail entram — as demais
    // já são alcançadas pelo contato (ou não têm como ser alcançadas).
    return { people, orgs: orgs.filter(orgEmail) };
  }

  // 'contact': a empresa só entra quando não tem nenhum contato COM e-mail
  // (sem contato, ou contato sem e-mail preenchido).
  const covered = new Set(
    people.filter((p) => p.contact?.email || p.email).map((p) => p.organization.id)
  );
  return { people, orgs: orgs.filter((o) => !covered.has(o.id)) };
}

// Empresas que casam com o filtro e NÃO têm nenhuma pessoa cadastrada. Usado
// pela automação "Tarefas em massa" para criar a tarefa direto na empresa
// (ex: "achar a pessoa responsável"). O próprio /organizations já traz a lista
// `people` de cada empresa, então basta ficar com as de lista vazia.
export async function collectOrgsWithoutPeople(config, { maxPages }) {
  const orgs = await collectOrgs(config, maxPages);
  return orgs.filter((o) => !Array.isArray(o.people) || o.people.length === 0);
}

// Empresas que casam com o filtro e têm e-mail cadastrado (o da própria
// empresa), independente de já terem pessoas vinculadas ou não. Usado pela
// automação "Tarefas em massa" para mandar a tarefa direto pra empresa mesmo
// quando ela já tem contatos — casos em que quem decide é a empresa, não a
// pessoa cadastrada nela.
export async function collectOrgsWithEmail(config, { maxPages }) {
  const orgs = await collectOrgs(config, maxPages);
  return orgs.filter((o) => Boolean(o.contact?.email || o.email));
}

async function paginatePeople(filters, maxPages) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await listPeopleByFilters({ ...filters, page, perPage: PER_PAGE });
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

async function collectOrgs(config, maxPages) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await listOrganizationsByFilters({
      categoryId: config.categoryId,
      leadOriginId: config.leadOriginId,
      sectorId: config.sectorId,
      userOwnerId: config.ownerUserId,
      stateUf: config.stateUf,
      cityName: config.cityName,
      productId: config.productId,
      page,
      perPage: PER_PAGE,
    });
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}

// Campos do formulário que valem para o modo "Empresa / região". Ficam aqui
// para as duas automações montarem o mesmo bloco de filtros sem repetir.
export const ORG_FILTER_FIELDS = [
  {
    name: 'leadOriginId',
    label: 'Origem',
    type: 'select',
    optionsSource: 'leadOrigins',
    allowEmpty: true,
    emptyLabel: 'Qualquer origem',
    showWhen: { field: 'source', equals: 'organizations' },
  },
  {
    name: 'sectorId',
    label: 'Setor',
    type: 'select',
    optionsSource: 'sectors',
    allowEmpty: true,
    emptyLabel: 'Qualquer setor',
    showWhen: { field: 'source', equals: 'organizations' },
  },
  {
    name: 'stateUf',
    label: 'Estado',
    type: 'select',
    options: brazilUfOptions(),
    allowEmpty: true,
    emptyLabel: 'Qualquer estado',
    showWhen: { field: 'source', equals: 'organizations' },
  },
  {
    // Lista montada a partir das cidades que aparecem no cadastro das empresas
    // (não há endpoint de cidades na API). Ver `orgFilterOptions('cities')`.
    name: 'cityName',
    label: 'Cidade',
    type: 'select',
    optionsSource: 'cities',
    allowEmpty: true,
    emptyLabel: 'Qualquer cidade',
    showWhen: { field: 'source', equals: 'organizations' },
  },
  {
    name: 'productId',
    label: 'Produto',
    type: 'select',
    optionsSource: 'products',
    allowEmpty: true,
    emptyLabel: 'Qualquer produto',
    showWhen: { field: 'source', equals: 'organizations' },
  },
];

function brazilUfOptions() {
  return [
    ['AC', 'Acre'],
    ['AL', 'Alagoas'],
    ['AP', 'Amapá'],
    ['AM', 'Amazonas'],
    ['BA', 'Bahia'],
    ['CE', 'Ceará'],
    ['DF', 'Distrito Federal'],
    ['ES', 'Espírito Santo'],
    ['GO', 'Goiás'],
    ['MA', 'Maranhão'],
    ['MT', 'Mato Grosso'],
    ['MS', 'Mato Grosso do Sul'],
    ['MG', 'Minas Gerais'],
    ['PA', 'Pará'],
    ['PB', 'Paraíba'],
    ['PR', 'Paraná'],
    ['PE', 'Pernambuco'],
    ['PI', 'Piauí'],
    ['RJ', 'Rio de Janeiro'],
    ['RN', 'Rio Grande do Norte'],
    ['RS', 'Rio Grande do Sul'],
    ['RO', 'Rondônia'],
    ['RR', 'Roraima'],
    ['SC', 'Santa Catarina'],
    ['SP', 'São Paulo'],
    ['SE', 'Sergipe'],
    ['TO', 'Tocantins'],
  ].map(([value, name]) => ({ value, label: `${name} (${value})` }));
}

// Casos de `getOptions` que os filtros de empresa precisam. Devolve `null` para
// fontes que não são desta lista, para o `getOptions` da automação seguir com o
// tratamento dele.
export async function orgFilterOptions(source) {
  if (source === 'leadOrigins') {
    return (await listLeadOrigins()).map((o) => ({ value: String(o.id), label: o.name }));
  }
  if (source === 'sectors') {
    return (await listSectors()).map((s) => ({ value: String(s.id), label: s.name }));
  }
  if (source === 'products') {
    return (await listProducts()).map((p) => ({ value: String(p.id), label: p.name }));
  }
  if (source === 'cities') {
    // Não há endpoint de cidades. Junta as cidades preenchidas no endereço das
    // empresas, sem repetir, em ordem alfabética. O valor é o próprio nome, que
    // é o que o filtro `cityName` da API espera.
    const orgs = await listOrganizations();
    const names = [...new Set(orgs.map((o) => o.address?.city).filter(Boolean))];
    names.sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return names.map((c) => ({ value: c, label: c }));
  }
  return null;
}
