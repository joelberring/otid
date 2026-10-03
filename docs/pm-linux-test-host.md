# Privat Linux-testvärd för TASK013

## Status 2026-09-08

Grundprovet har körts på en faktisk Lima/VZ-gäst. Gästens namn är `pmtest`;
den är stoppad efter provet. Rootless Docker29.8.0 är nu installerat i gästen
och har startats/verifierats/stoppats. En syntetisk container är skapad men
har aldrig startats. Detta är
testinfrastruktur, inte produktions- eller scanneracceptans.

Privat katalog: `/private/tmp/otid-linux-probe.a1rGvP` (0700). Binärer i
`runtime`, separat LIMA_HOME i `state`, verifierad originalimage i
`ubuntu-arm64.img`, fristående konfiguration i `otid-test.yaml`.
Ingen Homebrew-/systeminstallation eller ändring av användarens SSH-filer.
Limas egna genererade nycklar finns privat i state/_config; skriv inte ut dem.
Ingen testcredential eller Eventornyckel behövs för denna miljö.

## Verifierat

- Lima2.2.0 Darwin arm64, officiell arkivhash matchar. Se research för hash.
- Ubuntu24.04 arm64 release-20260705, officiell imagehash matchar pinnad referens.
- `limactl validate` och `create`: exit 0.
- Effektiv `list --json` visar VZ/arm64, 2 CPU, 4294967296 bytes RAM och
  12884901888 bytes disk; inga mountlistor eller extra diskar/nät ärvdes.
- Agent-/X11-forwarding, importerade användar-pubkeys, proxyöverföring,
  containerd, Rosetta och applikationsportforwarding är avstängda.
- Start: exit 0 och READY. Ubuntu24.04.4, Linux6.8.0-134-generic aarch64,
  systemd255.4, UID/GID1000 otidtest. Cgroup v2 exponerar cpu/memory/pids.
- Grundassertioner av arkitektur/UID/cgroups/inga virtiofs-,9p-,sshfs-mounts:
  exit 0. Detta bevisar inte Docker-delegation eller resursgränsernas verkan.
- Ubuntu/systemd255 använde privat loopback-SSH istället för vsock. Startlogg
  bekräftar att övrig TCP-/UDP-forwarding är avstängd. Limas egna standard-
  SSH-inställningar är teståtkomst, inte en verifierad produktions-SSH-policy.
- Stop: exit 0; disken och underlaget bevaras. Vanlig användarcache för Lima
  saknas även efter provet; lokal image och avstängd containerd undvek den.
- Separat lsof-kontroll efter stopp hittade ingen TCP-lyssnare på den tilldelade
  SSH-porten50058 (exit1/ingen träff). Ursprunglig och lagrad lima.yaml har samma
  SHA-256: 5a5d0bb33910001d299810f296d2cebc0a2c259575924639c514ad8d715b9c8c.

Inledande diagnostik slutade med exit127 eftersom sista kommandot var
`command -v docker`: Docker saknas, inte ett passerat Dockerprov. Det separata
grundassertionskommandot ovan passerade. Sandboxad validate/list gav en
sysctl-varning om Rosettadetektering; godkänd start körde VZ/arm64 utan Rosetta.

## Fortsättning

Använd exakt denna separata LIMA_HOME; kör aldrig kommandon mot defaultinstans:

```bash
LIMA_HOME=/private/tmp/otid-linux-probe.a1rGvP/state /private/tmp/otid-linux-probe.a1rGvP/runtime/bin/limactl start --tty=false --timeout=120s pmtest
LIMA_HOME=/private/tmp/otid-linux-probe.a1rGvP/state /private/tmp/otid-linux-probe.a1rGvP/runtime/bin/limactl shell pmtest -- uname -srm
LIMA_HOME=/private/tmp/otid-linux-probe.a1rGvP/state /private/tmp/otid-linux-probe.a1rGvP/runtime/bin/limactl stop --tty=false pmtest
```

Kontrollera disk/RAM och effektiv konfiguration före återstart. Behåll minst
8GiB hostdisk ledigt; inga tunga workspacebyggen samtidigt. Inga mounts eller
riktiga dokument/credentials ska tillföras. Nästa minsta steg är ett verkligt
syntetiskt containerprov som läser leaf-cgroups och kör inspect-adaptern mot
den faktiska daemonen. Ingen curl-pipe-shell eller produktionsaktivering.
Skannerimage, containerlivscykel, resurs-/nät-/kraschprov och hela TASK013:s
PM-publicering/restore återstår.

Start-/stopploggar: `start.log`, `stop.log` under privata katalogen ovan.
Se ADR-0062 och docs/research/pm-linux-isolation.md för beslut och primärkällor.

## Rootless Docker, senare samma dag

APT-förberedelse, download-only/hashregistrering, no-download-installation,
paketets rootless-setup och slutliga runtimeassertioner: exit 0. Exakta
paketversioner/hashar finns i research och docker-download.log. Systemnivåns
docker.service/docker.socket/containerd.service är fortsatt masked/inactive;
ingen /var/run/docker.sock eller UID0-dockerd. Användartjänsten startar endast
den privata rootless-daemonen. Setup aktiverade dess user-service i gästen;
ingen linger eller hostautostart tillfördes av oss.

Docker29.8.0/API1.56(min1.40), containerd2.3.5, runc1.5.1,
RootlessKit3.1.0. Dockerd kör som otidtest. Docker info visar rootless,
seccomp-builtin, cgroupns, cgroup2 och systemd. /run/user/1000 är 0700 och
docker.sock ägs av otidtest. cpu/cpuset/io/memory/pids är tillgängliga i
user@1000.service och docker.service; subtree_control var tom utan containers.
Ingen leaf-cgroup eller faktisk throttling/OOM/pids-nekning har verifierats.
AppArmorrestriktionen för user namespaces är fortfarande1, paketprofilen
rootlesskit finns och subuid/subgid är 100000:65536. Ingen override behövdes.

Stop av user-service, kontroll att dess socket försvunnit, samt VM-stop:
exit 0. list visar Stopped. Den nya SSH-porten var50119 och hade ingen
lyssnare efter stopp. Underlaget använder cirka3.2GiB, host har cirka25GiB
ledigt. Loggar: apt-prepare.log, docker-download.log, docker-install.log,
rootless-setup.log, docker-runtime.txt, docker-stop.txt och stop-docker.log.
Inga applikationskällor eller privata tävlingsunderlag ändrades.

Efter återstart, kontrollera user-service och använd alltid explicit socket:

```bash
LIMA_HOME=/private/tmp/otid-linux-probe.a1rGvP/state /private/tmp/otid-linux-probe.a1rGvP/runtime/bin/limactl shell pmtest -- docker --host unix:///run/user/1000/docker.sock info
```

Den befintliga initramfs-BusyBox är dynamiskt länkad, inte en fristående
statisk probebinär. Kopiera den inte ensam till en scratchimage och anta att
den fungerar. En syntetisk probeimage måste byggas/identifieras separat,
aldrig förväxlas med en qpdf/ClamAV-release eller godkänd produktionsprofil.

## Syntetisk container och produktomprioritering

Node24.20.0 Linux arm64 hämtades från officiellt arkiv; SHA-256
5f4ddab610c1ab2016b3c227cebdbf6d9495161487e4739c7b90090595f465f7
matchade före och efter kopiering till gästen. Ingen systeminstallation.
BusyBox-static 1:1.36.1-6ubuntu3.1 fanns redan i gästen; /usr/bin/busybox
är statisk och har SHA-256
52151e7f322f926b64049cdaa1410dc3ea6485525e0624b05813791c219ae933.
Ett tidigare download-only-försök följt av hashning av antagen DEB-path gav
exit1 eftersom paketet redan fanns och inget nytt arkiv hämtades. Detta var
inte en lyckad ny paketinstallation.

Egen diagnostikimage importerades utan registry med rootfs-tarhash
8e91c86ddbf6c328567a006e2465482b0d2fcee5e8cd165c03d7035f278cac88.
Image-ID sha256:7fffa77b89890859153d6958d85a6ed5fb1516e7195f69f9499e8f40c554641b.
Projektets faktiska startplansfunktion skapade container
d4a1a4786e126f7289613c94b2b0596612233ac1bfc8d83c9233442676145db0,
attempt ef2e73b6-8e26-493f-91b9-7033f8a6222f. Prepare-probe gav exit0.
Faktiska API1.53 GET-svar finns privat i pm-probe-{container,image}.json.
MaskedPaths innehåller även /proc/interrupts jämfört med API-exemplet och
containerd2.3.5:s standardlista. Ingen oberoende Docker-releasepin godkändes;
vår Node-inspect-CLI har därför ännu inte körts mot daemonen.

Användaren omprioriterade till tävlingsflöden och proportionerliga tester.
Containern verifierades created/running=false. Docker-user-service och VM
stoppades, exit0; ingen lyssnare på tilldelad SSH-port50244 vid efterkontroll.
Disk, image, skapad container och underlag bevaras. Inget raderades.
Ingen faktisk leaf-cgroup-/enforcement-/scanneracceptans är genomförd.
Detta arbete fortsätter inte före de prioriterade tävlingsflödena.
