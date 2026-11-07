-- Städrundan 2026-11-07, paket D (som K4 i 0087): avsändaren av en tävlingsinbjudan och av en inbjudningslänk pekades ut med
-- främmande nyckel till user_account. Borttagningen av ett konto (`purgeRows`, som följer nycklarna) tog då bort tävlingens
-- öppna inbjudningar som kontot skickat och länkarna i mejlen som kontot skickat, så att länken slutade fungera för mottagaren.
-- Bara villkoren tas bort (ingen data ändras). Id:t kan alltså peka på ett konto som inte finns: länksidan visar då inbjudan
-- utan avsändarens namn, och en inbjudan som tas efteråt ger behörigheten utan journalraden i
-- event_administration_access_request (som har kvar sin nyckel till kontot).
ALTER TABLE race_person_invitation DROP CONSTRAINT IF EXISTS race_person_invitation_actor_account_id_fkey;
ALTER TABLE invitation_link DROP CONSTRAINT IF EXISTS invitation_link_issued_by_fkey;
