-- ADR-0188 beslut 6: "Personer med behörighet" avslöjar inte om en e-postadress har ett konto.
--
-- En behörighet som en administratör ger sparas här för adressen, oavsett om adressen har ett konto. Den blir en vanlig
-- behörighet (event_administration_grant eller course_setting_grant) när ett konto med adressen och bekräftad e-post
-- loggar in, öppnar Mina tävlingar eller tävlingen. Bara tillägg (ny tabell); inget befintligt ändras.
CREATE TABLE IF NOT EXISTS race_person_invitation (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  race_id uuid NOT NULL REFERENCES race (id),
  event_id uuid NOT NULL REFERENCES event (id),
  email text NOT NULL,
  role text NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES user_account (id),
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_account_id uuid REFERENCES user_account (id),
  accepted_grant_id uuid,
  revoked_at timestamptz,
  CONSTRAINT race_person_invitation_request_uidx UNIQUE (request_id),
  CONSTRAINT race_person_invitation_email_check CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  CONSTRAINT race_person_invitation_role_check CHECK (role IN ('ADMIN', 'FUNCTIONARY', 'COURSE_EDIT', 'COURSE_SUGGEST', 'COURSE_COMMENT', 'COURSE_MAP')),
  CONSTRAINT race_person_invitation_state_check CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
    AND ((accepted_at IS NULL) = (accepted_account_id IS NULL)))
);
-- Ny och tom tabell: indexen byggs i samma transaktion utan långa lås.
CREATE INDEX IF NOT EXISTS race_person_invitation_open_email_idx ON race_person_invitation (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS race_person_invitation_race_idx ON race_person_invitation (race_id, created_at);
