-- ADR-0214: länken till kartritaren. Banläggaren delar kartfelen med en länk som öppnas utan konto ("alla med länken").
-- Nyckeln är 32 slumpade byte (base64url) och bara dess sha256 sparas, som återställnings- och inbjudningslänkarna. En
-- aktiv länk per tävling: en ny länk stänger den förra. Ingen IP-adress eller webbläsare sparas, bara när länken senast
-- öppnades.
--
-- Kartritarens svar och "Åtgärdat i kartan"/"Inte åtgärdat" sparas som svar i kartfelets tråd utan konto (created_by tom),
-- med länkens id, namnet kartritaren skrev (valfritt) och beskedet. Svarets text får vara tom bara när det är ett besked.
--
-- Bara tillägg: en ny tabell, tre kolumner som får vara tomma, created_by som får vara tom (en lösare regel) och nya värden i
-- spärrens scope och journalens aktörer. Kolumnen map_link_id har ingen främmande nyckel, så att svaren följer med kopia och
-- säkerhetskopia (länkarna gör det inte).
ALTER TYPE audit_actor_kind ADD VALUE IF NOT EXISTS 'COURSE_SETTING_MAP_LINK';

CREATE TABLE IF NOT EXISTS course_setting_map_link (
  id uuid NOT NULL,
  race_id uuid NOT NULL REFERENCES race (id),
  token_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES user_account (id),
  created_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone,
  show_race_name boolean NOT NULL DEFAULT false,
  revoked_at timestamp with time zone,
  revoked_by uuid REFERENCES user_account (id),
  last_opened_at timestamp with time zone,
  CONSTRAINT course_setting_map_link_pkey PRIMARY KEY (id),
  CONSTRAINT course_setting_map_link_token_hash_key UNIQUE (token_hash),
  CONSTRAINT course_setting_map_link_token_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT course_setting_map_link_expiry_check CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT course_setting_map_link_revoked_check CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
-- Ny och tom tabell: indexen byggs i samma transaktion utan långa lås. Högst en länk som inte är avstängd per tävling.
CREATE UNIQUE INDEX IF NOT EXISTS course_setting_map_link_open_idx ON course_setting_map_link (race_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS course_setting_map_link_race_idx ON course_setting_map_link (race_id, created_at);

ALTER TABLE course_setting_note_reply ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE course_setting_note_reply ADD COLUMN IF NOT EXISTS map_link_id uuid;
ALTER TABLE course_setting_note_reply ADD COLUMN IF NOT EXISTS author_name text;
ALTER TABLE course_setting_note_reply ADD COLUMN IF NOT EXISTS verdict text;
DO $$ BEGIN
  ALTER TABLE course_setting_note_reply ADD CONSTRAINT course_setting_note_reply_author_check
    CHECK (num_nonnulls(created_by, map_link_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE course_setting_note_reply ADD CONSTRAINT course_setting_note_reply_map_link_check
    CHECK ((author_name IS NULL OR (map_link_id IS NOT NULL AND char_length(author_name) BETWEEN 1 AND 80))
      AND (verdict IS NULL OR (map_link_id IS NOT NULL AND verdict IN ('FIXED', 'NOT_FIXED'))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Texten: 1–2000 tecken, eller tom i ett besked från kartritaren.
ALTER TABLE course_setting_note_reply DROP CONSTRAINT IF EXISTS course_setting_note_reply_text_check;
ALTER TABLE course_setting_note_reply ADD CONSTRAINT course_setting_note_reply_text_check
  CHECK (char_length(text) <= 2000 AND (char_length(text) >= 1 OR verdict IS NOT NULL));

-- "Åtgärdat i kartan" gör kartfelet klart utan konto: klar av ett konto (resolved_by) eller av länken (resolved_map_link_id).
ALTER TABLE course_setting_note ADD COLUMN IF NOT EXISTS resolved_map_link_id uuid;
ALTER TABLE course_setting_note DROP CONSTRAINT IF EXISTS course_setting_note_status_check;
ALTER TABLE course_setting_note ADD CONSTRAINT course_setting_note_status_check CHECK (status IN ('OPEN', 'DONE')
  AND (status = 'OPEN') = (resolved_at IS NULL) AND (resolved_at IS NULL) = (num_nonnulls(resolved_by, resolved_map_link_id) = 0)
  AND num_nonnulls(resolved_by, resolved_map_link_id) <= 1);

-- Spärren räknar också anrop med kartritarens länk per IP-adress och per länk.
ALTER TABLE account_request_throttle DROP CONSTRAINT IF EXISTS account_request_throttle_scope_check;
ALTER TABLE account_request_throttle ADD CONSTRAINT account_request_throttle_scope_check CHECK (scope IN ('REGISTER_IP', 'RESET_IP',
  'RESET_EMAIL', 'SELF_REGISTRATION_IP', 'SELF_REGISTRATION_RACE', 'VERIFY_EMAIL', 'GROUP_CODE_IP', 'MAP_LINK_IP', 'MAP_LINK_TOKEN'));

-- Ägarens önskemål samma dag (ADR-0214 beslut 9): den som skrev en notis eller ett svar kan redigera texten. Notisen och
-- svaret får när de senast ändrades ("(ändrad)"), och den tidigare texten sparas i historiken (visas inte publikt).
ALTER TABLE course_setting_note ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone;
ALTER TABLE course_setting_note_reply ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone;
CREATE TABLE IF NOT EXISTS course_setting_note_edit (
  id uuid NOT NULL,
  race_id uuid NOT NULL REFERENCES race (id),
  note_id uuid NOT NULL REFERENCES course_setting_note (id),
  reply_id uuid REFERENCES course_setting_note_reply (id),
  previous_text text NOT NULL,
  edited_at timestamp with time zone NOT NULL,
  edited_by uuid NOT NULL,
  CONSTRAINT course_setting_note_edit_pkey PRIMARY KEY (id),
  CONSTRAINT course_setting_note_edit_text_check CHECK (char_length(previous_text) <= 2000)
);
CREATE INDEX IF NOT EXISTS course_setting_note_edit_note_idx ON course_setting_note_edit (note_id, edited_at);
CREATE INDEX IF NOT EXISTS course_setting_note_edit_reply_idx ON course_setting_note_edit (reply_id) WHERE reply_id IS NOT NULL;
