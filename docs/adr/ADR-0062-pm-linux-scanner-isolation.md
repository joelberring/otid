# ADR-0062: Linux-isolering för PM-skannerns verktygsprocesser

- Datum: 2026-09-08
- Status: Accepterad design; runtime-/imagepinning och verklig acceptans återstår.
- Kompletterar ADR-0061, ändrar inte domängräns, kö, lagring eller resultatmotor.

## Beslut

Den betrodda workern orkestrerar ett separat kortlivat Linux/Docker-container-
försök per PM-skanning. Det är en isoleringsgräns inom befintlig worker, inte
en ny nättjänst. Endast orkestreraren har PG-/MinIO-åtkomst. Scannercontainern
får ingen sådan behörighet eller socket. En dedikerad rootless Docker-instans
med cgroup v2/systemd och faktiskt delegerade cpu/memory/pids krävs.
macOS-nativeprofilen blir inte produktion genom ett ändrat profilnamn.

Första profilkandidaten heter pm-linux-docker-v1. Gränser: UID/GID10001,
1 CPU, 2 GiB memory inklusive 256 MiB tmpfs, ingen swap, 64 processer,
nofile256, core0. Rootfs och två staging-mounts är read-only. Endast /tmp
är extra skrivbar, nosuid/nodev/noexec/mode0700. IPC none, private cgroup-
namespace, network none, alla capabilities borttagna och no-new-privileges.
Ingen hostnamespace, privileged, extra device, allmän workspace- eller
hemlighetsmount. Standard-seccomp ska komma från pinnad och verifierad runtime,
aldrig unconfined. Profilens gränser måste dimensioneringsprovas; de är inte
bevisat tillräckliga för alla giltiga PDF:er eller ClamAV-byggen.

## Identitet och startplan

En ren infrastructure-funktion får generera docker create-argv och canonical
profilhash från strikt betrodd konfiguration. Den utför ingen I/O eller scan.
Input är attemptId, immutable imageId (sha256:64hex), explicit linux/amd64
eller linux/arm64 samt ett eget absolut staging-root. Rooten får bara innehålla
enkla ASCII-pathsegment; breda roots och traversal avvisas. PDF- och signatur-
katalog härleds under root/attemptId, aldrig från filnamn eller klienttitel.
Varje plan har två read-only bind-mounts med rekursion avstängd och privat
propagation, en fast entrypoint /opt/otid/bin/pm-scan samt fasta filargument.
Ingen shell, implicit pull, image-tag, extra env/argv/mounts eller auto-remove.
Restart/healthcheck och Docker-loggning stängs av. Startplanen är inte proof.

Före start måste betrodd runtime läsa faktisk imageconfig och containerinspect:
exakt image-ID/arkitektur, inga image-deklarerade volumes, hemligheter,
healthchecks eller oväntade environmentvärden. UID-mappning och faktisk läsbarhet
för staging måste provas; host0400 antas inte fungera i user namespace.
Kanoniska realpaths, ägarskap och frånvaro av symlänkar/submounts verifieras
innan mount. En argv-sträng kan inte utföra dessa filesystemkontroller.
Imagebygge, verktygshashar och runtime/kernel/seccomp-versioner ska pinnas i
en separat verifierad releaseprofil; denna ADR hittar inte på dessa värden.

## Livscykel och evidens

Create följt av inspect föregår start/attach. Spara exakt returnerat container-ID
bundet till attempt/journal. Claim committas före I/O enligt ADR-0061.
Output hålls separat och begränsat; inga råloggar sparas av Docker. Yttre
monoton240s och verktyg60s gäller fortsatt. Timeout/abort ska stoppa containern,
inte bara CLI-processen. Exit/OOM/konfiguration läses innan endast den egna
containern tas bort. Osäkert kill/inspect/cleanup ger inget godkänt proof.
En oberoende watchdog/reconciliation måste hantera worker-krasch; DB-leaseexpiry
ensam dödar ingen container. Inga generella prune-/delete-kommandon tillåts.

Framtida produktionsrapport binder manifest/verktyg/signaturer till profilhash,
image-ID och digest, runtime/kernel/seccomp samt observerade effektiva gränser,
exit/OOM och verifierat avslut/cleanup. Dessa uppgifter kommer från betrodd
orkestrerare, inte scannerprocessens egen JSON. Ny executionProfile och eventuell
publishable-rätt kräver kontrakt, migration och verklig acceptans först.
Nuvarande native-profil och DB-constraint publishable=false ändras inte.

## Verklig acceptans före aktivering

Samma MinIO→scan→PG-kedja ska passera under profilen, plus faktisk kontroll av
nonroot/capabilities/no-new-privileges, cgroupgränser, input/rootfs-readonly,
nekad host/extern/DNS/DB/MinIO-kontakt, process-/minnes-/tmp-/outputöverflöde,
timeout, worker-krasch, daemonbortfall och misslyckad cleanup. Network none
lämnar privat loopback; detta är inte ett påstående om förbud mot alla sockets.
Inspectad konfiguration eller syntetiska tester ensamt är otillräckligt.
EICAR och egna syntetiska dokument används; inga användarfiler behövs.

Aktuell Mac saknar Docker/Podman/Lima/Colima och Docker-socket. Ingen VM,
systeminstallation eller fjärrmiljö skapas utan separat avgränsad förberedelse.
Tillgängliga cirka20GiB disk är ytterligare skäl att inte improvisera en VM.
Avsaknad av runtime spärrar isoleringsacceptans, inte fortsatt implementation
av startplan, betrodda livscykelkontroller och övrig TASK013. Fullt mål kvarstår.

Primärkällor och verifierade miljöfakta: docs/research/pm-linux-isolation.md.

## Konfigurationsåterläsning före start, 2026-09-08

checkPmDockerPrestartConfiguration tar strikt betrodd profilinput, exakt
create-returnerat containerId och två SHA-256-pins för releaseprofilens
sorterade unika MaskedPaths/ReadonlyPaths. Pins väljs från separat verifierad
runtime-release, aldrig från just det inspect-svar som ska kontrolleras.
Ingen sådan produktionsrelease finns ännu. Syntetiska fixtures är märkta som
syntetiska och får inte användas för att utfärda releasepins.

Kontrollen läser serverinternt image/container-inspect enligt Engine API1.53.
Top-level metadata som lagringsdriverns interna paths används inte. Kritiska
Config, HostConfig, State och mountobjekt har sluten fältmängd; okända
säkerhetsfält eller saknade obligatoriska värden ger avslag. Tom/null/utelämnad
neutral metadata tillåts bara där uttryckligen definierat. Image-env får vara
en delmängd av de fyra fasta värdena, container-env exakt dessa fyra; dubbletter
nekas. Inga imagevolymer, extra mounts eller körbara healthchecks tillåts.
Image måste ha samma fasta nonroot/entrypoint/Cmd/workdir som målprofilen.
Container-Platform är linux; arkitektur kontrolleras på image. Image-config-ID
är inte registry-manifestdigest, vars proveniens kräver releaseverifiering.

Begärda HostConfig.Mounts och redovisade Mounts kontrolleras var för sig;
NonRecursive=true kan inte ersättas av ReadOnlyNonRecursive. Tmpfsoptioner
måste ha exakt unik uppsättning; dubbla eller motstridiga optioner nekas.
Kontrollen kräver nyskapat/ej startat läge, inga execinstanser/restarts,
exakt namn/labels/ID/image/command, loggning avstängd och profilens resursvärden.
Runtime är runc; avvikande runtime, extra capabilities/devices/namespaces,
portar/nätanslutningar, annotations/sysctls och egna cgroupvägar avvisas.
Startplanen anger nu dessutom runtime=runc, init=false och SIGTERM/5s för
att inte ärva dessa val från daemon eller image. Profilhashen ändras; ingen
publicerad release använder tidigare startplan. Image-metadataetiketter får
bevaras men reserverade io.otid.pm-etiketter får bara komma från planen.
Mask-/readonlylistorna måste vara unika, icke-tomma, innehålla basala proc/sys-
skydd och matcha respektive godkända hash. Ingen tom releasepin kan öppna grinden.

Resultatet configuration-matches är endast kontrollerad metadata, inte ett
scanproof eller tillstånd att starta/publicera. Runtimeacceptans krävs fortsatt;
inspect kan varken bevisa kärnans enforcement, bildlagrens hemlighetsfrihet,
filesystemets realpaths eller hindra en annan daemonklient från senare ändring.
Ingen runtime, schema, executionProfile eller publiceringsgrind ändras här.

## Betrodd lästransport, 2026-09-08

Prestart-insamlingen använder Node HTTP direkt över en explicit lokal Unix-
socket, inte Docker CLI, shell, ambient DOCKER_HOST eller TCP. Endast två fasta
GET-vägar i Engine API1.53 finns: image med exakt config-ID, därefter container
med exakt create-returnerat ID. Inga retries, redirects, API-fallbacks, fria
paths, autentiseringsheaders eller skrivoperationer. Ingen dependency tillförs.

Socketen måste ligga i en kanonisk privat 0700-katalog ägd av samma nonroot-UID
som workern; socketen ska vara riktig socket, inte symlänk, och ha samma ägare.
Detta är en deploymentförutsättning för den dedikerade rootless-daemonen.
Kontrollen ersätter inte betrodd host, releaseidentifiering eller skydd mot
en annan process med samma UID/root som kan byta socket eller ändra daemonen.
ACL-/peercredentialverifiering och faktisk Linuxmiljö ingår i releaseacceptans.

En gemensam 10s monoton deadline omfattar båda läsningarna. Varje svar har
16KiB headergräns och 1MiB bytegräns, kräver HTTP200 och JSON/UTF-8 utan
komprimering. Avklippt svar, felaktig UTF-8/JSON, avbrott eller för stort svar
ger endast inspection-failed. Ingen rå body, socketpath eller daemontext
returneras eller loggas. Abort stänger den egna anslutningen; ingen pool delas.
HTTP-försöket avslutas först efter request-close. Filesystemläsning kan inte
avbrytas i Node; sena filesystemutfall kontrolleras före nästa I/O och godkännande.

Betrodd input valideras och kopieras före await. Efter två godkända läsningar
körs samma strikta metadatafunktion; slutkontroll av abort/deadline krävs också
efter parsning. Ett configuration-matches-resultat är fortfarande ingen
startbehörighet eller isolationsevidens. Create/start/kill/cleanup, daemon-
identitet och betrodd releaseprofil återstår. Socketproven använder riktiga
lokala HTTP-anslutningar men syntetiska serversvar, inte en Docker-daemon.

## Separat lokal Linux-testvärd, 2026-09-08

Förbered en privat, avgränsad Lima/VZ-testinstans på aktuell macOS arm64 för
verkliga Dockerprov. Detta är testinfrastruktur, inte ett nytt produktionsval.
Lima-binären extraheras under en ny privat temporär katalog efter kontroll
mot officiell releasehash. Ingen Homebrew-/systeminstallation, autostart,
sudoersändring, systemtrust eller modifiering av användarens SSH-konfiguration.
LIMA_HOME och cache ligger separat från eventuell användarinstallation.

Resursbudget: 2 CPU, 4GiB RAM och högst 12GiB virtuell disk, utan extra disk.
Aktuell host har verifierat 16GiB RAM, 10 CPU och cirka28GiB ledigt. Bevara
minst 8GiB ledigt på host och stoppa testinstansen vid minnes-/diskproblem.
Kör inte tunga workspacebyggen samtidigt. Testvärden stoppas när provpasset
är färdigt; disk och evidens bevaras tills uttrycklig städning behövs.

Ingen hostmount, SSH-agentforwarding, användarnyckelimport, ambient miljö-/
proxyöverföring, Rosetta eller automatisk applikationsportforwarding. Endast
Limas egna privata SSH-åtkomst till testgästen tillåts. Välj explicit arm64
Linuximage med verifierad SHA-256, ingen generell defaulttemplate som kan
återinföra hemkatalogmount. Läs effektiv konfiguration innan första start.
Inga tävlingsfiler, kartor, Eventornycklar, PG-/MinIO-credentials eller privata
repositories överförs. Enbart explicit syntetiskt testunderlag kopieras senare.

Gästens installationsnät kan hämta officiella paket; detta är inte skannerns
nätisolering. Ingen opinnad curl-pipe-shell-installation eller publik tjänst
ska startas. Docker ska vara separat rootless inom gästen. Först efter faktisk
verifiering av runtime/cgroups/mounts kan scanneracceptans börja. Att Linux
startar eller att en inspect lyckas bevisar inte produktionsisolering.

Docker i testgästen installeras från officiellt signerat Ubuntu-repository
med explicit valda versioner och sparade pakethashar. Rootful docker.service,
docker.socket och containerd.service maskeras i denna nya gäst före installation;
inga befintliga hosttjänster påverkas. Rootless-extras/uidmap används med
paketets egna AppArmorprofiler, inte avstängd AppArmor eller globala sysctl-
lättnader. User-service, subuid/subgid och faktiskt delegerade controllers
kontrolleras före containerprov. Ingen linger/autostart på värddatorn.

## Syntetiskt kompatibilitetsprov i testgästen

En egen minimal image med gästens versionsidentifierade statiska BusyBox och
ett självständigt diagnostikskript får användas för verkliga API-/cgroup-prov.
Den är inte en scannerrelease och avger inga scanrapporter. Image importeras
från ett lokalt tararkiv utan registry/pull; exakt config-ID sparas. Privat
Node-runtime från officiellt hashverifierat arkiv kör endast den betrodda
inspect-adaptern utanför containern. Inga repositorymounts eller hemligheter.
Provets mask-/readonlyförväntningar märks som testunderlag, aldrig releasepins.
Verkliga metadataavvikelser ska dokumenteras och testas, inte tyst godtas.
