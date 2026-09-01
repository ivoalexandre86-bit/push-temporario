# Sistema de Gestão de Projetos e Plano de Ação

Aplicação web completa para gestão de projetos e planos de ação, construída a
partir da planilha `PROJETOS.xlsx` original. Todos os 401 registros de ação,
seus IDs, projetos, áreas/processos, status, responsáveis, datas, horas e
observações foram importados e preservados como dado inicial real — não há
dados fictícios de negócio.

- **Interface**: 100% em português (pt-BR), datas em `dd/MM/yyyy`, números no
  formato brasileiro, UTF-8 completo (acentos, cedilha, etc.).
- **Código, banco de dados e documentação técnica**: em inglês.

## Sumário

1. [Arquitetura e stack](#arquitetura-e-stack)
2. [Como rodar localmente](#como-rodar-localmente)
3. [Contas de demonstração](#contas-de-demonstração)
4. [Modelo de dados](#modelo-de-dados)
5. [Papéis e permissões](#papéis-e-permissões)
6. [Importação da planilha original](#importação-da-planilha-original)
7. [Regras de negócio implementadas](#regras-de-negócio-implementadas)
8. [Testes automatizados](#testes-automatizados)
9. [Deploy em produção](#deploy-em-produção)
10. [Segurança antes de publicar](#segurança-antes-de-publicar)
11. [Limitações conhecidas e próximos passos](#limitações-conhecidas-e-próximos-passos)

## Arquitetura e stack

```
projeto-app/
├── backend/     API REST (Node.js + Express + PostgreSQL/pg)
└── frontend/    SPA (React + Vite + Tailwind CSS + Recharts)
```

**Backend**
- Node.js + Express, API REST em `/api/*`.
- Banco relacional **PostgreSQL** (via `pg`, driver assíncrono), com um shim
  fino em `backend/src/db/connection.js` que mantém a mesma ergonomia de
  chamada (`db.get/all/run/exec`, placeholders posicionais `?`) usada em todo
  o código. Migrations SQL versionadas (`backend/src/db/migrations`), chaves
  estrangeiras, índices e constraints `UNIQUE`/`CHECK`.
- **Banco único e compartilhado**: o mesmo Postgres é usado tanto pelo site
  publicado (Render) quanto pelo atalho local `Iniciar Sistema.bat` — os dois
  sempre enxergam os mesmos dados, não existem duas cópias do banco.
- Autenticação por sessão via cookie `httpOnly` + JWT (expiração de 30 min,
  configurável), com fallback Bearer token para clientes de API.
- RBAC (controle de acesso por papel) com escopo adicional por projeto/área,
  aplicado tanto nas rotas quanto nas consultas SQL (nunca apenas na UI).
- Proteção CSRF leve (header customizado obrigatório em mutações autenticadas
  por cookie), rate limiting no login, hashing de senha com bcrypt, validação
  de entrada com Zod, upload de anexos com allowlist de tipo e limite de
  tamanho.
- Auditoria imutável: toda alteração relevante grava um evento em `audit_log`
  (sem rotas de update/delete para essa tabela).
- Exportação para XLSX/CSV com cabeçalhos em português e metadados dos
  filtros aplicados.

**Frontend**
- React 19 + Vite + React Router.
- Tailwind CSS v4 para o design system (chips de status acessíveis, tabelas
  densas no desktop, cards no mobile).
- Recharts para os gráficos do painel.
- Filtros refletidos na URL (`useSearchParams`) para permitir link direto para
  uma visão filtrada, com fallback em `sessionStorage` para lembrar os últimos
  filtros usados na sessão.

## Como rodar localmente

Pré-requisitos: Node.js 20+, npm, e acesso a um banco PostgreSQL (o mesmo
banco compartilhado do Render — recomendado — ou um Postgres local próprio
para desenvolvimento isolado).

### 1. Backend (API + banco de dados)

```bash
cd backend
cp .env.example .env
# Edite .env e cole a DATABASE_URL do Postgres (ver "Deploy em produção")
npm install
npm run setup      # roda migrations + seed de usuários/papéis + importação da planilha
npm run dev         # inicia a API em http://localhost:4000
```

`npm run setup` executa, em sequência:
- `npm run migrate` — aplica as migrations SQL (cria todas as tabelas/índices).
- `npm run seed` — cria os papéis, permissões e 5 usuários de demonstração.
- `npm run import:xlsx` — importa `backend/data/seed/PROJETOS.xlsx` (a
  planilha original) para o banco, preservando IDs e sinalizando exceções de
  qualidade de dados.

⚠️ Se `DATABASE_URL` já apontar para o banco compartilhado de produção (o
mesmo usado por `Iniciar Sistema.bat` e pelo site), **não rode `npm run
setup`/`import:xlsx` nesse banco** — ele já tem os dados reais. `npm run
setup` é para preparar um banco novo/vazio (ex.: um Postgres local só para
desenvolvimento). Para recomeçar um banco de testes do zero:
`CONFIRM_RESET=SIM node scripts/reset-db.js --force && npm run setup`.

### 2. Frontend (SPA)

Em outro terminal:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, com proxy de /api para o backend
```

Acesse `http://localhost:5173` e entre com uma das [contas de demonstração](#contas-de-demonstração).

### 3. Rodando como um único serviço (opcional)

Para simular o modo "produção em processo único" (o backend serve os arquivos
estáticos do frontend já compilado):

```bash
cd frontend && npm run build
cd ../backend && npm run dev
```

Acesse `http://localhost:4000` — API e SPA respondem na mesma origem, sem
necessidade de CORS.

## Contas de demonstração

Criadas pelo `npm run seed` (senha padrão: `Mudar@123`, configurável via
`SEED_DEMO_PASSWORD` no `.env`):

| Papel | E-mail |
|---|---|
| Administrador | admin@projetos.local |
| Gerente de Projeto | gerente@projetos.local |
| Colaborador | colaborador@projetos.local |
| Visualizador | visualizador@projetos.local |
| Auditor | auditor@projetos.local |

Por padrão, apenas o Administrador e o Auditor têm acesso irrestrito a todos
os projetos (é assim que os papéis "globais" foram definidos). Os demais
usuários de demonstração começam **sem nenhum projeto associado** — use a
tela **Usuários** (como Administrador) para atribuir projetos a
`gerente@projetos.local` e `colaborador@projetos.local` e explorar o controle
de acesso por escopo.

## Modelo de dados

Principais tabelas (ver `backend/src/db/migrations/0001_init.sql` para o
schema completo com todos os campos, tipos e constraints):

- `users`, `roles`, `permissions`, `role_permissions` — usuários e RBAC.
- `user_project_scope`, `user_area_scope` — escopo de acesso por projeto/área.
- `projects`, `areas` — catálogos de projeto e área/processo (marcados como
  `is_imported = 1` quando vieram da planilha original).
- `people` — catálogo de responsáveis ("QUEM"), populado a partir dos dados
  importados.
- `actions` — a entidade central ("Plano de Ação"). Contém `uuid` (chave
  interna) e `business_id` (o ID original da planilha, imutável e nunca
  reutilizado), além de todos os campos originais e os novos campos de
  controle (horas planejadas, prazo, motivo de cancelamento, flags de
  importação etc.).
- `time_entries` — lançamentos de horas planejadas/reais, com status de
  aprovação.
- `audit_log` — trilha de auditoria imutável (entidade, campo, valor
  anterior/novo, ator, IP, timestamp).
- `attachments`, `comments` — anexos e comentários por ação.
- `import_batches` — resumo de cada execução do importador (linhas
  processadas, inseridas, rejeitadas, com exceção).
- `saved_views` — visões salvas (filtros + colunas) por usuário.

## Papéis e permissões

| Papel | Acesso |
|---|---|
| **Administrador** | Acesso total: usuários, papéis, projetos, áreas, todas as ações, importação/exportação, painéis, auditoria e configuração. |
| **Gerente de Projeto** | Projetos atribuídos a ele; pode criar, editar, atribuir, lançar horas, ver painéis e exportar dados dos projetos permitidos. |
| **Colaborador** | Visualiza projetos permitidos; edita apenas ações atribuídas a ele (status, horas reais, comentários, anexos). Lançamentos de horas reais de colaboradores entram como "pendente" até aprovação. |
| **Visualizador** | Somente leitura em projetos permitidos, painéis, detalhes de ação e exportações. |
| **Auditor** | Somente leitura em todos os registros e no histórico completo de auditoria; não altera dados de negócio. |

O controle é aplicado tanto na interface quanto na API — tentar acessar uma
ação de outro projeto manipulando a URL/ID retorna `403 Forbidden` (validado
em teste automatizado, veja `tests/permissions.test.js`).

## Importação da planilha original

O utilitário `backend/scripts/import-xlsx.js`:

- Lê `backend/data/seed/PROJETOS.xlsx` (aba "Projetos") diretamente com
  `exceljs`, célula a célula.
- Preserva o `ID` original da planilha como `business_id` imutável.
- Normaliza nomes de projeto/área apenas removendo espaços duplicados/extras
  para casar com os catálogos oficiais informados — nunca renomeia, funde ou
  remove um valor histórico.
- Sinaliza (nunca corrige silenciosamente) exceções de qualidade de dados:
  - `LEGACY_HOURS_REVIEW` — havia valor em "Tempo (h)"; fica visível como
    "hora legada importada" e só entra no total de horas reais depois de um
    administrador confirmar (`legacy_hours_confirmed`).
  - `NEGATIVE_LEGACY_HOURS` — valor de "Tempo (h)" negativo na planilha
    original; preservado exatamente como estava, apenas sinalizado.
  - `MISSING_COMPLETION_DATE` — ação já **CONCLUÍDO** na planilha, mas sem
    "FIM" preenchido.
  - `FREE_TEXT_MONTH_FORMAT` / `FREE_TEXT_START_DATE_FORMAT` /
    `FREE_TEXT_COMPLETION_DATE_FORMAT` — células que vieram como texto livre
    (ex.: `jul-26`, `31-jul`) em vez de data — convertidas com um parser
    tolerante e sinalizadas para revisão.
- Rejeita (não insere) linhas sem projeto, área, status válido ou descrição —
  e registra o motivo de cada rejeição.
- Grava um resumo em `import_batches` (linhas processadas/inseridas/rejeitadas/
  com exceção) — o "relatório de auditoria de importação".
- É idempotente: rodar novamente não duplica nem renumera nada (IDs já
  existentes são ignorados).

Resultado da importação da planilha fornecida: **401/401 linhas válidas
importadas**, 0 rejeitadas, 44 com alguma exceção sinalizada para revisão
(detalhes acima).

## Regras de negócio implementadas

- IDs de ação são únicos, imutáveis e nunca reutilizados (inclusive para
  linhas rejeitadas na importação).
- Catálogos de projeto, área/processo, status e responsáveis importados da
  planilha são preservados; administradores podem gerenciar valores futuros.
- Mês de referência é normalizado para `YYYY-MM-01`, mantendo o valor bruto
  original (`ref_month_raw`) para auditoria, mesmo quando a origem usava
  formato de texto livre.
- Ação **CONCLUÍDO** exige data de conclusão em registros novos/editados;
  registros importados sem essa data ficam marcados como exceção, sem alterar
  o histórico.
- Ação **CANCELADO** exige motivo de cancelamento em registros novos/editados.
- Uma ação está **atrasada** quando seu status não é CONCLUÍDO/CANCELADO e o
  prazo (`due_date`, ou `completion_date` quando o prazo não foi definido) é
  anterior à data atual. Como a planilha original não tinha um campo de
  "prazo" separado para ações em aberto, a detecção de atraso passa a operar
  assim que um prazo é definido nas ações (na criação/edição).
- Horas reais são somadas a partir dos lançamentos de horas **aprovados** do
  tipo "real"; horas planejadas vêm dos lançamentos do tipo "planejado" ou,
  na ausência deles, do campo de horas planejadas da própria ação.
- Novos lançamentos de horas não podem ser negativos; valores legados
  negativos importados são preservados exatamente e sinalizados para revisão.
- Toda alteração de ação (data, status, responsável, horas, projeto, área,
  observações) gera um evento de auditoria com valor anterior e novo.
- Criação de ação exige: projeto, mês de referência, área/processo, descrição,
  status e um responsável — ou a marcação explícita de "sem responsável".
- Exclusão é lógica (`soft delete`) e restrita a administradores; o histórico
  de auditoria é preservado mesmo após a exclusão.

## Testes automatizados

```bash
cd backend
npm test
```

47 testes (Vitest + Supertest), cada arquivo roda em processo isolado
(`pool: 'forks'`) contra sua própria instância efêmera do
[`@electric-sql/pglite`](https://pglite.dev/) — um Postgres compilado para
WASM, sem precisar instalar/rodar um servidor Postgres real — exercitando o
mesmo dialeto SQL usado em produção:

- `permissions.test.js` — autenticação, escopo por projeto (inclusive teste
  de IDOR — acesso a outro projeto via ID direto), permissões por papel,
  proteção CSRF.
- `filtering.test.js` — combinação AND entre categorias e OR dentro da mesma
  categoria de filtro.
- `statusTransitions.test.js` — regras de conclusão/cancelamento, reabertura
  de ação concluída, campos obrigatórios na criação, geração de auditoria.
- `hours.test.js` — cálculo de horas planejadas/reais/variação, aprovação de
  lançamentos, rejeição de horas negativas, preservação de horas legadas
  negativas.
- `audit.test.js` — imutabilidade da trilha de auditoria, acesso somente
  leitura do Auditor, registro de valores antigo/novo/ator/timestamp.
- `import.test.js` — importação completa da planilha real (401 linhas),
  idempotência, sinalização de exceções, resumo de importação, preservação
  dos catálogos completos.
- `export.test.js` — exportação CSV/XLSX respeitando os filtros aplicados,
  cabeçalhos em português, metadados de filtro, evento de auditoria de
  exportação.

## Deploy em produção

O sistema roda como um único serviço web Node.js (a mesma API Express serve
tanto `/api/*` quanto o SPA React já compilado) e usa PostgreSQL como banco
de dados — o mesmo banco é compartilhado entre o site publicado e o atalho
local `Iniciar Sistema.bat`, para nunca haver duas cópias divergentes dos
dados.

### Publicando no Render (recomendado — `render.yaml` já configurado)

1. Suba este repositório para o GitHub (`git push`, veja abaixo).
2. No painel do Render: **New > Blueprint**, selecione o repositório. O
   Render lê `render.yaml` na raiz e cria automaticamente:
   - um banco **PostgreSQL gerenciado** (`projetos-db`);
   - um **Web Service** Node.js (`projetos-web`) que builda o frontend,
     instala o backend, roda as migrations a cada deploy (`npm run migrate`)
     e inicia o servidor — já recebendo `DATABASE_URL` automaticamente do
     banco criado.
3. ⚠️ **Leia o comentário no topo do `render.yaml`** sobre o plano do banco:
   o plano **Free** do Postgres no Render é **apagado automaticamente após
   30 dias** a menos que seja promovido para um plano pago — o `render.yaml`
   já vem configurado com o plano pago (`starter`) para evitar esse risco,
   já que evitar perda de dados foi justamente o motivo de migrar para
   Postgres. Ajuste o plano no arquivo (ou diretamente no painel do Render)
   conforme seu orçamento.
4. Depois que o banco for criado, copie a **External Database URL**
   (Dashboard do Render > o recurso Postgres > **Connect**) — você vai
   precisar dela no passo de migração dos dados abaixo e no `.env` usado
   por `Iniciar Sistema.bat`.

### Trazendo os dados que já existem localmente (401+ ações reais)

Depois que o banco Postgres novo estiver com o schema criado (a primeira
subida do Web Service já roda `npm run migrate`), rode **uma única vez** o
script de migração de dados, apontando para o Postgres do Render:

```bash
cd backend
npm install --no-save better-sqlite3   # só para este script, lê o SQLite antigo
DATABASE_URL="<External Database URL do Render>" PGSSLMODE=require \
  npm run migrate:data -- "C:\Users\ivoal\AppData\Local\SistemaGestaoProjetos\backend\data\projetos.db"
```

O script (`backend/scripts/migrate-sqlite-to-postgres.js`) copia todas as
tabelas preservando IDs/UUIDs exatamente como estão, é seguro rodar mais de
uma vez (`ON CONFLICT ... DO NOTHING` — nada é sobrescrito) e roda tudo
dentro de uma única transação. **Não rode `npm run seed` depois dele** — os
usuários reais (com as senhas reais) já vêm junto na migração; rodar o seed
depois é inofensivo (ele também usa `ON CONFLICT DO NOTHING`), só
desnecessário.

### Conectando o notebook (`Iniciar Sistema.bat`) ao mesmo banco

Na primeira execução após esta atualização, o atalho copia
`backend/.env.example` para `.env` e para, pedindo para você colar a
**mesma** `DATABASE_URL` do Render nesse arquivo. A partir daí, o notebook e
o site sempre leem/gravam no mesmo banco — uma ação criada em um aparece
imediatamente no outro.

### Rodando em outro provedor (Railway, Fly.io, VM própria, etc.)

Os mesmos passos gerais se aplicam sem depender do Render:

1. `cd frontend && npm run build` — gera `frontend/dist`.
2. `cd backend && npm install --omit=dev && npm run migrate` — instala
   dependências de produção e aplica as migrations no Postgres apontado por
   `DATABASE_URL`.
3. Defina as variáveis de ambiente de produção (ver `backend/.env.example`):
   `DATABASE_URL` (obrigatório), `JWT_SECRET` (obrigatório, gerar um valor
   aleatório longo), `NODE_ENV=production`, `PGSSLMODE=require` (a maioria
   dos provedores gerenciados exige SSL).
4. `npm start` — a API sobe e, como `frontend/dist` existe, também serve o
   SPA na mesma origem (ver `SERVE_FRONTEND` em `backend/src/app.js`).
5. Coloque atrás de HTTPS — os cookies de sessão são marcados `Secure`
   automaticamente quando `NODE_ENV=production`.

### Limitação conhecida: anexos de arquivo

Uploads de anexo (`backend/src/routes/actions.js`, rota
`/attachments`) ainda gravam no **disco local** do servidor
(`backend/data/uploads`), não no Postgres. Isso é independente da migração
do banco: o disco de um Web Service do Render é **efêmero** — qualquer
arquivo enviado é perdido no próximo deploy/restart, a menos que um disco
persistente pago seja anexado ao serviço, ou os anexos sejam migrados para
um armazenamento de objetos (S3, Cloudflare R2, etc.). Nenhum anexo existe
nos dados reais até o momento desta migração, então isso não afeta os dados
já migrados — mas vale resolver antes de o time começar a anexar arquivos
pelo site.

## Segurança antes de publicar

Checklist a percorrer antes de divulgar a URL do site para o time (algumas
dessas etapas já vêm resolvidas pelo `render.yaml`, marcadas abaixo):

- [x] **`JWT_SECRET`**: o `render.yaml` gera um valor aleatório automaticamente
      (`generateValue: true`) — não reaproveita o valor de desenvolvimento.
      Se você definir manualmente em outro provedor, gere algo longo e
      aleatório (`openssl rand -base64 48`, por exemplo) e nunca reuse o de
      `.env.example`.
- [ ] **Senhas dos 5 usuários de demonstração** (`admin@projetos.local` e os
      demais — ver [Contas de demonstração](#contas-de-demonstração)): a
      senha padrão `Mudar@123` é pública (está neste README). O
      `render.yaml` gera uma `SEED_DEMO_PASSWORD` aleatória para o **seed**
      do banco do Render, mas como os dados reais foram trazidos pelo script
      de migração (não pelo seed), **os usuários reais migrados mantêm as
      senhas que já tinham no sistema local** — o que é o comportamento
      correto/esperado. Ainda assim, é uma boa prática pedir para cada
      pessoa trocar a própria senha (tela de perfil) no primeiro acesso pelo
      site.
- [ ] **Anexos de arquivo**: ver a limitação conhecida na seção anterior
      (disco efêmero no Render) — resolver antes do time depender dessa
      funcionalidade em produção.
- [ ] **HTTPS**: garantido automaticamente pelo Render (todo Web Service
      recebe um domínio `*.onrender.com` com HTTPS); se publicar em outro
      provedor sem HTTPS gerenciado, configure um proxy reverso com
      certificado antes de divulgar a URL.
- [ ] **Envio de e-mail para redefinição de senha**: continua não configurado
      (ver [Limitações conhecidas](#limitações-conhecidas-e-próximos-passos)
      abaixo) — o token de redefinição volta na própria resposta da API, o
      que é aceitável apenas enquanto o acesso ao sistema for restrito a
      pessoas de confiança.
- [ ] **Backups do Postgres**: o plano pago do Render inclui backups
      automáticos diários; confirme a política de retenção no painel do
      banco e considere exportar um dump manual (`pg_dump`) antes de
      qualquer operação arriscada (ex.: antes de rodar `reset-db.js`).

## Limitações conhecidas e próximos passos

Este é um sistema completo e funcional, mas algumas simplificações foram
feitas conscientemente para caber no escopo desta entrega — o modelo de dados
foi desenhado para suportar todas elas sem quebrar mudanças:

- **Envio de e-mail** (redefinição de senha, notificações) não está
  configurado — em ambiente de desenvolvimento, o token de redefinição é
  devolvido diretamente na resposta da API/tela para permitir testar o fluxo
  ponta a ponta; em produção, basta plugar um provedor (SES, SendGrid, etc.)
  no lugar do `TODO` em `backend/src/routes/auth.js`.
- **SSO**: a tabela `users` já tem a coluna `sso_subject` e a arquitetura de
  autenticação foi isolada em middleware próprio, pronta para adicionar um
  provedor OIDC/SAML sem alterar o restante do sistema.
- **Campos customizados, notificações e integrações**: não implementados
  nesta entrega, mas o modelo (entidades normalizadas + auditoria genérica)
  foi desenhado para acomodá-los depois sem migração destrutiva.
- **Seleção de colunas na tabela de ações**: implementada de forma simples
  (lista fixa de colunas exibida); a extensão para permitir esconder/reordenar
  colunas livremente é direta a partir do que já existe.
- **Formato de `<input type="date">`**: o navegador controla a exibição do
  seletor de data nativo conforme o idioma do sistema operacional/navegador
  do usuário; o valor armazenado e todas as exibições somente-leitura seguem
  `dd/MM/yyyy` conforme exigido.
- **Dependência `xlsx`**: não é usada — trocada por `exceljs` (mantido
  ativamente) especificamente para evitar as vulnerabilidades conhecidas do
  pacote `xlsx`/SheetJS.
