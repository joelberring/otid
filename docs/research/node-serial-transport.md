# Node-baserad serieporttransport

## Granskade primärkällor

- Officiell dokumentation: <https://serialport.io/docs/guide-usage/>
- Officiellt repository: <https://github.com/serialport/node-serialport>
- Release 13.0.0: <https://github.com/serialport/node-serialport/releases/tag/v13.0.0>
- Paketmetadata: <https://www.npmjs.com/package/serialport/v/13.0.0>
- MIT-licens: <https://github.com/serialport/node-serialport/blob/v13.0.0/LICENSE>

Granskat 2026-08-30.

## Val

O-Tids desktop-CLI använder exakt `serialport@13.0.0`. Paketets officiella API
ger portlista, explicit öppning/stängning, binär läsning och skrivning. Release
13 kräver Node 20 eller senare; O-Tids verifieringsmiljö använder Node 24.

Native `@serialport/bindings-cpp` är en distributionsrisk som måste testas på
varje stödd plattform. Den hålls utanför det webbläsarvänliga
`packages/device-transport` och får inte importeras i webbappen.

## Observerad lokal miljö

På macOS 26.5.1 arm64 var endast Bluetooth- och debugportar synliga. Ingen
SPORTident-enhet observerades. Biblioteksvalet eller ett lyckat syntetiskt test
är därför inte hårdvaruevidens.

