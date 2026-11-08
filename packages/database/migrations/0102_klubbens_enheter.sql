-- Ägaren 2026-11-08: klubbens enhetsregister. En SPORTident-enhet (kontroll, start, mål) känns igen på serienumret; när den
-- läses ut eller ställs in i O-Tid sparas det senaste: modell, programversion, kod, läge, batteribyte, backupminnet och hur
-- mycket klockan gick fel. Ledare och administratörer sparar och skriver anteckningar; alla medlemmar ser listan.
--
-- `last_read_by` är kontot som läste senast, utan främmande nyckel (raden står kvar när kontot tas bort).
-- Bara tillägg (migrations/README.md).
CREATE TABLE IF NOT EXISTS club_device (
  club_id uuid NOT NULL,
  serial_number bigint NOT NULL,
  model text,
  firmware text,
  code integer,
  mode integer,
  battery_date date,
  battery_capacity_raw integer,
  memory_kb integer,
  backup_count integer,
  clock_offset_ms integer,
  note text NOT NULL DEFAULT '',
  first_seen_at timestamp with time zone NOT NULL,
  last_read_at timestamp with time zone NOT NULL,
  last_read_by uuid,
  CONSTRAINT club_device_pkey PRIMARY KEY (club_id, serial_number),
  CONSTRAINT club_device_club_fkey FOREIGN KEY (club_id) REFERENCES club (id),
  CONSTRAINT club_device_serial_check CHECK (serial_number > 0 AND serial_number < 4294967296),
  CONSTRAINT club_device_note_check CHECK (char_length(note) <= 500),
  CONSTRAINT club_device_text_check CHECK (char_length(coalesce(model, '')) <= 40 AND char_length(coalesce(firmware, '')) <= 20)
);
