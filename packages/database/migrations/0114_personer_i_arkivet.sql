-- Ägaren 2026-11-12 (docs/plan-ledarflode-2026-11-12.md, G (ii); ADR-0221 tillägg 2026-11-12): planens personer när
-- träningen lades i klubbarkivet – den ansvarige (kind RESPONSIBLE) och varje uppgift (kind TASK, med rubriken). När en
-- träning kopieras ur arkivet följer de med som är ledare i klubbytan när kopian görs; övriga uppgifter kopieras utan person.
-- Inga e-postadresser sparas (en uppgift på en adress får account_id null). Raden tas bort med arkivposten; ett borttaget
-- konto tar bort sina rader (främmande nyckeln följs av borttagningen, purge.ts). Bara tillägg (migrations/README.md).
CREATE TABLE IF NOT EXISTS club_archive_entry_person (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES club_archive_entry(id),
  kind text NOT NULL,
  title text,
  account_id uuid REFERENCES user_account(id) ON DELETE SET NULL,
  position integer NOT NULL
);
CREATE INDEX IF NOT EXISTS club_archive_entry_person_entry_idx ON club_archive_entry_person (entry_id, position);
