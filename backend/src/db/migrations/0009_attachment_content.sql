-- Anexos passam a ser guardados no próprio banco: o disco do serviço web no
-- Render é apagado a cada deploy/reinício, então arquivos salvos em
-- data/uploads sumiam. stored_name continua para anexos antigos em disco.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS content BYTEA;
