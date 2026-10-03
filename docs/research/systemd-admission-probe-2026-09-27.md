# systemd-underlag för TASK196

Faktakällor kontrollerade 2026-09-27; bara originaldokumentation och
systemds egna källfiler har använts:

- [systemd `systemd.exec.xml`: `LoadCredential=`](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml)
  beskriver att systemd laddar källfilen och gör den tillgänglig under
  `CREDENTIALS_DIRECTORY` för enhetens process. Ett avslag från O-Tids
  launcher kan därför inte påstå att systemd aldrig läste den syntetiska
  källfilen; det visar endast ordningen i launchern.
- [systemds egen `initrd-cleanup.service`](https://github.com/systemd/systemd/blob/main/units/initrd-cleanup.service)
  använder `AssertPathExists=` i `[Unit]`, samma systemd-direktiv som
  TASK196-fixturens disponibla sentinel.

Fixturen är fortfarande inte verifierad med `systemd-analyze verify` eller
körd mot systemd på denna macOS-värd. Dokumentationen ovan är
syntax-/beteendeunderlag, inte ett installationsbevis.
