-- Steg 65 (ADR-0184): PDF för tryck som jobb i en kö. Admin skapar jobbet från förhandsvisningen; en egen process
-- (print-worker, låg prioritet) tar jobben ett i taget och skriver PDF:en hit. Avläsning och tävlingsarbete berörs inte:
-- arbetaren har en egen liten databaspool och korta transaktioner, och låser inga av tävlingens tabeller.
--
-- `request` är vad som skrivs ut (banor eller löpare, mall, profil); `document` är banläggningens dokument när jobbet
-- skapades (version `document_version`), så att PDF:en blir den som förhandsvisningen visade. PDF:erna rensas efter en
-- tid och tas inte med i säkerhetskopian (de kan skapas igen); raden står kvar en tid som historik.
CREATE TABLE IF NOT EXISTS course_setting_print_job (
    id uuid PRIMARY KEY,
    race_id uuid NOT NULL,
    request_id uuid NOT NULL,
    kind text NOT NULL,
    status text NOT NULL DEFAULT 'QUEUED',
    label text NOT NULL,
    request jsonb NOT NULL,
    document jsonb NOT NULL,
    document_version integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    started_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    finished_at timestamp with time zone,
    attempts integer NOT NULL DEFAULT 0,
    worker text,
    error text,
    pdf bytea,
    byte_length integer,
    pages integer,
    sha256 text,
    report jsonb,
    CONSTRAINT course_setting_print_job_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_print_job_request_unique UNIQUE (race_id, request_id),
    CONSTRAINT course_setting_print_job_kind_check CHECK (kind IN ('PRESS', 'PROCESS', 'OFFICE')),
    CONSTRAINT course_setting_print_job_status_check CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED')),
    CONSTRAINT course_setting_print_job_pdf_check CHECK (pdf IS NULL OR status = 'DONE')
);

CREATE INDEX IF NOT EXISTS course_setting_print_job_queue_idx ON course_setting_print_job (status, created_at);
CREATE INDEX IF NOT EXISTS course_setting_print_job_race_idx ON course_setting_print_job (race_id, created_at DESC);
