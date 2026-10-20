-- ============================================================================
-- Migration 0010: Cadastros de Logística (Regionais, Filiais, Transportadores)
--
-- Estrutura definida a partir da planilha "Contatos Logística.xlsx":
--   aba "REGIONAIS"     -> regions + region_contacts (um contato por
--                          departamento: "Regionais", "Programador", ...)
--   aba "Regionais "    -> branches (filiais/unidades de cada regional)
--   aba "TRANSPORTADOR" -> carriers (transportadora que atende uma unidade)
--
-- Relacionamentos (cardinalidade observada nos dados):
--   regions 1 --- N branches        (toda filial pertence a uma regional)
--   regions 1 --- N carriers        (toda linha de transportador tem regional)
--   branches 1 --- N carriers       (opcional: na planilha, 12 das 22 linhas
--                                    de transportador citam unidades que não
--                                    estão na aba de filiais)
--
-- Exclusão é sempre lógica (deleted_at) e as chaves estrangeiras são
-- RESTRICT; a API recusa excluir uma regional/filial com vínculos ativos.
-- dedupe_key é a chave de duplicidade calculada pela aplicação (ver
-- backend/src/services/logistics/normalize.js) e é única entre os registros
-- não excluídos.
-- ============================================================================

CREATE TABLE IF NOT EXISTS regions (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  dedupe_key  TEXT NOT NULL,
  notes       TEXT,
  source      TEXT NOT NULL DEFAULT 'MANUAL',   -- MANUAL | IMPORT
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_regions_dedupe ON regions(dedupe_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS region_contacts (
  id             SERIAL PRIMARY KEY,
  region_id      INTEGER NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  department     TEXT NOT NULL,
  dedupe_key     TEXT NOT NULL,                 -- região + departamento
  name           TEXT,
  email          TEXT,
  phone          TEXT,
  voice_channel  TEXT,
  mobile         TEXT,
  source         TEXT NOT NULL DEFAULT 'MANUAL',
  created_by     INTEGER REFERENCES users(id),
  updated_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_region_contacts_region ON region_contacts(region_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_region_contacts_dedupe ON region_contacts(dedupe_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS branches (
  id                          SERIAL PRIMARY KEY,
  region_id                   INTEGER NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  dedupe_key                  TEXT NOT NULL,     -- CNPJ + código da filial (ou nome, sem CNPJ)
  complex                     TEXT,
  state                       TEXT,
  company                     TEXT,
  branch_code                 TEXT,
  branch_name                 TEXT NOT NULL,
  cnpj                        TEXT,
  cnpj_digits                 TEXT,
  address                     TEXT,
  zip_code                    TEXT,
  unit_manager_name           TEXT,
  unit_manager_email          TEXT,
  unit_manager_phone          TEXT,
  unit_manager_voice          TEXT,
  unit_manager_mobile         TEXT,
  logistics_coord_name        TEXT,
  logistics_coord_email       TEXT,
  logistics_coord_phone       TEXT,
  logistics_coord_voice       TEXT,
  logistics_coord_mobile      TEXT,
  assistant_coord_name        TEXT,
  assistant_coord_email       TEXT,
  assistant_coord_phone       TEXT,
  assistant_coord_voice       TEXT,
  assistant_coord_mobile      TEXT,
  notes                       TEXT,
  source                      TEXT NOT NULL DEFAULT 'MANUAL',
  created_by                  INTEGER REFERENCES users(id),
  updated_by                  INTEGER REFERENCES users(id),
  created_at                  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at                  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted_at                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_branches_region ON branches(region_id);
CREATE INDEX IF NOT EXISTS idx_branches_cnpj ON branches(cnpj_digits);
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_dedupe ON branches(dedupe_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS carriers (
  id                          SERIAL PRIMARY KEY,
  region_id                   INTEGER NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  branch_id                   INTEGER REFERENCES branches(id) ON DELETE RESTRICT,
  dedupe_key                  TEXT NOT NULL,     -- unidade + transportadora
  carrier_name                TEXT NOT NULL,
  carrier_key                 TEXT NOT NULL,     -- nome normalizado, para filtros/agrupamento
  -- Unidade atendida, como informada na linha (mantida mesmo sem filial vinculada)
  complex                     TEXT,
  state                       TEXT,
  company                     TEXT,
  branch_code                 TEXT,
  branch_name                 TEXT,
  cnpj                        TEXT,
  cnpj_digits                 TEXT,
  address                     TEXT,
  zip_code                    TEXT,
  -- Contatos da transportadora
  manager_name                TEXT,
  manager_email               TEXT,
  manager_mobile              TEXT,
  scheduler_name              TEXT,
  scheduler_email             TEXT,
  scheduler_mobile            TEXT,
  -- Contato da unidade
  unit_contact_name           TEXT,
  unit_contact_email          TEXT,
  unit_contact_phone          TEXT,
  unit_contact_voice          TEXT,
  unit_contact_mobile         TEXT,
  notes                       TEXT,
  source                      TEXT NOT NULL DEFAULT 'MANUAL',
  created_by                  INTEGER REFERENCES users(id),
  updated_by                  INTEGER REFERENCES users(id),
  created_at                  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at                  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted_at                  TEXT
);
CREATE INDEX IF NOT EXISTS idx_carriers_region ON carriers(region_id);
CREATE INDEX IF NOT EXISTS idx_carriers_branch ON carriers(branch_id);
CREATE INDEX IF NOT EXISTS idx_carriers_key ON carriers(carrier_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_carriers_dedupe ON carriers(dedupe_key) WHERE deleted_at IS NULL;

-- Histórico das importações de Excel destes cadastros (separado de
-- import_batches, que é o histórico do importador original de ações).
CREATE TABLE IF NOT EXISTS logistics_import_batches (
  id             SERIAL PRIMARY KEY,
  target         TEXT NOT NULL,                 -- REGIONS | BRANCHES | CARRIERS
  source_file    TEXT NOT NULL,
  sheet_name     TEXT NOT NULL,
  mode           TEXT NOT NULL,                 -- INSERT_ONLY | UPSERT
  imported_by    INTEGER REFERENCES users(id),
  imported_by_name TEXT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  total_rows     INTEGER NOT NULL DEFAULT 0,
  inserted_rows  INTEGER NOT NULL DEFAULT 0,
  updated_rows   INTEGER NOT NULL DEFAULT 0,
  unchanged_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows   INTEGER NOT NULL DEFAULT 0,
  rejected_rows  INTEGER NOT NULL DEFAULT 0,
  mapping_json   TEXT,
  options_json   TEXT,
  summary_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_logistics_import_started ON logistics_import_batches(started_at);

-- Permissões dos novos módulos. Num banco novo os papéis ainda não existem
-- quando esta migration roda (o seed cria tudo depois, a partir de
-- src/permissions.js); num banco que já está em uso (produção), estas linhas
-- concedem as permissões aos papéis existentes.
INSERT INTO permissions (key, description) VALUES
  ('logistics.view', 'Consultar Regionais, Filiais e Transportadores'),
  ('logistics.manage', 'Cadastrar, editar e excluir Regionais, Filiais e Transportadores'),
  ('logistics.import', 'Importar Regionais, Filiais e Transportadores de planilha Excel')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (
     (p.key = 'logistics.view'   AND r.key IN ('ADMIN', 'PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER', 'AUDITOR'))
  OR (p.key = 'logistics.manage' AND r.key IN ('ADMIN', 'PROJECT_MANAGER'))
  OR (p.key = 'logistics.import' AND r.key IN ('ADMIN', 'PROJECT_MANAGER'))
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
