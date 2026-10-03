# TASK214: icke aktiverande installation av systemd-v1-writerprofilen

Status: **installerarkod förberedd och syntetiskt verifierad; ingen Linux-/systemd-acceptans**.

Detta snitt installerar endast de tre redan granskade mallarna för `otid-web`,
`otid-db-migrate` och `otid-speaker-revoke` till deras fasta namn under
`/etc/systemd/system`. Kommandot anropar aldrig `systemctl` eller annan
processhantering: ingen daemon reloadas och ingen unit aktiveras, startas,
stoppas eller restartas. Den redan stängda markören lämnas orörd.

Installationen kräver Linux, effektiv UID 0 och exakt bekräftelse
`--confirm install-closed-systemd-v1-writer-profile`. Den kräver också den
icke-rootägda identiteten `otid-writer`, rootägda källvägar under `/opt/o-tid`, en
redan befintlig rootägd tom 0600-markör på
`/var/lib/o-tid/controller/closed`, samtliga rootägda privata credential- och
requestfiler samt en rootägd `/etc/o-tid/writer-config`. Credentialfilerna
kontrolleras endast med metadata; deras innehåll läses eller loggas inte.
Konfigurationsfilen läses eftersom den inte får innehålla hemligheter och
valideras mot en fast lista av kart-/ruttstoremetadata och publik origin.
Samtliga elva tillåtna nycklar krävs: kanoniska HTTPS-origins för de två
objektlagren och webben, UUID för store-ID, begränsade bucket-/regionnamn
och `production` som store-läge. Exempelvis `NODE_OPTIONS`, okända nycklar,
dubbletter, quoting, whitespace och extra systemd-/shellsyntax avvisas.
De tre utpekade release-startfilerna måste finnas som rootägda, ej
grupp-/världsskrivbara reguljära filer; detta bevisar inte hela releasens
innehåll eller binärproveniens.

Profiler med andra `otid-`-units/drop-ins, kvarlämnade temporära filer, saknade units i en delinstallation
eller en ändrad befintlig unit avvisas. En redan komplett byte-identisk profil
är idempotent. En helt tom profil installeras fil för fil med exklusiv
temporär fil, filsynk, exklusiv hårdlänk till det fasta målet och katalogsynk.
Tre filer kan inte publiceras atomiskt som grupp. Om ett senare filsteg
misslyckas lämnas den synliga delinstallationen stängd för manuell granskning;
scriptet försöker inte en osäker rollback eller öppning. Nästa körning avvisar
det partiella läget. Markörens identitet och stängda metadata kontrolleras
före och efter varje filsteg, men kontrollen låser inte en extern root-
controller; ändras markören samtidigt avbryts installern och operatören måste
granska både markör och installationsrester. Utfallstexten säger endast att
installern **inte utförde aktiveringsåtgärder**; den påstår inte att redan
installerade enheter är inaktiva.

Kodtestet använder endast injicerad syntetisk filsystems- och
identitetsmetadata. Installern har inte körts på denna värd. Ett framtida
Linuxprov måste fortfarande verifiera verkliga filsystem-/systemd-semantik,
`systemd-analyze verify`, laddad unitkonfiguration, aliases/transient units,
credentialisolering, DB-/MinIO-principaler och TASK180:s dränerings- och
sessionskrav. TASK213:s bytepreflight är fortfarande bara en läsande
ögonblicksbild. Varken installation eller preflight är ett tekniskt
skrivstopp, backupbevis eller `writeStopConfirmed`.

Riktad lokal kontroll:

```bash
node --test ops/systemd/install-writer-profile.test.mjs
CI=true pnpm exec eslint ops/systemd/install-writer-profile.mjs ops/systemd/install-writer-profile.test.mjs
node --check ops/systemd/install-writer-profile.mjs
node --check ops/systemd/install-writer-profile.test.mjs
```

Utfall 2026-09-27: Node-test **6/6**, båda `node --check` och riktad ESLint
gav **exit 0**. Ingen installerarkörning, systemd-kontroll eller verklig
credentialläsning gjordes. Typecheck och build är inte tillämpliga på detta
fristående `.mjs`-/dokumentationssnitt.
