-- Steg 67 (ADR-0181 beslut 6): "kollad" per kontroll i fältläget, med vem, när och var kontrollen låg då (kartans mm).
-- Den ligger utanför banläggningens dokument, som notiserna (beslut 1): den som bara läser och kommenterar
-- (bankontrollanten) får bocka, en bock blir ingen ny version och inget förslag, en ny .ppen tar inte bort den, och
-- banpåtryck, beskrivningar, .ppen och överföringen läser den aldrig. Följer inte med när tävlingen kopieras.
--
-- En rad per kontroll som någon gång bockats: checked = false är en avbockning som står kvar, så att en äldre bock från en
-- telefon utan nät (tiden när det gjordes, changed_at) inte kan ändra en nyare avbockning. Den senaste vinner.
CREATE TABLE IF NOT EXISTS course_setting_inspection (
    race_id uuid NOT NULL,
    control_id text NOT NULL,
    checked boolean NOT NULL,
    changed_at timestamp with time zone NOT NULL,
    changed_by uuid NOT NULL,
    at_x double precision,
    at_y double precision,
    CONSTRAINT course_setting_inspection_pkey PRIMARY KEY (race_id, control_id),
    CONSTRAINT course_setting_inspection_race_id_fkey FOREIGN KEY (race_id) REFERENCES race(id),
    CONSTRAINT course_setting_inspection_at_check CHECK ((at_x IS NULL) = (at_y IS NULL)),
    CONSTRAINT course_setting_inspection_control_check CHECK (char_length(control_id) BETWEEN 1 AND 64)
);
