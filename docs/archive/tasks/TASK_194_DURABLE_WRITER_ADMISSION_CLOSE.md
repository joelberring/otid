# TASK194: beständig stängning av writer-insläpp

Status: avgränsat kodsteg klart 2026-09-27 under TASK180; inte ett tekniskt
skrivstopp eller backupkvitto.

## Avgränsat utfall

En betrodd root-process på den valda Linuxinstallationen ska kunna skapa
exakt `/var/lib/o-tid/controller/closed` som beständig spärr **innan** den
försöker dränera writers. Katalogen finns redan, är en verklig root-ägd
katalogkedja utan grupp-/världsskrivrätt och tillhör inte `otid-writer`.
Markören är en tom root-ägd 0600-fil: dess **existens**, inte innehållet,
stänger HTTP- och startgrindarna. Skapandet får inte skriva över befintlig
fil, symlänk eller katalog. Fil och föräldrakatalog synkas före kvittens.
Ett andra anrop synkar en giltig befintlig markör och kan svara att insläppet
redan var stängt. Fel lämnar en eventuell markör kvar och får aldrig svara
att backup är säker. Ingen automatisk återöppning, unit-stop, sessionskontroll
eller `writeStopConfirmed` införs i detta snitt.

## Nästa beroende

Efter beständig markör måste en framtida controller observera/dränera hela
pågående webb-/CLI-/objektoperationer, hindra oinventerad writerstart och
verifiera noll writerprocesser och writer-DB-sessioner. Ett enkelt
`systemctl stop` kan avbryta ett HTTP- eller MinIO-steg och är därför inte
ensamt ett dräneringsbevis. Release kräver ett separat accepterat beslut och
får inte ske i `finally`. `systemd-v1` får inte aktiveras genom detta arbete.

## Riktad kontroll

Prova den rena filoperationen i en egen temporär katalog med injicerad
testägare: ny 0600-markör, idempotent andra stängning, avslag vid osäker
katalog/symlänk. Kör Node-test och ESLint, inte hela appsviten. Själva
root-/Linuxgrinden och `fsync`-/kraschbeteendet måste senare accepteras på
faktisk Linuxfilsystem och med installerade enheter. Ingen databas, verklig
tävling, objektlagring eller hemlighet berörs här.

## Leverans och faktiskt resultat

`ops/systemd/close-writer-admission.mjs` har en enda produktionsväg: Linux,
root, inga argument och den fasta markörsökvägen. Föräldrakatalogen måste
finnas och hela kedjan vara verklig, root-ägd och inte grupp-/världsskrivbar.
Markören skapas med `O_EXCL|O_NOFOLLOW`, 0600 och noll bytes. Den befintliga
markören godtas bara om den är en oförändrad reguljär, tom 0600-fil med rätt
ägare och en länk. Fil och katalog får `fsync` innan kommandot kan svara
`WRITER_ADMISSION_CLOSED_ONLY; NOT_DRAINED`. Fel rensar inte markören.

På denna Mac provades filkärnan i egen temporär katalog med testägare. Node-
start-/inventerings-/markörprov: **8/8 passerade, exit 0**. Riktad ESLint
och `node --check` för de två nya `.mjs`-filerna: **exit 0**. Den verkliga
CLI-grinden nekade väntat macOS med **exit 1** och texten `NOT_DRAINED`.
Ingen TypeScript- eller appbuild berörs av detta `.mjs`-/dokumentsnitt.

Kvarstående antaganden: den valda Linuxmiljön erbjuder beständig fil- och
katalogsynk med avsedd kraschsemantik, en installerare provisionerar den
root-ägda katalogkedjan, och samma exakta markör är konfigurerad i webb och
alla tillåtna writer-enheter. Faktisk Linux-/systemd-/DB-/objektdränering
är inte provad och inget tekniskt stoppbevis finns.
