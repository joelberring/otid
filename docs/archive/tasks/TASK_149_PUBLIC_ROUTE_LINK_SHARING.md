# TASK149: dela redan publicerad deltagarrutt och ruttjämförelse

Status: syntetiskt verifierad 2026-09-23; ingen fysisk mobilacceptans.

## Syfte

Gör befintliga publika deltagarrutter och två-/treruttsjämförelser enkla att
dela från både mobil och dator. Besökaren ska kunna använda systemets Web
Share-stöd när det finns och alltid kunna kopiera exakt befintlig publik URL.

Ingen ADR krävs: snittet använder bara redan beslutade, kontofria publika
läsadresser och tillför ingen data, åtkomstregel eller ny klientplattform.

## Ägda lager

- `apps/web/src/lib/public-link-share.ts`: liten, testbar browseradapter för
  Web Share, clipboard och absolut URL från en redan given relativ publik väg.
- `apps/web/src/components/public-link-share.tsx`: svensk, tillgänglig knapp-
  och statusyta utan egen datahämtning.
- Befintliga deltagarrutt-, resultatruttkort- och jämförelsekomponenter:
  montera ytan med sin redan exakta publika väg.
- `apps/web/src/i18n`: svensk text samt riktade webbtester.

## Acceptans

1. En deltagarrutt delar eller kopierar exakt den redan publicerade ruttvägen.
2. En två- eller treruttsjämförelse behåller exakt `first`, `second` och
   eventuellt `third` vid delning/kopiering.
3. Avbruten Web Share eller blockerad clipboard visar en neutral svensk
   återkoppling utan att rutt, resultat eller URL ändras.
4. Funktionen har tydlig textlig återkoppling och ryms vid 390 px utan
   horisontell sidscroll.

## Utanför uppgiften

Nya API:er, server-/kontraktsändring, persistent delningshistorik, analytics,
inloggning, GPS-live, tempo-/vägvalsanalys, OMAP, kartimport, stafett,
SPORTident, USB och fysisk mobilacceptans ingår inte.

## Verifiering 2026-09-23

- Webb-lint och e2e-lint: exit 0.
- Webb- och e2e-typecheck: exit 0.
- Riktat hjälparprov: 3/3 godkända, inklusive avvisning av en väg som
  annars hade bytt origin via backslash.
- Riktat browserprov mot separat, migrerad PostgreSQL med syntetiska data:
  3/3 godkända för deltagarrutt, två- och treruttsjämförelse, felutfall och
  390 px. Den publika delningsytan visas först när deltagarrutten finns.
- `build:checkin` och Next-produktionsbygge: exit 0.

Kvarvarande antaganden: browserstubbar representerar Web Share och
clipboard; en fysisk mobil med verklig delningsdialog är inte provad.
