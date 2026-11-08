-- ADR-0219 (steg K3, tillägget om rekningen): notiser i kartprojektet, en punkt på kartan (kartans mm, y uppåt) med text och
-- valfritt foto, gärna från fältet ("stigen saknas här"). Valfritt knuten till ett objekt. Id:t skapas i telefonen (samma notis
-- två gånger blir en), så att den kan skrivas utan nät.
--
-- Bara tillägg (migrations/README.md): en ny tabell. Kontot har ingen främmande nyckel (som 0091); notisen står kvar när kontot
-- tas bort, som ändringarna. Fotot högst 2 MB (koden kontrollerar typen).
CREATE TABLE IF NOT EXISTS map_project_note (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  account_id uuid NOT NULL,
  at_x double precision NOT NULL,
  at_y double precision NOT NULL,
  object_key text,
  text text NOT NULL,
  photo bytea,
  photo_media_type text,
  status text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  CONSTRAINT map_project_note_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_note_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_note_text_check CHECK (char_length(text) <= 1000),
  CONSTRAINT map_project_note_status_check CHECK (status ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_note_key_check CHECK (object_key IS NULL OR char_length(object_key) BETWEEN 3 AND 300),
  CONSTRAINT map_project_note_photo_check CHECK (photo IS NULL OR (octet_length(photo) <= 2097152 AND photo_media_type IS NOT NULL)),
  CONSTRAINT map_project_note_at_check CHECK (abs(at_x) <= 5000000 AND abs(at_y) <= 5000000)
);
CREATE INDEX IF NOT EXISTS map_project_note_project_idx ON map_project_note (project_id, created_at);
