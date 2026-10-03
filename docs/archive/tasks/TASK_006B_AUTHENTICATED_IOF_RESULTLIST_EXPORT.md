# TASK 006B – autentiserad IOF ResultList-export

## Mål

Ge en arrangör en separat, racebunden och skrivfri export av dagens senast
publicerade individuella resultat som ett deterministiskt IOF XML 3.0
`ResultList`-dokument.

Snittet omfattar en egen `EXPORT_IOF_RESULT_LIST`-capability, ett privat
webbshell och en download-route. Det inför ingen Eventor-klient, slutresultat-
markering, manuell statusadministration, arkivfunktion eller resultatmutation.

## Arkitektur- och licensbeslut före implementation

- ADR-0026 låser capabilityseparation, publiceringsurval, historisk resultatbas,
  single-race-gräns, determinism och IOF-subset.
- IOF:s officiella Data Standard 3.0-schema används endast som faktakälla och
  vendlas inte eftersom repositoryt saknar ett uttryckligt licensbeslut.
- Ingen kod, struktur eller fixture kopieras från MeOS, Oxygen eller andra
  externa tävlingssystem.
- Ingen konflikt finns med `CODEX_BRIEF.md`, arkitekturen eller domänreglerna.

## Berörda paket

- `packages/contracts`: strikt login- och exportmetadata.
- `packages/iof-xml`: ren, deterministisk ResultList-serializer.
- `packages/database`: additiv capability och livstidscheck.
- `packages/application`: racebunden repeatable-read-projektion.
- `apps/web`: eget svenskt login-/downloadflöde och privata headers.
- `scripts`, `fixtures`, `tests` och `docs`: provisioning, regression och status.

Ingen exporttabell, requestjournal eller ny runtime-dependency tillkommer.

## Auktoritativ projektion

1. Exporten väljer högsta `revision` med `published = true` per entry. En
   senare opublicerad revision får inte skymma den senaste publicerade.
2. Revisionens lagrade `evaluation.classId`, `courseVersionId`, tider, status
   och splits är resultatets historiska grund. Entryts aktuella klass eller
   klassens aktuella bana får inte skrivas över på revisionen vid export.
3. En publicerad revision vars `snapshotVersion` är äldre än loppets aktuella
   snapshot ingår. `published` är modellens publiceringsbeslut; en global
   snapshotändring bevisar inte att just resultatet är fel. Antalet sådana
   revisioner redovisas som varning.
4. Namn och organisation hämtas från aktuell entry eftersom historiska
   namnsnapshot saknas. Detta är visningsdata, inte historisk identitet.
5. Entries utan publicerad revision och okända brickor utelämnas. De får inte
   fabriceras som DNS.
6. Event som har fler än ett internt race avvisas tills en verklig IOF-
   raceordinal finns lagrad. `raceNumber=1` får inte hittas på.
7. Högst 1 000 klasser, 10 000 resultat och 256 förväntade bansplits per
   resultat materialiseras. Överskridande eller motsägande lagrad data ger
   fail-closed fel utan partiell XML.

## Stött IOF-subset

- Rot: `ResultList`, IOF 3.0-namnrymd, `iofVersion="3.0"`, stabil creator och
  alltid `status="Snapshot"`. Volatil `createTime` utelämnas.
- Event: namn, men inget internt UUID som extern identitet.
- Klass: namn och endast IOF-importerad `Class.Id` när sådan finns.
- PersonResult: endast IOF-importerad `EntryId` när sådan finns, personnamn,
  valfri organisation och exakt ett race-resultat.
- Status: intern `OK` blir IOF `OK`; intern `MP` blir `MissingPunch`.
  `UNKNOWN_CARD` saknar resultatrevision och exporteras inte.
- Start-/måltid skrivs som normaliserad UTC ISO 8601. Total- och splittider
  skrivs som exakta decimalsekunder från heltalsmillisekunder.
- Varje kontroll i revisionens immutable course-version skrivs i banordning.
  Matchning sker på `(controlCode, occurrence)`: träff blir `OK` med kumulativ
  tid, saknad blir `Missing` utan tid. Start och mål blir aldrig SplitTime.
- Extra stämplingar exporteras inte i detta snitt eftersom deras tider inte
  bevaras och de inte är del av den historiska bansekvensen.
- Position och TimeBehind utelämnas. Ranking/tie-regler finns ännu inte som
  auktoritativ domänlogik och får inte uppfinnas i adaptern.
- Interna UUID:n, bricknummer, raw/readout, audit, auth, importoriginal,
  extensions, rutter, GPS, kontaktuppgifter och opublicerade data ingår aldrig.

Serializeraren avvisar ogiltiga XML 1.0-kodpunkter och oparade surrogat, escaper
all text/attribut, använder fast element-/attributordning, UTF-8, LF och en
avslutande newline. Samma projektion ger identiska bytes och SHA-256/ETag.

## Säkerhet och HTTP

- `EXPORT_IOF_RESULT_LIST` har eget credentialprefix, högst 8 h access och
  högst 1 h session samt egna host-only cookies.
- Varje GET kör i `REPEATABLE READ` och låser session SHARE → credential SHARE
  → race SHARE före den explicita projektionen.
- GET är skrivfri och skapar ingen audit, requestjournal eller exportfilrad.
- Login/logout behåller befintlig Origin-/CSRF-policy; download-GET kräver
  session men ingen CSRF.
- 200 svarar `application/xml; charset=utf-8`, säker attachment-fil,
  `private, no-store`, `nosniff`, restriktiv CSP/referrer-policy, exakt längd
  och SHA-256-baserad ETag. Fel är privata och detaljfria.
- Browsern håller credential och exportbytes endast i minnet, använder ingen
  URL-hemlighet eller Web Storage och rensar object URL efter download.

## Migration och återställning

Migration 0012 lägger additivt till capabilityn `EXPORT_IOF_RESULT_LIST` och
en åttatimmarscheck. Inga resultat- eller domänrader skrivs om.

Enumvärdet tas inte bort destruktivt. Vid incident inaktiveras route/CLI,
berörda credentials spärras och rättelse sker framåt; full återställning sker
från verifierad backup.

## Acceptans

- Rätt capability för rätt race laddar ner ett schemaenligt avgränsat,
  deterministiskt `Snapshot`; annan capability/race, expiry och revocation
  avvisas före privat projektion.
- Senaste publicerade revision väljs, historisk klass/bana bevaras och nyare
  opublicerad revision läcker inte.
- OK/MP, fasta/punchstarter, upprepade och saknade kontroller, XML-escaping och
  millisekunder serialiseras deterministiskt; korrupt lagrad evaluation avvisas.
- Samtidig ingest ger ett helt före- eller efterläge. Hundra läsningar utan
  writer ger identiska bytes/hash och noll writes.
- Downloadflödet verifierar filnamn, headers, metadata, bytes och att interna
  UUID:n, rådata, authdata och opublicerade fakta saknas.
- Befintlig import, resultatrevision, historik, station, ingest och publikvy
  regresserar inte.

## Utanför snittet

- Eventor-HTTP/API-nycklar och uppladdning,
- komplett arkiv, objektlagring eller signerad export,
- `Complete`-slutresultat, DNS/DNF/DSQ och manuell resultatstatus,
- ranking/placering, flerdagars, flera race, stafett och lag,
- extra-stämplingstider, GPS/rutter/kartor,
- SPORTident-protokoll eller riktig USB.
