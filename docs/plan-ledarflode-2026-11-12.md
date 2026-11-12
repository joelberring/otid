# Ledarflödet 2026-11-12: det som kräver migration (specifikation; G, Hämta ur arkivet och Kopiera upplägg byggda)

Användartestet av ledarflödet (klubbyta → klubbarkiv → terminsplan → träning → arkivet) gav punkterna A–G. A–F är byggda på
grenen `claude/r2-b` utan migration. Det här är det som inte gick att bygga utan ny kolumn eller tabell, skrivet så att det
kan byggas direkt. Migrationsnumret väljs när det byggs (senaste på `main` när detta skrevs: 0112; en annan tråd arbetar i
samma repo, så samordna numret). Alla migrationer nedan är bara tillägg (inga borttagningar, ingen omskrivning av data).

## Byggt 2026-11-12 (grenen `claude/r3-a`, migrationerna 0113 och 0114)

G (i), G (ii), Hämta ur arkivet och Kopiera upplägg från termin är byggda enligt ägarens beslut samma dag (ADR-0209 och
ADR-0221, tilläggen 2026-11-12). Avvikelser från specifikationen nedan:

- `race_club_archive_auto`: `enabled` är nullbar (null = förvalet) och `set_by`/`set_at` är den som valde, så att `explicit`
  och en rad som bara bär spärren eller ett problem går att skilja åt; `updated_at` är ny. Migrationen ger spärren åt tävlingar
  som redan har lagts i ett arkiv (journalens `RACE_ADDED_TO_CLUB_ARCHIVE`), så att inget som någon tagit ur läggs tillbaka.
- Förvalet är på bara för en **Träning** (ägarens ord: "en träning som hör till en klubb"); andra typer kan kryssas i.
- Varje inlyft (också för hand) sätter `archived_at`, så Ta ur gör aldrig om den automatiska.
- Rutan syns och ändras med samma behörighet som Lägg i klubbarkivet (administratör i tävlingen och i klubbytan); andra ser
  ingen ruta (klubbytan röjs inte).
- Underhållsvarvet tittar bara på de senaste 14 dagarnas tävlingar, så gamla träningar läggs inte in när funktionen kommer.
- Hämta ur arkivet: servern gör planraden (med moment och ledarna om de är valda); banorna och kartan läggs på med Använd igen
  (förvald planrad), som skapar träningen och kopplar den. Två steg, inte en transaktion: Använd igen ritar kartan i webbläsaren.
- Personerna kopieras till planraden också vid Använd igen → Till terminsplanen, före kopplingen.
- Inte byggt: "Kopiera" på en enskild planrad, ett förval per klubb för rutan, E och C (a) nedan, och e2e i `klubbarkiv.spec.ts`
  (klubben där är inte kopplad till Eventor).

## Varför G inte byggdes

Ägarens beslut (i) kräver en plats per tävling för valet "Lägg i klubbarkivet när träningen är klar" som kan kryssas ur.
Tabellen `race` har inga fria inställningskolumner (`start_draw_settings` och `map_reserve` är jsonb men har bestämda
betydelser), och `race_organiser`/`race_club_archive` har ingen sådan kolumn. Att spara valet i `audit_event` eller
`club_journal` vore att läsa en inställning ur en logg. Beslut (ii) kunde delvis byggas utan migration genom
`race_club_archive.race_id → club_plan_session.race_id → club_plan_task`, men den kedjan bryts när planraden eller uppgiften
ändras efter inlyftet, och uppdraget sa att ingenting av G byggs om (i) inte går. Båda specificeras därför här.

## G (i): automatisk arkivering när träningen är klar

**Schema.** Ny tabell `race_club_archive_auto` (en rad per tävling där någon har tagit ställning):

| kolumn | typ | förval | anmärkning |
|---|---|---|---|
| `race_id` | uuid, PK, FK `race.id` | – | tas bort med tävlingen (`purge.ts`, säkerhetskopian i `race-backup-tables.ts`) |
| `enabled` | boolean not null | – | `false` = kryssat ur |
| `set_by` | uuid not null | – | kontot (ingen FK, som `race_organiser.set_by`) |
| `set_at` | timestamptz not null | – | |
| `archived_at` | timestamptz null | null | när den automatiska arkiveringen gjordes (spärr mot att göra om den) |
| `problem` | text null | null | senaste skälet till att den inte gick (t.ex. `NO_SPACE`, `NO_ADMIN`), visas för den ansvarige |

**Förval utan rad:** på när tävlingen har en arrangörsklubb vars organisation har en klubbyta (`club_setting.organisation_id`).
Det räknas fram i läsningen; ingen rad skrivs förrän någon ändrar rutan. (Så får också befintliga tävlingar förvalet.)

**Kod.**
- `packages/contracts/src/club-affiliation.ts`: `RaceClubArchiveView` får `auto: { enabled: boolean; explicit: boolean;
  archivedAt: string | null; problem: string | null }`; ny `raceClubArchiveAutoRequestSchema = { formatVersion: 1, enabled: boolean }`.
- `packages/application/src/race-club-archive.ts`: `view()` läser raden; ny `setRaceClubArchiveAutoAsAdmin` (tävlingens
  administratör, auditpost `RACE_CLUB_ARCHIVE_AUTO_SET`). Route: `PATCH /api/organizer/races/[raceId]/club-archive`
  (`raceClubArchiveRoute`).
- **Arkiveringen** görs av samma kod som knappen: bryt ut kroppen i `liftRaceToClubArchive` till
  `liftInTransaction(tx, { raceId, clubId, actorId, now, confirmSecrecy: false })` och anropa den från båda vägarna.
  Aktören för den automatiska är tävlingens ägare (`event_administration_grant` med `OWNER`) om hen är administratör eller ägare
  i klubbytan, annars den ansvarige i planen (`club_plan_session.responsible_account_id`) om hen är det, annars görs ingenting
  och `problem = 'NO_ADMIN'` sparas (arkivet kräver båda behörigheterna, ADR-0209 beslut 8; den regeln ändras inte).
- **Villkoret** är dagens påminnelse: `raceFinishedForArchive({ raceDate, today, coursesPublic })` (`@o-tid/domain`;
  `coursesPublic` från `coursesArePublic`, som blir sant när alla har gått i mål eller fått ett beslut, ADR-0176). Lägg till att
  tävlingen inte redan ligger i arkivet (`race_club_archive` för klubben) och att `archived_at` är null.
- **Utlösaren** ligger inte i en GET. Två ställen, båda idempotenta (radlås på tävlingen, `archived_at`):
  1. Efter den skrivning som gör `coursesArePublic` sant: avläsningen (`ingest.ts`, där resultatet sparas) och besluten
     (`entry-status.ts`, DNS/DNF/borttagen). Anropa `maybeAutoArchive(tx, raceId, now)` sist i samma transaktion; det gör
     ingenting om villkoret inte håller. Kostnaden är en indexerad läsning per avläsning; mät i `steg-51-lasttest`.
  2. Underhållsvarvet (`apps/web/src/lib/maintenance-runner.ts`, en gång i timmen): tävlingar där `race_date < i dag` och som
     har förvalet på eller `enabled = true` men inte `archived_at` och inte ligger i arkivet (högst 20 per varv), för dagen
     efter tävlingen när ingen läste ut alla.
- **Vem ser vad.** Rutan "Lägg i klubbarkivet när träningen är klar" står under Inställningar → Klubben och klubbarkivet
  (`club-archive-section.tsx`), ikryssad enligt förvalet, för tävlingens administratörer. När den är gjord ser den ansvarige
  och tävlingens administratörer "Lagd i klubbarkivet <datum> · Ta ur" (Ta ur = befintliga `removeRaceFromClubArchive`; den
  sätter inte tillbaka `archived_at`, så den görs inte om). Påminnelsen (`ClubArchiveReminder`) visas inte när rutan är på.
- **Tester.** Integration: förvalet med och utan klubbyta; urkryssad ger ingen arkivering; den sista avläsningen arkiverar i
  samma transaktion; underhållsvarvet arkiverar dagen efter; dubbelkörning ger en post; utan administratör i klubbytan sparas
  `NO_ADMIN` och inget skapas; Ta ur gör inte om. E2e (`klubbarkiv.spec.ts`): en träning läses ut och syns i arkivet.

## G (ii): personerna följer med när en träning kopieras

**Schema.** Ny tabell `club_archive_entry_person` (planens personer när träningen lades i arkivet):

| kolumn | typ | förval | anmärkning |
|---|---|---|---|
| `id` | uuid PK | – | |
| `entry_id` | uuid not null, FK `club_archive_entry.id` | – | tas bort med posten (också i `removeRaceFromClubArchive`) |
| `kind` | text not null, `RESPONSIBLE` eller `TASK` | – | |
| `title` | text null | null | uppgiftens rubrik (null för den ansvarige) |
| `account_id` | uuid null, FK `user_account.id` on delete set null | null | personen; e-postadresser sparas inte |
| `position` | integer not null | – | ordningen |

**Skrivs** i `liftInTransaction` (se ovan) ur `club_plan_session`/`club_plan_task` för tävlingen: den ansvarige och varje
uppgift (rubrik, och kontot om uppgiften låg på ett konto). Uppgifter på en adress sparas med `account_id = null`.

**Läses** när en träning kopieras ur arkivet till planen (Använd igen → Till terminsplanen, `reuse-dialog.tsx` → ny
`copyPlanPeople`-väg i `club-plan-tasks.ts`) och när en rad kopieras i planen (nytt "Kopiera" på planraden, och
"Kopiera upplägg från termin" nedan): personer som **när kopian görs** är `LEADER`, `ADMIN` eller `OWNER` i klubbytan
(`clubMembership`, `clubRoleAtLeast(role, "LEADER")`) följer med som ansvarig och på sina uppgifter; övriga uppgifter
kopieras med rubriken men utan person. Inga mejl skickas vid kopieringen (anropa inte `preparePlanMail`). Läsrätten i
banläggningen ges som vanligt när träningen finns (`attachRace`).

**Tester.** Integration: ledare följer med, en medlem utan ledarroll och en adress kopieras utan person, en ledare som
slutat vara ledare följer inte med, inga mejl (mejlaren anropas inte), posten tas bort med arkivposten.

## E: välja en väntande inbjuden som ansvarig

Det byggda: en ledare som bjuds in "Från klubben" gäller direkt (ADR-0206 tillägg 2026-11-12). En inskriven adress kan inte
gälla direkt utan att röja kontot (ADR-0188 beslut 6). För att ändå kunna välja den som ansvarig:

- `club_plan_session.responsible_email text null` (normaliserad som `accountEmailSchema`), med villkoret att högst en av
  `responsible_account_id` och `responsible_email` är satt.
- `ClubPlanResponse.people` får de öppna inbjudningarna till klubben med rollen `LEADER` eller högre som
  `{ invitationId, email, pending: true }` (bara för ledarna, som ser adressen i Medlemmar ändå); väljaren Ansvarig visar dem
  med "väntar på inloggning". Begäran tar `responsible: { kind: "MEMBER", accountId } | { kind: "INVITED", invitationId } | null`.
- När inbjudan tas (`acceptClubInvitations`) blir raderna med samma adress kontots (`responsible_account_id`, adressen null),
  och administratörsrollen på en redan skapad träning ges som i `updatePlanSession`. Tas inbjudan bort blir raderna utan ansvarig.
- Mejlet går som för uppgifterna (`preparePlanMail` med `{ email }`).
- Tester: välj väntande, inbjudan tas → kontot är ansvarig och administratör; inbjudan återkallas → ingen ansvarig.

## C (a): banor utan lägen i arkivets IOF XML

Byggt utan migration: dialogen och arkivposten säger vilka av tidtagningens banor som saknas i banläggningen. Att också skriva
dem i den arkiverade IOF XML-filen kräver ingen migration men en utökning av `writeIofCourseData`
(`packages/course-setting/src/iof-export.ts`), som i dag bara skriver banläggningens banor med lägen: ett alternativ
`extraCourses: { name, controlCodes, lengthMeters? }[]` som skriver `Control` utan `MapPosition` för koder som inte finns i
dokumentet och en `Course` med `CourseControl` i ordning (start och mål utan läge). Läsarsidan måste tåla det: arkivets
förhandsvisning (`courseDataPoints`) hoppar över banor utan lägen, och Använd igen med en sådan fil får banorna i tidtagningen
men inte på kartan (`courseSettingFromCourseData` säger redan "kan inte läggas på kartan"). Prova mot MeOS/OLA innan.

## Hämta ur arkivet i terminsplanens vecka (byggd 2026-11-12, se ovan)

- Knappen "Hämta ur arkivet" i veckan (bredvid Lägg till träning, för ledare och mer, när arkivet syns för dem).
- Väljare med ett kort per arkivträning: småbilden (`club_archive_entry_thumbnail`), rubrik, datum, karta, moment och nivåer
  (ADR-0222), banornas namn och antal.
- Sök på moment, nivå och karta (samma sökning som arkivlistan), sortering "samma veckor tidigare år" först (ISO-veckan ± 1 i
  tidigare år), sedan senast.
- Val av vad som följer med: banorna (förval), kartan (senaste versionen, förval), moment/nivåer/egna ord (förval), personer
  (enligt G (ii), förval när det finns).
- Ett tryck: planrad (dagens datum i veckan, se F), träning (som Skapa träningen: grupp, ansvarig blir administratör,
  arrangörsklubben = klubben), kartan och banorna som Använd igen och överförda till tidtagningen (A). Bygger på
  `reuseTraining` men bör flyttas till servern när kartan inte behöver ritas i webbläsaren (kartfilen finns redan i klubbens
  kartbank; bilden kan ritas av geo-servern eller i bakgrunden).
- Tester: integration för planrad + träning + banor i en transaktion där det går; e2e i `terminsplanering.spec.ts`.

## Kopiera upplägg från termin (byggd 2026-11-12, se ovan)

- "Kopiera upplägg från termin" i en tom eller ny termin: välj en tidigare termin; varje planrad kopieras till samma veckodag
  i motsvarande vecka (räknat från terminens första vecka), med rubrik, tid, plats, karta, grupp, moment, nivåer och egna ord.
- Personer enligt G (ii) (ledare följer med, övriga uppgifter utan person, inga mejl). Ingen träning skapas; raderna är bara
  planerade.
- Rader som hamnar utanför den nya terminen hoppas över och räknas i beskedet ("12 träningar kopierade, 1 hamnade utanför").
- Kräver ingen migration utöver G (ii) (uppgifterna kopieras från `club_plan_task`).
