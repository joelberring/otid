-- Besöksstatistiken (ägaren 2026-11-22): unika besökare per dygn och steg (startsidan, demotävlingen, gästdemon, Skapa
-- konto/logga in) till superadmins veckorapport. Inga kakor och inga IP-adresser: en besökare räknas med en HMAC av adress och
-- webbläsare med dygnets slumpade salt. Saltet och hasharna finns bara under innevarande dygn (svensk tid); därefter räknas de
-- ihop till antal per dag och steg och tas bort (`visitor-stats.ts`). Hasharna och saltet tas inte med i säkerhetskopian
-- (deploy/backup.sh). Bara nya tabeller (migrations/README.md).
CREATE TABLE IF NOT EXISTS visitor_day_salt (
  day date NOT NULL,
  salt text NOT NULL,
  CONSTRAINT visitor_day_salt_pkey PRIMARY KEY (day),
  CONSTRAINT visitor_day_salt_salt_check CHECK (salt ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS visitor_hit (
  day date NOT NULL,
  step text NOT NULL,
  hash text NOT NULL,
  CONSTRAINT visitor_hit_pkey PRIMARY KEY (day, step, hash),
  CONSTRAINT visitor_hit_step_check CHECK (step ~ '^[A-Z_]{1,32}$'),
  CONSTRAINT visitor_hit_hash_check CHECK (hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS visitor_day_count (
  day date NOT NULL,
  step text NOT NULL,
  visitors integer NOT NULL,
  CONSTRAINT visitor_day_count_pkey PRIMARY KEY (day, step),
  CONSTRAINT visitor_day_count_step_check CHECK (step ~ '^[A-Z_]{1,32}$'),
  CONSTRAINT visitor_day_count_visitors_check CHECK (visitors >= 0)
);
