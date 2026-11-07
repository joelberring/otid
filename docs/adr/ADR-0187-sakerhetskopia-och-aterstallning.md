# ADR-0187: Arrangörens säkerhetskopia och återställning av en tävling

Status: beslutad 2026-11-02 (grenen `aterstallning`, migration 0041 och 0042). Ersätter steg 27:s "Exportera tävlingen" (JSON,
formatVersion 1), som inte gick att läsa in igen.

## Bakgrund

Serverns backup (ADR-0186 beslut 8) skyddar driften, men arrangören har ingen egen kopia. Går servern sönder på tävlingsdagen
ska arrangören kunna läsa in sin tävling på en annan server eller installation och fortsätta: samma banor, kartfil, deltagare,
brickor, starttider, avläsningar och resultat. Den gamla exporten saknade flera tabeller (avprickningen, kortbaneöverflyttningen,
journalerna för begäranden, festen), skrev binärdata i base64 i en enda JSON och kunde inte läsas in.

## Beslut

1. **Formatet.** En zip (`otid-sakerhetskopia-<lopp>-<datum>-<ÅÅÅÅMMDD-TTMM>.zip`), vanlig PKZIP med deflate (egen liten skrivare
   och läsare i `race-backup-zip.ts`, inget nytt beroende):
   - `manifest.json`: `format: "otid-sakerhetskopia"`, `formatVersion: 2`, tidpunkt, resultatmotorns version,
     `containsPersonalData: true`, tävlingens namn, datum, typ och tidszon, antal, antal inaktuella resultat och en lista över
     varje annan fil med storlek och sha256.
   - `data/<tabell>.json`: tävlingens rader som databasen har dem (kolumnnamn i snake_case, tider i ISO 8601), en fil per tabell
     i inläsningsordning (`RACE_BACKUP_TABLES`). Binärdata (kartfilen, kartbilden, foton, GPX, festens logga) står som
     `{ "fil": "<sha256>" }` och ligger orörd i `filer/<sha256>`.
   - `personer.json`: personer med behörighet (administratör, funktionär, banläggning) som e-post och roll.
   Varje tabell med `race_id` är antingen med eller uttryckligen utanför (`RACE_BACKUP_EXCLUDED_TABLES`, med skäl);
   integrationstestet jämför med databasens katalog, så en ny tabell kräver ett beslut. Nya kolumner kommer med utan kodändring.
2. **Aldrig med:** konton, lösenord, sessioner, återställnings- och bekräftelselänkar, Eventor-nyckeln (`race_eventor_link`
   utan `key_id`, `iv`, `tag`, `ciphertext`), PDF:er för tryck, resultatströmmens tekniska väckningar och träningsgruppen (bara
   evenemangets koppling, som töms vid återställning). Kontonas id i raderna (och inuti JSON och text) byts mot slumpade
   referenser; e-post finns bara för personer med behörighet.
3. **`formatVersion`** höjs när en tabell eller kolumn ändrar betydelse. En okänd version avvisas med versionen i beskedet
   ("uppdatera servern"); den gamla JSON-exporten (version 1) känns igen och avvisas med ett eget besked. En kolumn eller tabell
   som servern inte känner till (en kopia från en nyare O-Tid) avvisas också med namnet.
4. **Återställningen skapar alltid en NY tävling** (nytt evenemang och lopp); ingen befintlig tävling skrivs över eller slås ihop.
   Alla id byts: varje värde i en uuid-kolumn får ett nytt id, och samma byte görs överallt i JSON och text (t.ex. den fastställda
   IOF XML:en och kanonisk JSON), utom i råa avläsningar och inlästa filer (`verbatim`), som är oförändrade. Enhetens id byts
   också, så samma kopia kan läsas in flera gånger på samma server. Den fastställda XML:ens kontrollsumma räknas om.
5. **Samma resultat.** Avläsningar, resultatrevisioner, beslut och fastställanden läses in som de är; ingenting räknas om. Den
   publika resultatlistan, sträcktiderna, stafetten och IOF-resultatlistan blir desamma (integrationstestet `aterstallning`
   och Playwright `aterstallning`). Ett resultat som väntade på omräkning när kopian togs förblir inaktuellt: exporten listar
   revisionerna vars underlagshash inte stämde (`staleResultRevisions` i manifestet), och återställningen behåller deras gamla
   hash (som aldrig stämmer med de nya id:na). Databasutlösaren räknar annars ut hashen för varje ny revision; migration 0042
   låter den behålla en medförd hash bara när transaktionen har satt `otid.restore` och hashen skiljer sig från den uträknade,
   så en återställning kan göra ett resultat inaktuellt men aldrig aktuellt. Inget räknas om (resultaten ska vara desamma som i
   kopian). Kopior från före fältet saknar listan; där räknas alla som aktuella.
6. **Kontrollen är strikt** och görs innan något sparas: arkivets gränser (200 MB fil, 96 MB per tabellfil, 72 MB per binärfil,
   400 MB uppackat, 10 000 filer, bara kända filnamn, inga dubbletter eller krypterade poster, uppackning med tak och CRC),
   manifestet och personerna med zod, sha256 för varje fil och varje rad med zod efter databasens katalog (bara kända kolumner,
   rätt typ, NULL bara där det är tillåtet). Säger databasen nej (ett villkor) rullas allt tillbaka med tabellens namn i beskedet.
7. **Behörighet.** Att ladda ner kräver administratör på tävlingen. Att återställa kräver bara ett inloggat konto, samma krav som
   för att skapa en tävling: den som återställer blir ägare av en ny tävling med data som den redan har i filen. Med valet "Ge
   dem samma behörighet här" får personerna i `personer.json` sin roll igen om det finns ett ospärrat konto med samma e-post
   (ägare blir administratör); annars får bara den som återställer behörighet. Behörigheter från andra kräver som förut bekräftad
   e-post (ADR-0186 beslut 9).
8. **Den nya tävlingen** är opublicerad med egen kort adress, radiohämtningen är avstängd och Eventor-kopplingen saknar nyckel.
   Superadminens döljning följer med (som vid en kopia, steg 21).
9. **Idempotens och journal.** `race_restore_request` (migration 0041) är kvittot: samma begärans id med samma fil och val ger
   samma tävling, annars 409. Journalen (`audit_event`) får `RACE_BACKUP_CREATED` och `RACE_RESTORED_FROM_BACKUP` med kontrollsumma,
   tid och antal, utan namn eller adresser; `race.last_backup_at` ger "Senast nedladdad" under Inställningar.

## Följder

- Filen innehåller personuppgifter. Appen säger det vid nedladdningen och återställningen; integritetssidan säger att kopior på
  arrangörens dator är arrangörens ansvar.
- `docs/export.md` beskriver formatet, `docs/drift.md` arrangörens kopia och återställning på en ny server.
- Avläsningsdatorns kö hör till den gamla tävlingens id och skickas aldrig till den återställda; avläsningssidan visar väntande
  avläsningar för en annan tävling med bricka och tid och kan ladda ner dem, och inget tas bort (`docs/drift.md`).
- Kopian ersätter inte serverns backup: konton, behörigheternas historik och andra tävlingar finns bara där.

Ändrat 2026-11-07 (städrundan, grenen `a1-sakerhet`): förhandsvisningen säger inte längre om en adress har konto här (fältet
`hasAccount` borttaget), eftersom filen bara har sha256 och ingen serversignatur, så en hemmagjord kopia kunde fråga ut servern.
En person med behörighet som bjöds in "Från klubben" följer med utan adress (`email: null`, ADR-0209 beslut 7) och kopplas aldrig
vid återställningen; kopplingen görs per referens i kopian. (Själva återställningen med "Ge dem samma behörighet" säger
fortfarande vilka adresser som saknar konto; se slutrapporten.)

Ändrat 2026-11-07 (städrundan, grenen `d-smafixar`, ersätter beslut 7:s "Ge dem samma behörighet här"): återställningen ger inget
annat konto än den som återställer behörighet direkt. Valet heter "Bjud in dem med samma roller" (`people: "link"`) och skapar
vanliga inbjudningar (ADR-0188 beslut 6, mejl med spärrarna i ADR-0206) till adresserna i `personer.json`; svaret säger bara
antalet (`invitations`, i stället för `linkedPeople`/`missingPeople`), likadant för en adress med och utan konto. Banläggningens
behörigheter i kopian blir inbjudningar på samma sätt. Bara referensen med den återställandes egen adress kopplas till kontot.
