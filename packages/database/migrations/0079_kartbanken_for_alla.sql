-- ADR-0209 beslut 5 (ändrat 2026-11-04): kartbanken (kartfiler, Använd igen, nedladdning) är för alla medlemmar som förval.
-- Kartorna döljs bara som undantag, när klubben väljer "Ledare och admin".
ALTER TABLE club_setting ALTER COLUMN map_bank_access SET DEFAULT 'MEMBERS';

-- Raden sparar inte om värdet är förvalet eller ett val. Ett val syns i klubbens journal: en administratör som har ändrat
-- kartbanken från alla medlemmar till ledare och admin (CLUB_ACCESS_CHANGED). Övriga 'LEADERS' kom av det gamla förvalet (raden
-- skapades vid "Koppla till Eventor" eller när bara arkivet ändrades) och blir alla medlemmar. En engångsändring av data: ingen
-- driftsatt server har ADR-0209 (0076) än, så bara utvecklings- och provdatabaser har sådana rader (se ADR-0209, Följder).
UPDATE club_setting AS setting SET map_bank_access = 'MEMBERS'
  WHERE setting.map_bank_access = 'LEADERS'
    AND NOT EXISTS (SELECT 1 FROM club_journal AS journal
      WHERE journal.club_id = setting.club_id AND journal.action = 'CLUB_ACCESS_CHANGED'
        AND journal.details #>> '{from,mapBank}' = 'MEMBERS' AND journal.details #>> '{to,mapBank}' = 'LEADERS');
