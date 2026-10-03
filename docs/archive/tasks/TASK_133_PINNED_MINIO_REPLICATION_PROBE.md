# TASK133: isolerat kompatibilitetsprov för pinnad MinIO-replikering

## Status

Klar. ADR-0138 beslutades före produktkod.

## Mål

Fastställ om server-till-server bucket-replikering i O-Tids exakt pinnade
MinIO-release kan bevara de `versionId` som den befintliga PM-läsaren behöver
för en framtida verifierad restore.

## Avgränsning

Ingår:

- två nystartade, privata, syntetiska loopbackinstanser av
  `minio/minio:RELEASE.2025-07-23T15-54-02Z` eller binären med samma verifierade
  release;
- två tomma versionerade testbuckets, två historiska versioner av en syntetisk
  PM-nyckel, uttrycklig server-till-server bucket-replikering och en aktiv
  resync av just den genererade target-ARN:en;
- kontroll av source- och target-`versionId`, bytehash och längd genom den
  befintliga PM-objektläsaren;
- ett litet opt-in-test som fail-closed vid fel version, bara senaste version,
  timeout eller avvikande objektbyte.

Ingår inte: ändring av `docker-compose.yml`, driftreplika, användardata,
databasdump, PM-export, objektrestore, backup-CLI, nya databasreferenser,
Eventor, karta/rutt, GPS, stafett, SPORTident eller USB.

## Acceptans

1. Testet vägrar starta om serverreleasen inte exakt matchar O-Tids pinnade
   `RELEASE.2025-07-23T15-54-02Z`; en aktuell/latest binär är inte tillåten
   som substitut.
2. Källa och mål är nya, separata och tomma loopbackmiljöer med versionering
   aktiv före källskrivning och före replikeringskonfiguration.
3. Källan har två olika historiska versioner av samma PM-objektnyckel. Efter
   explicit existerande-objekt-resync kan målet läsa båda med källans identiska
   `versionId`, SHA-256 och storlek via `createPmObjectStore(...).read(...)`.
4. Testet avvisar en målversion med rätt bytes men fel `versionId`, en saknad
   versionsheader, en target som redan innehåller data och en synk som bara
   överför senaste versionen.
5. Inga credentials hamnar i argument, repo, logg eller testoutput; endast
   privata temporära kataloger får innehålla syntetiska credentialvärden.
6. En grön körning påstår enbart kompatibilitet för det begränsade testet.
   TASK099 är fortfarande ofullständig tills ett senare ADR och en komplett
   skrivstoppad backup/restore-kedja finns.

## Proportionell verifiering

När det pinnade testunderlaget finns lokalt ska ett enda opt-in-runnerprov
starta båda instanserna, köra scenariot och lämna privat logg/data efter
fel. Den återanvänder `packages/infrastructure` befintliga PM-läsare i stället
för en testdubbel. Berörd infrastructure lint och typecheck körs därefter.

Provet körs aldrig mot den vanliga compose-miljön, demo-/testdatabas,
arrangörsdata, riktig credential eller extern MinIO. Saknas exakt binär/image
är korrekt resultat en dokumenterad spärr, inte ett försök med en annan
release.

## Kvarvarande antaganden

- AIStor-dokumentationens versionssemantik kan avvika från den pinnade
  OSS-releasen; just därför är detta ett prov och inte en vald driftlösning.
- Den pinnde serverbinären och en lämplig `mc`-klient behöver finnas i en
  privat testmiljö innan scenariot kan köras.
- En positiv syntetisk synk bevisar inte säkert en framtida full backup eller
  återställning av PostgreSQL/PostGIS.

## Resultat

Den 2026-09-22 passerade ett verkligt men helt isolerat macOS arm64-prov:

```bash
CI=true pnpm --filter @o-tid/infrastructure exec tsx test/run-minio-replication.ts /private/path/minio /private/path/mc
```

Runnen verifierade MinIO-serverns pinnade SHA-256
`0939ce5553ce9e6451b69e049fbf399794368276b61da8166f84cbd8c7f2d641` och
den pinnade mc-klientens SHA-256
`f72ab39389f6b8ac7369fa1894b62f34a9eca230c339c0b3128a7e45ecfcf139` innan
den startade två nya privata loopbackservrar. Källan skrev två olika syntetiska
PM-versioner under samma nyckel före regeln. Runnern skapade regeln med
`existing-objects`, läste den privata target-ARN:en utan konsolutskrift,
startade aktiv resync och lät den befintliga `createPmObjectStore(...).read`
läsa båda objektens oförändrade käll-`versionId`, hash och längd i målet.
Exitkod 0. Infrastructure lint och typecheck passerade med exitkod 0;
enhetssviten passerade 11 testfiler/412 tester och package build passerade med
exitkod 0.

En tidigare passiv väntan efter att regeln skapats lämnade mål-bucketen tom
inom 20 sekunder. Den räknas inte som positiv restoreväg; den dokumenterade
aktiva resync-vägen ovan är vad det godkända provet använder. Ingen compose,
databas, användar- eller tävlingsdata, riktig credential eller objektstore i
drift berördes. TASK099 är fortfarande inte en komplett backup/restore och
behöver ett senare separat drift-ADR före skrivande implementation.

Den vanliga enhetssviten avvisades först i den begränsade sandlådan med 72
`EPERM` när befintliga tester skulle binda egna loopback-/Unix-sockets. Samma
helt syntetiska testsuite kördes sedan i den tillåtna lokala miljön och
passerade 412/412; det var en testmiljöbegränsning, inte ett kodfel.
