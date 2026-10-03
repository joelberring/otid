# TASK134: läsande källpreflight för operativ backup

## Status

Klar 2026-09-22. ADR-0115 täcker detta läsande snitt; ingen ny
driftmekanism, writer eller ytterligare ADR har valts här.

## Mål

En betrodd operatörskomponent kan, efter en uttrycklig skrivstoppbekräftelse,
samla en enda skrivskyddad PostgreSQL-snapshot, verifiera varje exakt
manifestbunden PM-version via den vanliga PM-läsaren och skapa ett
canonicaliserat, hemlighetsfritt backupmanifest för ett redan existerande
PostgreSQL-dumpunderlag.

Detta bevisar att källans databasreferenser och PM-bytes går ihop vid
preflight-ögonblicket. Det skapar, kopierar, skriver eller återställer inte
någon dump eller något objekt.

## Avgränsning

Ingår:

- ett strikt input för `backupId`, `createdAt`, explicit
  `writeStopConfirmed: true` och ett redan framtaget dumpunderlags identitet,
  SHA-256 och längd;
- en `REPEATABLE READ, READ ONLY`-snapshot som läser faktisk
  migrationsidentitet och alla PM-manifestreferenser;
- en injicerad verifieringsport som för varje referens använder befintlig
  `readOperationalBackupPmObject`/`createPmObjectStore(...).read(...)` och
  därmed kontrollerar exakt `versionId`, hash och längd;
- ett redan befintligt canonicalt `operationalBackupManifest`, dess hash och
  en liten hemlighetsfri rapport med verifierat objektantal.

Ingår inte: `pg_dump`, dumpfilsläsning eller -skrivning, MinIO-resync,
bucketregel, objektkopiering, restore, CLI, cron, lagring av manifest,
produktcredentials, Eventor, karta/rutt, GPS, stafett, SPORTident eller USB.

## Arkitektur

Application äger den läsande samordningen och tar en smal PM-byteverifierare
som port. Infrastructure fortsätter äga den faktiska versionsbundna
objektläsningen och bytekontrollen; application får inte skapa en egen
MinIO-klient eller egen S3-fallback. Kontrakt äger input-/outputformen och
canonical normalisering; infrastructure ger en tunn adapter till den
befintliga PM-läsaren.

```
explicit skrivstopp + dumpidentitet
             |
             v
PostgreSQL RR/read-only --> migration + PM-referenser --> PM-byteverifierar
             |                                           |
             +---------------- canonicalt manifest <-----+
```

Ett läsande databasögonblick och efterföljande objektläsning räcker bara när
operatören faktiskt har stoppat writers. Komponenten kan bevisa att en sådan
bekräftelse saknas, men kan inte själv skapa ett globalt maintenance-läge.

## Acceptans

1. Avsaknad/felaktig skrivstoppbekräftelse, dumpidentitet, hash eller längd
   avvisas före databas- eller objektläsning.
2. Migrationsidentitet och PM-referenser hämtas i en enda `REPEATABLE READ,
   READ ONLY`-snapshot. Tom, ogiltig eller dubbel referensuppsättning avvisas.
3. Varje referens går genom den injicerade exakta byteverifieraren. Ett saknat
   objekt, fel `versionId`, hash/längd eller verifieringsfel avbryter utan
   manifestresultat.
4. Lyckat resultat innehåller endast canonicalt manifest, manifesthash och
   antal verifierade objekt — aldrig dumpbytes, PM-bytes, URL:er, credentials
   eller Eventor-/masterhemligheter.
5. Komponenten gör inga databas- eller objektwrites och ändrar inte
   TASK133:s testade replikeringsmekanism.

## Proportionell verifiering

- Kontraktstest för capture-intentens strikthet och hemlighetsfria form.
- Applicationtester för tidig avvisning, exakt ett verifieraranrop per
  stabilt sorterad PM-referens och avbrott vid fel.
- Isolerat PostgreSQL/PostGIS-test som kontrollerar den skrivskyddade
  snapshotens migrations-/PM-underlag; PM-byteverifieraren är en syntetisk
  port eftersom faktisk MinIO-kompatibilitet redan bevisas av TASK133.
- Berörd contracts/application/infrastructure lint, typecheck, riktade tester
  och builds. Ingen full restore eller ny omfattande e2e-svit.

## Resultat

- `operationalBackupCaptureIntentSchema` avvisar felaktigt skrivstopp och
  extra fält innan PostgreSQL eller PM-porten används.
- Application läser migration och PM-referenser i en enda skrivskyddad
  repeatable-read-transaktion, normaliserar manifestet och avbryter vid tom
  uppsättning eller första objektfel.
- Infrastructure-adaptern använder endast
  `readOperationalBackupPmObject`; den exponerar ingen endpoint eller
  skrivmetod.
- Riktad kontroll 2026-09-22: contracts 3/3, application 7/7 och
  infrastructure 6/6 tester passerade; lint, typecheck och build passerade
  för samtliga tre paket (exit 0).
- Ingen isolerad `TEST_DATABASE_URL` fanns tillgänglig, därför kördes inte
  den frivilliga PostgreSQL/PostGIS-acceptansen. Ingen okänd databas har
  kontaktats.

## Kvarvarande antaganden

- `writeStopConfirmed` är operatörens avsiktliga intygande, inte ett tekniskt
  globalt skrivlås.
- Dumpens bytes/hash produceras och verifieras i ett senare snitt; detta
  snitt validerar endast dess deklarerade identitet.
- En framgångsrik preflight väljer inte replikering som driftarkitektur och
  gör inte TASK099 till komplett backup/restore.
