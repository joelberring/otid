-- Ägaren 2026-11-13: «man borde kunna bjuda in klubbmedlemmar i kartprojekt utan mejl». Länkar för att gå med i ett kartprojekt
-- (utan e-postadress): en länk med en vald roll som den som har länken öppnar inloggad för att bli medlem. Bara hashen av
-- nyckeln sparas (som `invitation_link`). Länken gäller en begränsad tid, kan användas av flera och kan tas bort (`revoked_at`).
-- Klubbmedlemmar som läggs till direkt kräver ingen ny tabell (de blir rader i `map_project_member`).
--
-- Bara tillägg (migrations/README.md): en ny tabell.
CREATE TABLE IF NOT EXISTS map_project_join_link (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES map_project (id),
  token_hash text NOT NULL,
  role text NOT NULL,
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS map_project_join_link_token_hash_key ON map_project_join_link (token_hash);
CREATE INDEX IF NOT EXISTS map_project_join_link_project_idx ON map_project_join_link (project_id, created_at);
