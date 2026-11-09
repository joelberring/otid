-- ADR-0221: terminsplaneringen i klubbytan. Klubbens terminer, de planerade träningarna (datum, tid, rubrik, plats, karta,
-- grupp, ansvarig och den träning som skapades ur planen) och uppgifterna till klubbens medlemmar eller en e-postadress.
--
-- Konton och tävlingar refereras utan främmande nyckel (raderna står kvar när ett konto eller en tävling tas bort; vyn visar
-- då inget namn eller ingen länk). `assignee_email` är adressen i gemener som ledaren skrev; den visas bara för ledarna.
-- Bara tillägg (migrations/README.md).
CREATE TABLE IF NOT EXISTS club_term (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT club_term_pkey PRIMARY KEY (id),
  CONSTRAINT club_term_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_term_request_key UNIQUE (request_id),
  CONSTRAINT club_term_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT club_term_dates_check CHECK (ends_on >= starts_on AND ends_on - starts_on <= 400)
);
CREATE INDEX IF NOT EXISTS club_term_club_idx ON club_term (club_id, starts_on);

CREATE TABLE IF NOT EXISTS club_plan_session (
  id uuid NOT NULL,
  club_id uuid NOT NULL,
  term_id uuid NOT NULL,
  session_date date NOT NULL,
  start_time text,
  title text NOT NULL,
  place text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  club_map_id uuid,
  training_group_id uuid,
  responsible_account_id uuid,
  race_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT club_plan_session_pkey PRIMARY KEY (id),
  CONSTRAINT club_plan_session_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_plan_session_term_fkey FOREIGN KEY (term_id) REFERENCES club_term (id),
  CONSTRAINT club_plan_session_request_key UNIQUE (request_id),
  CONSTRAINT club_plan_session_time_check CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT club_plan_session_text_check CHECK (char_length(title) BETWEEN 1 AND 160 AND char_length(place) <= 160
    AND char_length(note) <= 2000)
);
CREATE INDEX IF NOT EXISTS club_plan_session_term_idx ON club_plan_session (term_id, session_date);
CREATE INDEX IF NOT EXISTS club_plan_session_race_idx ON club_plan_session (race_id) WHERE race_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS club_plan_task (
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  title text NOT NULL,
  assignee_account_id uuid,
  assignee_email text,
  done_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL,
  created_by uuid NOT NULL,
  request_id uuid NOT NULL,
  CONSTRAINT club_plan_task_pkey PRIMARY KEY (id),
  CONSTRAINT club_plan_task_session_fkey FOREIGN KEY (session_id) REFERENCES club_plan_session (id),
  CONSTRAINT club_plan_task_request_key UNIQUE (request_id),
  CONSTRAINT club_plan_task_title_check CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT club_plan_task_email_check CHECK (assignee_email IS NULL OR (char_length(assignee_email) <= 254
    AND assignee_email = lower(assignee_email)))
);
CREATE INDEX IF NOT EXISTS club_plan_task_session_idx ON club_plan_task (session_id);
CREATE INDEX IF NOT EXISTS club_plan_task_account_idx ON club_plan_task (assignee_account_id) WHERE assignee_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS club_plan_task_email_idx ON club_plan_task (assignee_email) WHERE assignee_email IS NOT NULL;
