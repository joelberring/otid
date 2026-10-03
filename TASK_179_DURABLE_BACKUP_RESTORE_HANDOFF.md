# TASK179: privat beständig överlämning från kvitterad backup till senare restore

Status: **syntetiskt verifierad 2026-09-23**, inte en operativ backup/restore.
Beslutet om privat completion-underlag togs i
[ADR-0159](docs/adr/ADR-0159-operational-backup-phase-ownership-and-receipt.md)
före kod. Detta är D1b.4f efter
[TASK178](TASK_178_RECEIPTED_BACKUP_RESTORE_COMPOSITION.md).

## Operatörsutfall

En färdig och slutverifierad syntetisk backup ska kunna väljas med backup-id
**efter att captureprocessen har avslutats**. En separat process återöppnar
endast dess exakta privata manifest, dump och bundna MinIO-mål, återställer
till en ny tom PostgreSQL17/PostGIS-databas och kör befintlig läsande
restoreverifiering. Felaktig, saknad eller manipulerad överlämning ger inget
godkänt restorepåstående. Detta är ännu inte en produktions-CLI.

## Avgränsning och ordning

1. Besluta först i ADR hur ett privat immutable completion-underlag skrivs
   **efter** TASK177:s final proof. Hemlighetsfri kvittens får inte ersätta
   manifestet; privata PM-nycklar, dumpväg och målbindning får inte läcka i
   kvittens, logg eller publik API-respons.
2. Skriv atomiskt i en uttryckligen vald privat katalog med strikt ägare,
   0700/0600, backup-id/hashbindning och hållbarhets-/återstartssemantik.
   En halvskriven artefakt får aldrig bli valbar. Avvisa symlink, hardlink,
   fel mode/ägare, dubblett-id, korruption och hashmismatch.
3. I en **ny process**: öppna och validera completion-underlaget och samma
   privata state, dump och målbindning. Bekräfta fortsatt läsbar exakt
   historisk PM-version; återställ bara till ett nytt tomt explicit mål.
   Återanvänd TASK178:s verifieringsordning och bevara `storeId`/`versionId`.
4. Ett smalt tvåprocessprov med enbart syntetiska data ska visa att den
   separata restoreprocessen lyckas efter captureprocessens exit. Negativa
   prov gäller saknat/ändrat underlag och icke-tomt mål. Kör riktad lint,
   typecheck, tester och build; redovisa exakta utfall.

## Ingår inte

Tekniskt serveromfattande skrivstopp, exklusivt produktionsägande av MinIO-
regler, automatisk backupplanering, publik filnedladdning, fler stores,
driftcredentials, verklig tävling, färdig operatörs-CLI, writer-release,
TLS/internet- eller fysisk stationsacceptans. TASK179 får inte påstå att
syntetisk tvåprocessrestore gör D1b.4 operativt klar.

## Verifierat utfall

Den privata write-once-completionfilen skapas först efter TASK177:s slutbevis.
En ny process återläser fil, `CLEANUP_VERIFIED`, målbindning och dumpbytes,
öppnar samma pinnade privata MinIO-mål utan ny replikeringsregel och återställer
enbart till en ny tom PostgreSQL17/PostGIS-databas. Den befintliga läsande
verifieraren kräver exakt historisk PM-version och bevarad DB-historik.
Saknat, ändrat eller felaktigt länkat completion-underlag avvisas.

Riktade infrastructure-tester: **2 filer, 6 passerade, 2 opt-in överhoppade,
exit 0**. Infrastructure lint, typecheck och build: **exit 0 vardera**.
Separat full opt-in med två processer, två nya isolerade databaser och
hashpinnad MinIO/`mc`: **exit 0**. Oberoende kontroll i både källa och mål
gav `1|1|1|1|1` för event, anmälan, PM-manifest, resultatrevision och
finalisering. Den fulla opt-in-körningen prövade det som de överhoppade
MinIO-enhetstesterna inte körde som standard.

Efter kontroll av ägare och noll anslutningar togs de tio exakt identifierade
syntetiska testdatabaserna från fem försök bort; borttagningen är permanent.
Privata artefakter från misslyckade försök bevarades för felsökning. Ingen
verklig tävling, Eventortrafik eller produktionscredential användes.
