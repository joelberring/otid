-- ADR-0168: en kontoinloggning ska räcka en hel tävlingshelg (30 dagar).
-- Återgång: sätt tillbaka gränsen till 8 timmar först när inga längre sessioner finns kvar.
ALTER TABLE user_account_session DROP CONSTRAINT user_account_session_lifetime_check;
ALTER TABLE user_account_session ADD CONSTRAINT user_account_session_lifetime_check CHECK (
  expires_at > issued_at AND expires_at <= issued_at + interval '31 days');
