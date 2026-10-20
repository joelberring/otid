-- Steg 33 (tillägg): "Uppdatera startlistan löpande". På = den publika startlistan visar läget just nu (samma innehåll
-- och samma grind som en publicerad lista). Av (standard) = den senast publicerade ögonblicksbilden, som förut.
ALTER TABLE race ADD COLUMN IF NOT EXISTS start_list_live boolean NOT NULL DEFAULT false;
