# TASK140: privat, atomär backup-operation-statusfil

Status: slutförd och riktat verifierad 2026-09-22.

## Syfte

Ge TASK139:s redan strikta recoverystatus en faktisk, privat och beständig
filadapter så att en avbruten backup lämnar ett läsbart cleanupunderlag utan
credentials eller driftendpointar.

## Arkitekturbeslut

Ingen ny ADR behövs. Detta är den 0600-fil som ADR-0140 redan kräver. Den
är en lokal infrastructure-adapter till TASK139:s port, inte en MinIO-adapter:
TASK137:s exakta pinnade regelrensningsprov måste fortfarande passera innan
kod anropar `mc` eller replikering i drift.

## Avgränsning

- En explicit, befintlig privat katalog utanför repositoryt måste vara ägd av
  aktuell UID, canonical, utan symlänk och med exakt mode 0700.
- Första `DUMP_PENDING` skapar exklusivt en 0600 JSON-fil per canonicalt
  backup-id. Senare monotona TASK139-faser ersätter bara den fil som samma
  recorder själv reserverat; de skrivs till ny 0600 tempfil, `fsync`:as och
  byts atomärt.
- Läsaren accepterar endast samma private filform: regular file, UID, nlink 1,
  mode 0600, bounded UTF-8/JSON och strikt state med rätt backup-id.
- Alla adapterfel är generiska och exponerar varken sökväg, filinnehåll,
  endpoint, credential, target-ARN eller statevärden.
- En lyckad `CLEANUP_VERIFIED`-status behålls som privat historik. Detta snitt
  bygger inte en recovery-writer som kör cleanup efter en krasch.

## Acceptans

1. En `DUMP_PENDING`-status kan skapas exklusivt en gång i korrekt privat
   katalog, med exakt 0600 och canonicala bytes.
2. En och samma recorder accepterar endast samma backup-id och direkt
   monotona faser till `CLEANUP_VERIFIED`; fel ordning eller annan backup-id
   ändrar ingen fil.
3. Varje godkänd ändring är atomär och fil/katalog är synkad innan kvittens.
4. Läsning av saknad fil ger inget state; symlink, fel ägare/mode, hardlink,
   fel backup-id, överstor eller korrupt fil ger bara generiskt fel.
5. Inget verkligt backupsteg, MinIO, `mc`, dump, databas, CLI eller credential
   används eller läggs i filen.

## Proportionell verifiering

- Ett infrastructureprov skapar endast egna kortlivade 0700-kataloger och
  syntetiska UUID-/hashvärden. Det testar creation, monotona atomära
  uppdateringar/läsning och de centrala osäkra filfallen.
- Infrastructure lint, typecheck, det riktade testet och build körs med
  `CI=true`.

## Utanför uppgiften

Ingen recovery-CLI, filradering, stateändring från en ny process, MinIO-regel,
privat source/target-konfiguration, dump, restore eller fältacceptans ingår.

## Utfört 2026-09-22

`packages/infrastructure` innehåller nu en state-recorder för exakt en
backupkörning och en separat läsare. Den kräver en befintlig, canonical,
repositoryextern katalog med UID-ägarskap och mode 0700. Första
`DUMP_PENDING` reserverar exklusivt `<backup-id>.json`; varje nästa direkta
fas skrivs till en ny 0600-tempfil, synkas, byts atomärt och läses tillbaka
med samma stricta kontrakt. `CLEANUP_VERIFIED` tas inte bort.

Läsaren avvisar symlänkar, fel katalogmode/UID, fel filmode, hardlinks,
överstor eller korrupt JSON samt fel backup-id med en enda generisk felkod.
Statefilen innehåller bara TASK139:s validerade fält och inga endpointar,
credentials, target-ARN:er eller objektnycklar.

Riktad verifiering:

- `CI=true pnpm --filter @o-tid/infrastructure exec vitest run
  test/operational-backup-operation-state.test.ts
  test/operational-backup-manifest.test.ts
  test/operational-backup-object.test.ts`: exit 0, 3 filer / 10 tester.
- `CI=true pnpm --filter @o-tid/infrastructure lint`, `typecheck` och `build`:
  samtliga exit 0.

Proven skapade och tog bort endast egna kortlivade kataloger under
`/private/tmp`. Ingen adapter har anropats från driftkod ännu, och ingen
databas, dump, MinIO, `mc`, credential eller tävlingsdata användes.
