-- ADR-0219 (steg K3b, tillägget om spelifieringen): frivilliga topplistor i kartprojekten. Av från början: både projektet (ägarna)
-- och personen måste slå på dem. Statistiken räknas ur det som redan finns (ändringarna, förslagen, spåren, bekräftelserna och
-- notiserna); inget nytt spelas in.
--
-- Bara tillägg (migrations/README.md): en ny nullbar kolumn på map_project och en ny tabell.

-- Projektets topplista: null = av, annars hur namnen visas (`FIRST` förnamn, `FULL` hela namnet, `NONE` utan namn).
ALTER TABLE map_project ADD COLUMN IF NOT EXISTS leaderboard text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'map_project_leaderboard_check') THEN
    ALTER TABLE map_project ADD CONSTRAINT map_project_leaderboard_check CHECK (leaderboard IS NULL OR leaderboard ~ '^[A-Z][A-Z_]{1,30}$');
  END IF;
END $$;

-- Personen vill synas i topplistorna (i projekt som har dem på). Raden tas bort med kontot.
CREATE TABLE IF NOT EXISTS map_stats_opt_in (
  account_id uuid NOT NULL,
  enabled_at timestamp with time zone NOT NULL,
  CONSTRAINT map_stats_opt_in_pkey PRIMARY KEY (account_id),
  CONSTRAINT map_stats_opt_in_account_fkey FOREIGN KEY (account_id) REFERENCES user_account (id)
);
