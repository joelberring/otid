# Eventor Sverige: produktionsprofil för read-only import

Granskat 2026-09-19 inför TASK101. Ingen autentiserad request, API-nyckel,
Eventorrespons eller tävlingspersondata användes.

## Primärkällor

- [Eventors API-metodlista](https://eventor.orientering.se/Api/Documentation?culture=sv-SE)
- [Eventors guide: Hämta data via API](https://eventor.orientering.se/Documents/Guide_Eventor_-_Hamta_data_via_API.pdf)
- [Eventors API-schema](https://eventor.orientering.se/api/schema)

## Verifierade fakta

- Sveriges produktionsorigin för API är `https://eventor.orientering.se/api/`.
- Metodlistan anger `GET /event/{eventId}`, `GET /eventclasses?eventId=…`
  och `GET /entries?eventIds=…` med Event-, EventClassList- respektive
  EntryList-svar.
- Guiden anger en 32-teckens API-nyckel i HTTP-headern `ApiKey`; nyckeln ska
  inte ligga i en URL.
- Metodlistan och schemat kan ändras. O-Tids fasta origin, redirectförbud,
  timeout, bodygräns, råbyteshash och strikta parser är egen säkerhets-/
  interoperabilitetspolicy, inte påstådda Eventorvillkor.

## Slutsats

Produktionsorigin får inte ersätta Testeventors origin i befintlig kod. Den
behöver vara en separat, immutabel och AAD-bunden profil enligt ADR-0116.
Syntetiska profiler kan bevisa O-Tids gränser, men inte API-nyckelns behörighet,
villkor eller en verklig produktionsrespons. Sådan liveacceptans kräver separat
ägarstyrd operativ körning.
