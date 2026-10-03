# PM-skanning i Linux: källor och öppna bevisgrindar

Kontrollerat 2026-09-08. Ingen extern källkod återanvänds.

Docker create skapar utan start, så konfiguration kan kontrolleras före
verktygskörning. Pull, restart, user, IPC, memory, pids, mounts, logging och
healthcheck styrs uttryckligen i profilen. Flags är konfiguration, inte bevis.
[Docker create](https://docs.docker.com/reference/cli/docker/container/create/).

Docker-gränser är inte automatiskt aktiva i rootless-läge. cgroup v2/systemd
och delegerade controllers måste kontrolleras. Saknade villkor kan få Docker
att ignorera cgroupflaggor; även systemd kan sakna CPU-delegation.
[Rootless tips](https://docs.docker.com/engine/security/rootless/tips/).

Memory-swap lika med memory innebär ingen swap; noll är inte motsvarande
inställning. CPU-kvot ersätter inte en total tidsgräns.
[Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).
Tmpfs använder minne och kan annars swapas. Gränser för faktisk expansion
och filantal måste provas, inte härledas ur enbart size-option.
[Tmpfs](https://docs.docker.com/engine/storage/tmpfs/).

Network none behåller en isolerad loopbackenhet. Acceptans avser frånvaro av
host-/extern kontakt, inte frånvaro av alla socket-syscalls.
[None network](https://docs.docker.com/engine/network/drivers/none/).
Bind-mounts behöver explicit read-only och kontrollerade submounts; välj
bind-recursive=disabled och privat propagation för egna stagingkataloger.
[Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).

Default-seccomp är en säkerhetsgräns som inte ska stängas av. Runtimeversion
och faktisk profil måste ingå i verifieringen.
[Seccomp](https://docs.docker.com/engine/security/seccomp/).
Docker-daemonåtkomst är privilegierad och får inte följa med in i skannern.
[Daemon socket](https://docs.docker.com/engine/security/protect-access/).

## Lokal miljö och alternativ

command -v gav ingen docker/podman/colima/limactl/nerdctl/qemu-system-aarch64.
Docker.app/OrbStack.app och de kontrollerade Docker-socketarna saknas.
Darwin arm64 har sandbox-exec, men det styrker inte Linux cgroup/OCI-profil.
df rapporterade cirka20GiB ledigt; ingen test-VM eller systeminstallation
gjordes. Ingen privat tävling, Eventornyckel eller användarfil användes.

Lima dokumenterar separat binärarkiv och macOS VZ; QEMU behövs endast för
QEMU-driver. Det är ett möjligt framtida isolerat testunderlag, inte ett
verktyg installerat eller godkänt genom denna research.
[Lima installation](https://lima-vm.io/docs/installation/),
[VM types](https://lima-vm.io/docs/config/vmtype/).

ADR-0062 väljer en konkret startprofil men kräver riktiga Linuxfelprov och
pinnad image/runtime innan produktionsaktivering. Ingen syntetisk observation
eller genererad startplan kan ersätta den grinden.

## Inspect-schema

Engine API1.53:s officiella OpenAPI-specifikation hämtades till
/private/tmp/otid-docker-api.LI5b5F/engine.yaml. SHA-256:
ad5ac7811e934a5ceb94174500b42bb0392b8a6a00ef0809cf1015f6ae5a3360.
Fältsemantik, inte extern implementation, används i egna kontrollfunktioner.
[Engine API1.53](https://docs.docker.com/reference/api/engine/version/v1.53/).

## Privat Lima-underlag 2026-09-08

Officiell Lima2.2.0 arm64-release hämtad till privat testkatalog:
/private/tmp/otid-linux-probe.a1rGvP. Arkivets SHA-256 matchar publicerad digest:
bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3.
limactl --version gav 2.2.0. Binären extraherades här, inte installerad i
/usr/local eller Homebrew. Detta är hashmatchning mot officiell HTTPS-release,
inte ett påstående om separat verifierad GPG-signatur.
[Lima2.2.0](https://github.com/lima-vm/lima/releases/tag/v2.2.0).

Ubuntu24.04 arm64 release-20260705 hämtad från officiell cloud-imagekälla;
SHA-256 matchar den pinnade Limas referens:
7df0201546f75b8bcc1044594c806c35749421ad3c9bc1be2a3ab806cfae39cc.
Endast denna image används, inga opinnade fallback-URL:er.
[Pinnad imagereferens](https://github.com/lima-vm/lima/blob/v2.2.0/templates/_images/ubuntu-24.04.yaml).

Limas defaulttemplate importerar hostmounts; tom egen mountlista räcker därför
inte om baser importeras. Testkonfigurationen är fristående och LIMA_HOME helt
ny. Proxyöverföring/containerd/default-portforwarding stängs uttryckligen av.
[Pinnad konfigurationsreferens](https://github.com/lima-vm/lima/blob/v2.2.0/templates/default.yaml).

På macOS pekar os.UserCacheDir på ordinarie användarcache, oberoende av
LIMA_HOME. Testet använder därför en separat nedladdad lokal image: den
pinnade Download-funktionen kopierar lokala filer före cachegrenen. Inaktiverad
containerd undviker dess arkivhämtning. Ordinarie ~/Library/Caches/lima saknades
före instansskapandet. Det finns ingen antagen LIMA_CACHE_HOME-override.
[Downloader](https://github.com/lima-vm/lima/blob/v2.2.0/pkg/downloader/downloader.go),
[Containerd-cache](https://github.com/lima-vm/lima/blob/v2.2.0/pkg/cacheutil/cacheutil.go).

## Faktisk rootless Docker-testinstallation 2026-09-08

Endast den privata Lima-gästen pmtest ändrades. Officiell APT-källa noble/stable
arm64 med Docker-nyckel hämtad över HTTPS; nyckelfilens SHA-256:
1500c1f56fa9e26b9b8f42452a553675796ade0807cdce11975eb98170b3a570.
APT update accepterade signerad metadata utan signaturvarning. Inga
allow-unauthenticated/trusted=yes-flaggor användes. Rootful docker.service,
docker.socket och containerd.service maskerade före paketinstallation.
[Docker Ubuntuinstallation](https://docs.docker.com/engine/install/ubuntu/).

Explicit installerade versioner: docker-ce/docker-ce-cli/docker-ce-rootless-
extras 5:29.8.0-1~ubuntu.24.04~noble, containerd.io2.3.5-1~ubuntu.24.04~noble,
uidmap1:4.13+dfsg1-4ubuntu3.2, dbus-user-session1.14.10-4ubuntu4.1 och
slirp4netns1.2.1-1build2. Download-only följdes av no-download-installation.
Pakethashar sparade i privata docker-download.log; huvudpaketen:

| Paket | SHA-256 för arm64-DEB |
| --- | --- |
| docker-ce | 49423a6859730698d5a1e7a8646bb2d1e00d69d7a19c92385b2582f5694cb348 |
| docker-ce-cli | 72061caac70241ec5b4f50defb8acef0e14f2ad0e2fdc347131f7ccf02faf930 |
| docker-ce-rootless-extras | dc2df2ca161956a09456c77596959bd02de3c8b5ff8312219eee71b5481f4da1 |
| containerd.io | a0dd1da60ceb3f7dc08521b81b20c9fd9d2986fd745a522292fcdaac190cb24e |

Paketets dockerd-rootless-setuptool.sh kördes i testanvändarens riktiga
SSH/PAM-session, utan --force och utan global AppArmor/sysctl-lättnad.
Ubuntu rootlesskitprofil finns; apparmor_restrict_unprivileged_userns=1.
otidtest har subuid/subgid100000:65536. Ingen ytterligare cgroupoverride
behövdes: user@1000.service anger DelegateControllers=cpu cpuset io memory pids.
[Rootlessförutsättningar](https://docs.docker.com/engine/security/rootless/),
[Ubuntu/AppArmor](https://docs.docker.com/engine/security/rootless/troubleshoot/).

Faktisk server29.8.0/API1.56 (min1.40), containerd2.3.5, runc1.5.1,
RootlessKit3.1.0 och slirp4netns1.2.1. Docker info visar systemd/cgroup2 och
rootless/seccomp-builtin/cgroupns. Dockerd kör som otidtest; socket ligger i
privat /run/user/1000 (0700). Ingen rootful daemon/socket fanns efter installation.
Inga containers har körts: leafvärden/throttling/OOM/pids-nekande är ännu inte
verifierade. Detta är en test-runtime, inte godkänd produktionsrelease.
[Rootless-resursgränser](https://docs.docker.com/engine/security/rootless/tips/).

ImageInspect.Id beskriver imageconfig/lageridentitet; RepoDigests avser
manifester. ContainerInspect.Platform anger operativsystem, inte arkitektur.
HostConfig.Mounts beskriver begäran medan Mounts använder Destination/RW och
saknar NonRecursive. ImageConfig.Env och Volumes är ärvda defaultvärden.
State created måste bindas till samma fullständiga container-ID och kontrolleras
innan start; ingen sådan metadata utgör ett bevis på resursgränsernas verkan.

## Lokal inspect-transport

Node HTTP stödjer socketPath och AbortSignal; maxHeaderSize begränsar
svarshuvudet. Timeout-event ensamt avbryter inte begäran: transporten måste
destroy/abortera och invänta close. agent=false undviker delad anslutningspool.
Egen total monoton deadline behövs även om data fortsätter komma.
[Node HTTP request](https://nodejs.org/api/http.html#httprequestoptions-callback),
[ClientRequest close](https://nodejs.org/api/http.html#event-close).
Engine API1.53 definierar GET /images/{name}/json och /containers/{id}/json;
vår adapter erbjuder endast exakta validerade ID:n och ingen fri API-väg.
[Engine API1.53](https://docs.docker.com/reference/api/engine/version/v1.53/).
