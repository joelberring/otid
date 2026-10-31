-- Steg 62 (ADR-0180 beslut 1, 8): banläggningen som ett eget dokument per tävling (`CourseSettingDocument` i
-- @o-tid/course-setting) med versionsnummer för att två flikar inte ska skriva över varandra, och tidigare versioner i
-- course_setting_revision (de senaste 50 behålls). original_ppen är den senast inlästa .ppen-filen orörd (för nedladdning).
-- updated_by/created_by är kontots id utan främmande nyckel: ett borttaget hjälpkonto ska inte ta banläggningen med sig.
-- Bara admin läser och skriver; dokumentet är aldrig publikt (banhemligheten, ADR-0176).
CREATE TABLE IF NOT EXISTS course_setting (
    race_id uuid NOT NULL,
    document jsonb NOT NULL,
    version integer NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    updated_by uuid NOT NULL,
    original_ppen text,
    original_file_name text,
    original_imported_at timestamp with time zone,
    CONSTRAINT course_setting_pkey PRIMARY KEY (race_id),
    CONSTRAINT course_setting_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_version_check CHECK (version > 0),
    CONSTRAINT course_setting_document_check CHECK (jsonb_typeof(document) = 'object' AND document->>'version' = '1'),
    CONSTRAINT course_setting_original_check CHECK ((original_ppen IS NULL) = (original_file_name IS NULL)
      AND (original_ppen IS NULL) = (original_imported_at IS NULL)
      AND (original_file_name IS NULL OR char_length(original_file_name) BETWEEN 1 AND 200))
);

-- kind: SAVE (en äldre version vid vanligt sparande), IMPORT (dokumentet som ersattes av en inläst .ppen) och RESTORE
-- (dokumentet som ersattes när en tidigare version återställdes).
CREATE TABLE IF NOT EXISTS course_setting_revision (
    race_id uuid NOT NULL,
    version integer NOT NULL,
    kind text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT course_setting_revision_pkey PRIMARY KEY (race_id, version),
    CONSTRAINT course_setting_revision_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_revision_version_check CHECK (version > 0),
    CONSTRAINT course_setting_revision_kind_check CHECK (kind IN ('SAVE', 'IMPORT', 'RESTORE')),
    CONSTRAINT course_setting_revision_document_check CHECK (jsonb_typeof(document) = 'object' AND document->>'version' = '1')
);
