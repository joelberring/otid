-- Steg 45 (rättelser efter genomlysningen): tidsjustering för alla enheter på en gång (start, mål och alla kontroller),
-- till exempel när enheterna gick på sommartid. Stationen heter ALL och har ingen kontrollkod.
ALTER TABLE race_station_correction DROP CONSTRAINT race_station_correction_station_check;
--> statement-breakpoint
ALTER TABLE race_station_correction ADD CONSTRAINT race_station_correction_station_check
  CHECK (station IN ('START', 'FINISH', 'CONTROL', 'ALL'));
--> statement-breakpoint
-- Avläsningarna läses per tävling och lästid (avläsningssidan, festen, live); utan index blev det en hel tabellgenomsökning.
CREATE INDEX IF NOT EXISTS card_readout_race_read_at_idx ON card_readout (race_id, read_at);
