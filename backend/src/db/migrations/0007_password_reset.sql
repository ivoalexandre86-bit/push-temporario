-- Self-service password: "Esqueci minha senha" e troca da própria senha.
--
-- password_reset_tokens já existe desde 0001 (só o hash SHA-256 do token,
-- expiração e uso único). Aqui:
--  - users.password_changed_at: marca a última troca/redefinição de senha.
--    O valor vai no token de sessão (JWT); quando muda, sessões abertas
--    antes da troca deixam de valer.
--  - índice por expiração, para limpar tokens vencidos.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens(expires_at);
