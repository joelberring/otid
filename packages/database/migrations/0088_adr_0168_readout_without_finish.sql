-- Steg 4 (ADR-0168): en bricka utan målstämpling ska kunna sparas och bedömas
-- (resultatmotorn ger MISSING_FINISH). Återgång kräver att sådana rader först rättas.
ALTER TABLE card_readout ALTER COLUMN finish_punched_at DROP NOT NULL;
