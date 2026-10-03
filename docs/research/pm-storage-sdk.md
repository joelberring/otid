# PM-lagring: pinnad SDK och paketmetadata, 2026-09-07

Installerad minio är exakt 8.0.7; pnpm-lock.yaml binder resolution och integrity.
Registrets versionfråga för 8.0.8 gav ERR_PNPM_PACKAGE_NOT_FOUND. Masterversion
är därför inte installationsbevis. Officiell referens:
[taggad klient](https://github.com/minio/minio-js/blob/8.0.7/src/internal/client.ts).
Den installerade dist-koden och typerna kontrollerades dessutom lokalt.

RetryOptions.disableRetry stöds. Adaptern använder fast region, path style,
64 MiB partSize och dessutom en egen högst-en-PUT-gräns per transportoperation.
SDK:n sköter signering. getBucketPolicy kastar vid NoSuchBucketPolicy; adaptern
accepterar endast detta specifika frånvarofall, inte lyckad godtycklig policy
eller access denied. GET binder versionId och kontrollerar versionsheader.
Inga källkodssnuttar från SDK:n kopierades in i implementationen.

## Faktiskt installerade licensfält

Följande är metadata, inte en full distributions- eller sårbarhetsrevision.
Main och agent läste runtime-dependencyträdet, inte devDependencies.

- Apache-2.0: minio 8.0.7.
- ISC: inherits 2.0.4.
- BSD-3-Clause: stream-chain 2.2.5, stream-json 1.9.1.
- BlueOak-1.0.0: sax 1.6.1.
- MIT: @nodable/entities 3.0.0, anynum 1.0.1, async 3.2.6,
  block-stream2 2.1.0, browser-or-node 2.1.1, buffer-crc32 1.0.0,
  decode-uri-component 0.2.2, eventemitter3 5.0.4,
  fast-xml-builder 1.3.1, fast-xml-parser 5.11.1, filter-obj 1.1.0,
  ipaddr.js 2.5.0, is-unsafe 2.0.2, lodash 4.18.1, mime-db 1.52.0,
  mime-types 2.1.35, path-expression-matcher 1.6.2, query-string 7.1.3,
  readable-stream 3.6.2, safe-buffer 5.2.1, split-on-first 1.1.0,
  strict-uri-encode 1.0.0, string_decoder 1.3.0, strnum 2.4.2,
  through2 4.0.2, util-deprecate 1.0.2, xml-naming 0.3.0,
  xml2js 0.6.2, xmlbuilder 11.0.1.

Infrastruktur använder också befintlig zod 4.1.5. Inga AGPL-implementationer
kopierades. MinIO-serverns drift/licensfrågor är separata från SDK-trädet.
Ingen MinIO-server eller scanner installerades i detta steg.

## Verifieringens gräns

HTTP-proven kör faktisk pinnad SDK mot egen syntetisk Node-loopbackserver.
Servern kontrollerar inte SigV4 och har ingen durabel MinIO-lagring. Dessa prov
bevisar därför inte verklig auth, privat bucket, versionsbeständighet eller
återställning. Det är obligatoriska separata TASK013-prov före aktivering.

## Verklig MinIO-körning, 2026-09-07

Officiell darwin-arm64-binär för samma version som Compose,
[RELEASE.2025-07-23T15-54-02Z](https://github.com/minio/minio/releases/tag/RELEASE.2025-07-23T15-54-02Z),
hämtades till privat tempkatalog utan systeminstallation. SHA-256 verifierades:
`0939ce5553ce9e6451b69e049fbf399794368276b61da8166f84cbd8c7f2d641`.

Den separata integrationssviten passerade 3 tester: autentiserad PUT/readback,
anonym objekt-/bucketläsning 403, exakt äldre version efter ny PUT samt avslag
för saknad version och suspenderad versionering. Runnern verifierade dessutom
samma äldre bytes efter ren processomstart med samma privata datakatalog.
Detta stärker evidensen med verklig SDK/server-signering och versionerad disk-
lagring; det ersätter inte backupåterställning till ny server.

Provet använder syntetiska bytes, isolerade rootcredentials, single-node och
HTTP på loopback. Ingen PDF-parser, antivirus, produktions-TLS, begränsad
applikationsbehörighet eller kombinerad PostgreSQL/objektåterställning provas.
Servern stoppades och inga buckets/versioner raderades. Privat körunderlag:
`/private/tmp/otid-minio-run-ybeVew`; integration.log innehåller testresultat.
