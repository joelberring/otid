-- Översynen 2026-11-02: avläsningens resultat slås upp på readout_id (okända avläsningar, lånad bricka, omräkning).
-- Utan index blir det en sökning genom hela result_revision vid varje avläsning. Byggs utan att låsa skrivningar
-- (CONCURRENTLY, utanför transaktionen; `src/migrator.ts`), så att migreringen går att köra medan appen används.
CREATE INDEX CONCURRENTLY IF NOT EXISTS result_revision_readout_idx ON result_revision (readout_id) WHERE readout_id IS NOT NULL;
