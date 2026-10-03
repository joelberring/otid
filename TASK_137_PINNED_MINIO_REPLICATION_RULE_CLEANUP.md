# TASK137: pinnad MinIO-regelrensning efter versionsbevarande resync

## Status

Syntetiskt kompatibilitetsverifierad 2026-09-23. ADR-0140 är accepterad före
kod. Den pinnade opt-in-runnern har passerat med två nya privata MinIO-
loopbackinstanser; ingen backup-/restoreadapter eller verklig driftmiljö är
ändrad.

## Mål

Visa i samma helt isolerade, pinnade MinIO-/mc-miljö som TASK133 att en
temporär `existing-objects`-regel kan tas bort efter en lyckad aktiv resync
utan att de redan replikerade historiska PM-versionerna försvinner.

## Avgränsning

- Utöka endast den befintliga privata `run-minio-replication.ts`-runnern.
- Källa och mål är nya loopbackinstanser med syntetiska credentials och tomma,
  versionerade buckets; källbucketens första regelkonfiguration måste bevisas tom.
- Efter samma två historiska PM-versioner, aktiva resync och vanliga PM-läsare
  rensas alla regler i just den testbucket som tillhör källan med den pinnade
  `mc`-klienten. En privat SDK-efterkontroll måste därefter bevisa tom
  regelkonfiguration.
- Den vanliga PM-läsaren läser därefter båda historiska målversionerna igen
  med oförändrat `versionId`, hash och längd.

Ingår inte: databas, dump, restore, manifestskrivning, CLI, verklig
credential, Compose, målmiljö för användardata, GPS, stafett, SPORTident eller
USB.

## Acceptans

1. Runnern avvisar fel server-/mc-hash, befintlig källregel, icke-tomt mål,
   misslyckad resync och fel version-ID som i TASK133.
2. Regelrensningen lyckas enbart när den följande privata SDK-kontrollen
   bevisar tom regelkonfiguration; ett kommandoexit utan postvillkor godkänns inte.
3. Regelrensning får inte radera redan replikerade objekt: båda exakta
   historiska versionerna är fortsatt läsbara via `createPmObjectStore`.
4. Ingen credential går till argv, repository eller konsol. Den target-ARN som
   den äldre pinnade `mc`-klienten kräver för resync går endast som privat
   child-arg och skrivs aldrig till konsol, repository eller testresultat.
   Loggar och processkonfiguration är privata.

## Proportionell verifiering

Det enda funktionsprovet är den befintliga opt-in-runnern mot de tidigare
hashpinnade privata MinIO- och mc-binärerna. Infrastructure lint och typecheck
körs före den. En grön körning bevisar enbart exakt regelrensning för denna
pinnade kombination; den gör inte TASK099 till en backup eller restore.

```bash
CI=true pnpm --filter @o-tid/infrastructure lint
CI=true pnpm --filter @o-tid/infrastructure typecheck
CI=true pnpm --filter @o-tid/infrastructure exec tsx test/run-minio-replication.ts /private/path/minio /private/path/mc
```

## Kvarvarande antaganden

TASK099:s framtida privata adapter behöver fortsatt hålla en 0600
operation-state-fil och en separat privat `storeId` → källa/mål-konfiguration
för att kunna rensa säkert efter ett processavbrott. TASK137 provar enbart
kommandosemantiken, inte den adapterkedjan.

## Genomfört hittills

`packages/infrastructure/test/run-minio-replication.ts` kräver nu bevisat tom
källregelkonfiguration före start, rensar testbucketens regler efter att båda
historiska versionerna verifierats, kräver tom SDK-efterkontroll och läser båda
versionerna genom den vanliga PM-läsaren igen. Den pinnade `mc`-versionens
regel-listning returnerade felkod för en tom konfiguration; därför verifieras
tomhet före/efter via MinIO-SDK och endast dess exakta
`ReplicationConfigurationNotFoundError` godtas. Andra fel avvisas utan att
endpoint eller credential skrivs i konsolen.

2026-09-23 hämtades de officiella arkiven till en privat temporär katalog.
MinIO `RELEASE.2025-07-23T15-54-02Z` och `mc`
`RELEASE.2025-07-21T05-28-08Z` matchade runnerns redan pinnade SHA-256 före
körning. `CI=true pnpm --filter @o-tid/infrastructure lint`, `typecheck` och
`build` gav alla exit 0 efter patchen. Den enda opt-in-runnern gav exit 0:
två syntetiska historiska PM-versioner var exakt läsbara efter resync och
regelrensning. Detta är fortfarande inte ett samordnat backup-/restorebevis;
TASK170 är nästa avgränsade sammansättning med PostgreSQL.
