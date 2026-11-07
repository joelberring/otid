-- ADR-0219 (steg K1, tillägget om arbetssätt, förslag och delområden): arbetssättet Gemensamt/Huvudkartritare, delområden som
-- delas ut till personer och förslag (grupper av ändringar med en kort anteckning som en ägare godkänner). AI (K2) lämnar bara
-- förslag.
--
-- Bara tillägg (migrations/README.md): en ny nullbar kolumn på map_project, två nya nullbara kolumner på map_project_edit och
-- tre nya tabeller. Arbetssätt, status och källa bestäms i koden (`mapProjectModeSchema` m.fl. i contracts); databasen kräver
-- bara formen, som rollerna i 0089.
--
-- Konton har ingen främmande nyckel här, så att områden och förslag överlever kontot: den som fått ett område
-- (`assignee_account_id`) nollställs i koden när kontot tas bort eller personen tas bort ur projektet (som avsändarna i 0088),
-- och ett förslag har kvar sin författare och den som avgjorde det.

-- Arbetssättet: null = Gemensamt (`SHARED`), annars t.ex. `LEAD` (Huvudkartritare).
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS mode text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_mode_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_mode_check CHECK (mode IS NULL OR mode ~ '^[A-Z][A-Z_]{1,30}$');
  END IF;
END $$;

-- Delområden: polygon i kartans mm med y uppåt (ringar av {x,y}, första ringen ytterkant). Status: underlag, grundritat, rekat,
-- klart (koden: BASE, DRAFTED, SURVEYED, DONE).
CREATE TABLE IF NOT EXISTS map_project_area (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  polygon jsonb NOT NULL,
  assignee_account_id uuid,
  status text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT map_project_area_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_area_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_area_request_key UNIQUE (request_id),
  CONSTRAINT map_project_area_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT map_project_area_polygon_check CHECK (jsonb_typeof(polygon) = 'array' AND pg_column_size(polygon) <= 2097152),
  CONSTRAINT map_project_area_status_check CHECK (status ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_area_sort_check CHECK (sort BETWEEN 0 AND 100000)
);
CREATE INDEX IF NOT EXISTS map_project_area_project_idx ON map_project_area (project_id, sort);
CREATE INDEX IF NOT EXISTS map_project_area_assignee_idx ON map_project_area (assignee_account_id) WHERE assignee_account_id IS NOT NULL;

-- Förslag: källa PERSON eller AI (K2), status OPEN, ACCEPTED, REJECTED eller WITHDRAWN.
CREATE TABLE IF NOT EXISTS map_project_proposal (
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  request_id uuid NOT NULL,
  author_account_id uuid NOT NULL,
  source text NOT NULL,
  note text,
  status text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text,
  CONSTRAINT map_project_proposal_pkey PRIMARY KEY (id),
  CONSTRAINT map_project_proposal_project_fkey FOREIGN KEY (project_id) REFERENCES map_project (id),
  CONSTRAINT map_project_proposal_request_key UNIQUE (request_id),
  CONSTRAINT map_project_proposal_source_check CHECK (source ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_proposal_status_check CHECK (status ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_proposal_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT map_project_proposal_decision_note_check CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  CONSTRAINT map_project_proposal_decided_check CHECK ((decided_at IS NULL) = (decided_by IS NULL))
);
CREATE INDEX IF NOT EXISTS map_project_proposal_project_idx ON map_project_proposal (project_id, status, created_at);
CREATE INDEX IF NOT EXISTS map_project_proposal_author_idx ON map_project_proposal (project_id, author_account_id) WHERE status = 'OPEN';

-- Förslagets ändringar, i ordning, som de lagras i map_project_edit, med valfri punkt (`point` på ändringen) och utfallet när
-- förslaget godkänts (APPLIED eller CONFLICT; null innan).
CREATE TABLE IF NOT EXISTS map_project_proposal_edit (
  proposal_id uuid NOT NULL,
  position integer NOT NULL,
  edit_id uuid NOT NULL,
  object_key text NOT NULL,
  ref jsonb,
  base_edit_id uuid,
  kind text NOT NULL,
  state jsonb NOT NULL,
  point jsonb,
  edited_at timestamp with time zone NOT NULL,
  outcome text,
  CONSTRAINT map_project_proposal_edit_pkey PRIMARY KEY (proposal_id, position),
  CONSTRAINT map_project_proposal_edit_proposal_fkey FOREIGN KEY (proposal_id) REFERENCES map_project_proposal (id),
  CONSTRAINT map_project_proposal_edit_key UNIQUE (proposal_id, edit_id),
  CONSTRAINT map_project_proposal_edit_position_check CHECK (position BETWEEN 0 AND 10000),
  CONSTRAINT map_project_proposal_edit_object_key_check CHECK (char_length(object_key) BETWEEN 3 AND 200
    AND (object_key LIKE 'b:%' OR object_key LIKE 'n:%')),
  CONSTRAINT map_project_proposal_edit_kind_check CHECK (kind ~ '^[A-Z][A-Z_]{1,30}$'),
  CONSTRAINT map_project_proposal_edit_state_check CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) <= 1048576),
  CONSTRAINT map_project_proposal_edit_point_check CHECK (point IS NULL OR jsonb_typeof(point) = 'object'),
  CONSTRAINT map_project_proposal_edit_outcome_check CHECK (outcome IS NULL OR outcome IN ('APPLIED', 'CONFLICT'))
);
CREATE INDEX IF NOT EXISTS map_project_proposal_edit_edit_idx ON map_project_proposal_edit (edit_id);

-- Loggen visar vem som föreslog (author_account_id som förut) och vem som godkände: en ändring som kom genom ett godkänt förslag
-- har förslaget och den som godkände (ingen nyckel till kontot).
ALTER TABLE map_project_edit ADD COLUMN IF NOT EXISTS proposal_id uuid;
ALTER TABLE map_project_edit ADD COLUMN IF NOT EXISTS accepted_by uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_edit_proposal_fkey') THEN
    ALTER TABLE map_project_edit ADD CONSTRAINT map_project_edit_proposal_fkey FOREIGN KEY (proposal_id) REFERENCES map_project_proposal (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_edit_accepted_check') THEN
    ALTER TABLE map_project_edit ADD CONSTRAINT map_project_edit_accepted_check CHECK ((proposal_id IS NULL) = (accepted_by IS NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS map_project_edit_proposal_idx ON map_project_edit (proposal_id) WHERE proposal_id IS NOT NULL;
