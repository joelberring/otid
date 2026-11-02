-- ADR-0189 beslut 5–7: anonymisera en deltagare och gallra gamla tävlingar. Bara tillägg.
--
-- `entry.anonymized_at`: när deltagaren anonymiserades (namn, klubb, bricka i journalerna och Eventors id borta; resultatet och
-- sträcktiderna kvar som "Anonym deltagare"). `race.personal_data_removed_at`: när gallringen anonymiserade hela tävlingen.
ALTER TABLE entry ADD COLUMN IF NOT EXISTS anonymized_at timestamp with time zone;
ALTER TABLE race ADD COLUMN IF NOT EXISTS personal_data_removed_at timestamp with time zone;

-- Journalerna är oföränderliga (bara purge får ta bort). Anonymiseringen behöver skriva över personuppgifterna i dem; den sätter
-- `otid.anonymize` i sin egen transaktion. Råa avläsningar, avläsningarnas tolkning och radiostämplingar ändras aldrig
-- (AGENTS.md: ingen ändring av råa avläsningar).
CREATE OR REPLACE FUNCTION public.reject_immutable_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('otid.purge', true) = 'on' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND current_setting('otid.anonymize', true) = 'on'
    AND TG_TABLE_NAME NOT IN ('raw_device_message', 'device_ingest_outcome', 'card_readout', 'radio_punch') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
