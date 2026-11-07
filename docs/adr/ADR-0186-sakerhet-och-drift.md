# ADR-0186: Säkerhet, integritet och drift efter översynen 2026-11-02

Status: beslutad 2026-11-02 (grenen `sakerhet-drift`). Ändrar ADR-0172 beslut 1 (registreringen), ADR-0176 (vad som syns
publikt före start) och steg 33 (bricknummer som förval).

## Bakgrund

En översyn 2026-11-02 hittade brister inför Stockholm by Night (9 december) på den publika servern otid.berring.se: gamla
beroenden med kända sårbarheter, publika sidor med barns namn som kunde indexeras, varianten och kartan publika före start,
en databasanvändare med superuser i alla tjänster, ingen larm när något går ner, backup bara på servern och e-postadresser
som går att räkna fram vid registreringen.

## Beslut

1. **Beroenden** hålls utan kända sårbarheter i produktionskoden (`pnpm audit --prod`). `next/image` används inte, så
   bildoptimeringen är avstängd (`images.unoptimized`, `/_next/image` svarar 404). Alla XML-läsare avvisar DTD/DOCTYPE/ENTITY.
2. **Inget publikt om löpare indexeras** (ägarens beslut 2026-10-24): `/results`, `/starts`, `/t`, `/fest`, `/g` och hela API:t
   stängs med robots.txt (också uttryckligen för kända AI-robotar), `X-Robots-Tag` och robots-meta (`lib/no-index.ts`).
   Startsidan, Om och Integritet indexeras som förut. Caddy skickar HSTS (ett år, utan `includeSubDomains`, eftersom domänen
   kan vara klubbens egen).
3. **Varianten publikt först efter start.** Variantens bokstav i den publika startlistan (sida, JSON och den publicerade IOF
   XML:en) och i den publika stafettlistan visas när löparen har startat (fast starttid passerad, stafettsträckan startad eller
   ett resultat), när banorna är publika enligt ADR-0176 eller när arrangören valt "Direkt" under Publicera → Före start.
   Starttiden räknas vid läsningen; de cachade listorna räknas om efter cachens maxålder (15 s). Så länge någon variant är dold
   ges startlistans IOF XML inte ut publikt (409), eftersom banans namn i den bär varianten. Gäller också befintliga tävlingar.
4. **Bricknummer** visas inte i den publika startlistan för nya tävlingar (förvalet i databasen är nu av). Befintliga tävlingar
   behåller sitt val.
5. **Kartbilden publikt efter start.** Den publika kartbilden (och därmed vägvalen, GPS-rutterna och kontrollkartan) lämnas ut
   när tävlingen har startat (Första start i Inställningar, den första fasta starttiden eller en masstart har passerat, eller
   något har lästs ut eller stämplats på en radiokontroll), när banorna är publika eller när arrangören valt "Direkt när
   tävlingen publiceras". Kartans avtal i träningsgruppen (ADR-0182) gäller som förut ovanpå.
6. **Databasroller.** `otid_owner` äger schemat och kör migreringarna (egen engångstjänst `migrate`) och backupen; `otid_app`
   (webben) läser och skriver data men kan inte ändra schemat; `otid_print` (utskriftsarbetaren) når bara utskriftskön,
   tävlingens namn och kartfilen. Superusern finns kvar för underhåll för hand. Övergången görs med `deploy/db-roles.sh` på en
   körande server; utan rollerna i `.env` fungerar allt som förut, så samma version kan köras före och efter övergången och
   övergången går att backa. Eventors masternyckel och e-posten ges bara till `web`.
7. **Bevakning.** Tjänsten `monitor` kontrollerar var 15:e minut webben och databasen (`/api/health`), publikens instanser,
   utskriftskön, disken (larm över 80 %) och att den senaste dumpen är färsk, och pingar en valfri bevakningstjänst
   (`OTID_HEARTBEAT_HEALTH_URL`, t.ex. healthchecks.io); backupen pingar `OTID_HEARTBEAT_BACKUP_URL`. Uteblivna pingar larmar
   bevakningstjänsten själv. Utskriftsarbetaren kör varje jobb i en barnprocess med tidsgräns och minnestak och har en
   hälsokontroll. Fel inställningar (t.ex. `O_TID_PUBLIC_ORIGIN`) skrivs i loggen vid start.
8. **Backup.** En dump varje timme dygnet runt och en dump före varje start av webben (`backup-before-migrate`, misslyckas den
   startar ingen ny version). Valfri krypterad kopia utanför servern med restic (`RESTIC_REPOSITORY`, `RESTIC_PASSWORD`).
   Ändrat 2026-11-07 (ADR-0216): 24 timdumpar i stället för 48, kartinnehållet sparas en gång per innehåll bredvid dumparna och
   miniatyrerna tas inte med; hälsokontrollen skriver också sitt resultat till webben, som larmar superadmin per e-post.
9. **Bekräftad e-post.** Behörigheter som andra delar ut med e-postadressen (administratör, funktionär, banläggning,
   gruppledare och gruppmedlem) gäller först när kontots adress är bekräftad; ägarskapet för det kontot självt skapat gäller
   alltid. Befintliga konton räknas som bekräftade. Med e-post på servern svarar registreringen likadant oavsett om adressen
   finns och gör arbetet efter svaret; kontot loggas in när länken öppnas, med lösenordet från samma registrering (så kan
   ingen få någon annans adress bekräftad med sitt lösenord). Glömt lösenord gör också arbetet efter svaret. Utan e-post
   loggar registreringen in direkt som förut, men adressen är obekräftad tills superadmin bekräftar den
   (`node superadmin.mjs verify <e-post>`) eller lösenordet byts med en återställningslänk.

## Följder

- Servern behöver e-post (SMTP) för att nya personer ska kunna få behörigheter utan att superadmin bekräftar dem för hand.
- En framtida migrering som kräver superuser (t.ex. `CREATE EXTENSION`) körs inte av `migrate`; den körs för hand.
- Formuläret "Personer med behörighet" säger fortfarande om ett konto med adressen saknas (inte ändrat här).
