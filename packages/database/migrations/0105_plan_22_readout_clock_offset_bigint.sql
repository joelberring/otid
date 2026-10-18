-- PLAN.md steg 22: stationens avvikelse från datorn får plats i integer bara upp till cirka 24,8 dygn. Övningsstationen
-- på en tävling längre fram (och en felställd station) ger större avvikelse, och avläsningen kunde då inte sparas.
-- Kontraktet tillåter ±10^12 ms, så kolumnen blir bigint. Råmeddelandet (raw_device_message.raw_payload) är oförändrat.
ALTER TABLE "card_readout" ALTER COLUMN "clock_offset_ms" TYPE bigint;
