-- Listas por projeto: quais responsáveis e áreas/processos aparecem nos
-- formulários de ação de cada projeto. Projeto sem nenhuma linha numa das
-- tabelas = mostra todos os itens ativos daquela lista.
CREATE TABLE IF NOT EXISTS project_people (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE IF NOT EXISTS project_areas (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id     INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, area_id)
);
