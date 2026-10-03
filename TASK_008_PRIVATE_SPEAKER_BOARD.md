# TASK 008 – Privat speaker, senaste resultatunderlag

Status: klart som avgränsat mjukvarusnitt 2026-09-06; ADR, strikt kontrakt, skyddad serverläsning och
betrodd behörighets-CLI, skyddade HTTP-routes och mobilvy finns. Ett genomgående
HTTP/PostgreSQL/browserprov och riktade sessions-/flikprov passerar.
Verklig navigation/back passerar även med standalone/HTTPS och ny
serverautentisering; Chromium väljer ny laddning på grund av no-store.
ADR-0060 bevarar integritetspolicyn och redovisar äkta bfcache som overifierad
kompatibilitetsgren, inte ett krav att browsern cachelagrar sidan. Riktiga
PostgreSQL-prov täcker nu även historikgränsen och historisk klass/aktuella
visningsnamn. Samlad slutregression och kravvis evidens finns i
docs/task-008-acceptance.md. Detta avslutar inte hela speakerläget eller V1.

## Vertikalt användarflöde

En speaker loggar in för ett enda lopp och ser de 25 deltagare vars senaste
publicerade resultatrevisioner är senast registrerade på servern. Varje rad
visar aktuellt effektivt resultat efter befintliga manuella beslut, inte bara
den senaste tekniska kortbedömningen. Automatisk uppdatering och tydligt
daterat/offline underlag gör vyn användbar vid mål. Detta är första delen av
CODEX_BRIEF:s speakerläge, inte hela dess funktionslista.

## Berörda gränser

- `packages/contracts`: strikt minimerat, versionsmärkt svar och login.
- `packages/database`: additiv capabilitymigration med restore-not.
- `packages/application`: separat read-only use case, befintlig central
  resultatresolver och befintlig credentialpolicy.
- `apps/web`: privat HTTP/session, persondatafritt shell, svensk mobilvy.
- `scripts`: befintlig betrodd credential-CLI känner den nya capabilityn.
- Tillhörande enhets-, PostgreSQL-, HTTP- och browsertester samt dokument.

Ingen resultatregel flyttas till SQL/React. Inga nya dependencies, externa
anrop, rådatamutationer, Eventornycklar eller AGPL-källor behövs. Se ADR-0058.

## Acceptans

1. Endast exakt `VIEW_SPEAKER_BOARD` för rätt race fungerar. Fel capability,
   race, utgång, logout och revocation avvisas, även i konkurrens med läsning.
   GET är skrivfri inklusive audit och visar inga persondata före auth.
2. Välj senaste publicerade revision per entry före sortering och limit 25.
   Nyare opublicerad revision skymmer inte den publicerade. Lika createdAt
   har deterministisk UUID-ordning. Samma ingestretry skapar ingen ny rad.
3. Befintlig central resolver används för DSQ, approval, DNF, OOC, NT och
   DNS-withdrawal inklusive avpricknings-DNS. Sen teknisk OK får inte ersätta
   aktivt manuellt beslut i vyn. Återtaget DNS visas utan aktivt resultat och
   utan historisk fallback. Korrupt provenans ger fel, inte partiell lista.
   Historikgränsen 1 000 beslut över valda entries prövas vid gräns/overflow.
   Withdrawal ändrar synligt resultat även med oförändrad raceSnapshotVersion.
4. NT/DNS/DNF och NO_ACTIVE_RESULT visar inga tider. Ingen rå korttid får
   kringgå effektivt NT. Revisionens historiska klassidentitet används, men
   namn/klubb/klassnamn är uttryckligen aktuella visningsuppgifter.
5. Strict svar avvisar extra fält, dubbla/icke sammanhängande slots och overflow.
   Application avvisar dubbla entry-id:n före minimering; lika namn är tillåtna.
   Ingen bricka,
   entry-/readout-/resultat-UUID, rådata, full evaluation, splits, actor,
   session, hemlighet eller hash lämnas ut. Ingen ranking av bara 25 rader.
6. Browser: login, tomt lopp, ny publicerad revision, automatisk uppdatering,
   nätfel/stale-varning, återanslutning, authfel, lokal logout, sent svar efter
   logout och smal mobilskärm. No-store och inget Web Storage/appcache.
7. Lint, typecheck, test, PostgreSQL-integration, relevant browserprov och
   build körs; exakta utfall dokumenteras innan snittet kallas klart.

## Utanför detta snitt och kvar i huvudmålet

Klassvis ställning/tidsdifferenser, komplett händelsehistorik/SSE, bevakade
löpare, privata anteckningar och storbild återstår inom speakerutvecklingen.
Radiopasseringar kräver separat datakälla; GPS, stafett och riktig USB byggs
inte här. Produktionslast, fysisk mobil och hårdvarufältprov är inte bevisade
av syntetiska browserprov. Privat tävling eller manuell demo migreras inte
automatiskt av utvecklingsarbetet.
