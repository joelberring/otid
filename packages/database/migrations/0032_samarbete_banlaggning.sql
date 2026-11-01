-- Steg 66 (ADR-0181 beslut 1–5): samarbete i banläggningen.
--
-- course_setting_grant: behörighet för banläggning per person och tävling (EDIT ändrar, SUGGEST föreslår, COMMENT läser
-- och kommenterar). Den ger bara banläggningens sidor och API, inte resten av tävlingen; ägare och administratörer på
-- eventet har EDIT utan rad här. Raden tas bort när behörigheten tas bort (en auditpost finns kvar).
CREATE TABLE IF NOT EXISTS course_setting_grant (
    id uuid NOT NULL,
    race_id uuid NOT NULL,
    account_id uuid NOT NULL,
    level text NOT NULL,
    granted_at timestamp with time zone NOT NULL,
    granted_by uuid NOT NULL,
    request_id uuid NOT NULL,
    CONSTRAINT course_setting_grant_pkey PRIMARY KEY (id),
    CONSTRAINT course_setting_grant_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_grant_account_id_fkey FOREIGN KEY (account_id) REFERENCES user_account(id),
    CONSTRAINT course_setting_grant_level_check CHECK (level IN ('EDIT', 'SUGGEST', 'COMMENT')),
    CONSTRAINT course_setting_grant_race_account_key UNIQUE (race_id, account_id),
    CONSTRAINT course_setting_grant_request_key UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS course_setting_grant_account_idx ON course_setting_grant (account_id);

-- Arbetssätt per tävling: LEAD = "Huvudbanläggare", SHARED = "Gemensamt".
ALTER TABLE course_setting ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'LEAD';
ALTER TABLE course_setting DROP CONSTRAINT IF EXISTS course_setting_mode_check;
ALTER TABLE course_setting ADD CONSTRAINT course_setting_mode_check CHECK (mode IN ('LEAD', 'SHARED'));

-- Ändringarna per version: vad de ändrade ("control:12:at" …, "ALL" när hela dokumentet ersattes) för att se om någon
-- annan hann ändra samma sak (den första vinner), och svaret på en sparning (samma request_id ger samma svar). De
-- senaste 500 versionerna behålls.
CREATE TABLE IF NOT EXISTS course_setting_change (
    race_id uuid NOT NULL,
    version integer NOT NULL,
    touches jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    request_id uuid,
    result jsonb,
    CONSTRAINT course_setting_change_pkey PRIMARY KEY (race_id, version),
    CONSTRAINT course_setting_change_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_change_version_check CHECK (version > 0),
    CONSTRAINT course_setting_change_touches_check CHECK (jsonb_typeof(touches) = 'array' OR touches = '"ALL"'::jsonb),
    CONSTRAINT course_setting_change_request_key UNIQUE (race_id, request_id)
);

-- Notiser: utanför dokumentet (banpåtryck, beskrivningar, .ppen och överföringen läser dem aldrig). Fäst vid en punkt
-- (mm), en kontroll, en sträcka (från/till kontrollens id) eller en bana. at_x/at_y är läget när notisen skrevs (även för
-- kontroll och sträcka, så att den syns om kontrollen tas bort). Foto högst 2 MB (förminskat i webbläsaren).
CREATE TABLE IF NOT EXISTS course_setting_note (
    id uuid NOT NULL,
    race_id uuid NOT NULL,
    target text NOT NULL,
    at_x double precision,
    at_y double precision,
    control_id text,
    from_control_id text,
    to_control_id text,
    course_id text,
    text text NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    photo bytea,
    photo_media_type text,
    request_id uuid NOT NULL,
    CONSTRAINT course_setting_note_pkey PRIMARY KEY (id),
    CONSTRAINT course_setting_note_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_note_request_key UNIQUE (request_id),
    CONSTRAINT course_setting_note_target_check CHECK (
      (target = 'POINT' AND at_x IS NOT NULL AND at_y IS NOT NULL) OR
      (target = 'CONTROL' AND control_id IS NOT NULL) OR
      (target = 'LEG' AND from_control_id IS NOT NULL AND to_control_id IS NOT NULL) OR
      (target = 'COURSE' AND course_id IS NOT NULL)),
    CONSTRAINT course_setting_note_text_check CHECK (char_length(text) BETWEEN 1 AND 2000),
    CONSTRAINT course_setting_note_status_check CHECK (status IN ('OPEN', 'DONE')
      AND (status = 'OPEN') = (resolved_at IS NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL)),
    CONSTRAINT course_setting_note_photo_check CHECK ((photo IS NULL) = (photo_media_type IS NULL)
      AND (photo IS NULL OR octet_length(photo) BETWEEN 1 AND 2097152)
      AND (photo_media_type IS NULL OR photo_media_type IN ('image/jpeg', 'image/png', 'image/webp')))
);
CREATE INDEX IF NOT EXISTS course_setting_note_race_idx ON course_setting_note (race_id, created_at);

CREATE TABLE IF NOT EXISTS course_setting_note_reply (
    id uuid NOT NULL,
    note_id uuid NOT NULL,
    race_id uuid NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    request_id uuid NOT NULL,
    CONSTRAINT course_setting_note_reply_pkey PRIMARY KEY (id),
    CONSTRAINT course_setting_note_reply_note_id_fkey FOREIGN KEY (note_id) REFERENCES course_setting_note(id),
    CONSTRAINT course_setting_note_reply_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_note_reply_request_key UNIQUE (request_id),
    CONSTRAINT course_setting_note_reply_text_check CHECK (char_length(text) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS course_setting_note_reply_note_idx ON course_setting_note_reply (note_id, created_at);

-- Förslag: åtgärder (CourseSettingEdit) mot en version, med id som varje åtgärd skapade hos författaren (`created`),
-- kommentar och status. result är vad godkännandet gav (gjorda och avvisade åtgärder).
CREATE TABLE IF NOT EXISTS course_setting_suggestion (
    id uuid NOT NULL,
    race_id uuid NOT NULL,
    base_version integer NOT NULL,
    edits jsonb NOT NULL,
    created jsonb NOT NULL,
    comment text NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    decision_comment text,
    result jsonb,
    request_id uuid NOT NULL,
    CONSTRAINT course_setting_suggestion_pkey PRIMARY KEY (id),
    CONSTRAINT course_setting_suggestion_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_suggestion_request_key UNIQUE (request_id),
    CONSTRAINT course_setting_suggestion_version_check CHECK (base_version > 0),
    CONSTRAINT course_setting_suggestion_edits_check CHECK (jsonb_typeof(edits) = 'array' AND jsonb_typeof(created) = 'array'),
    CONSTRAINT course_setting_suggestion_comment_check CHECK (char_length(comment) <= 2000
      AND (decision_comment IS NULL OR char_length(decision_comment) <= 2000)),
    CONSTRAINT course_setting_suggestion_status_check CHECK (status IN ('OPEN', 'APPROVED', 'PARTIAL', 'DECLINED')
      AND (status = 'OPEN') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL))
);
CREATE INDEX IF NOT EXISTS course_setting_suggestion_race_idx ON course_setting_suggestion (race_id, created_at);
