# TASK217: mindre mobilkrom före tävlingens arbetsyta

Status: implementerad och syntetiskt verifierad 2026-09-27.

## Användarutfall

I inloggat `/manage` på 390 px ska aktuell arbetsyta börja märkbart
tidigare utan att tävlingens identitet, status eller navigeringsvägar
försvinner. Särskilt Under/Speaker ska visa ledarpanelen utan att fem stora
huvudknappar och fyra stora underknappar skjuter den långt ned.

## Beslut och avgränsning

- Dölj den generiska O-Tid-headern och den generiska sidrubriken **bara efter
  autentisering i `/manage` på mobil**, precis som befintligt desktopbeteende.
  Tävlingens egen identitetsrad, Mina tävlingar, lopp/datum/tidszon,
  uppdatera/logga ut, alla sex mått och underlagsversion/lästid behålls.
- Fem huvudlägen ordnas som tre knappar på första raden och två jämbreda på
  andra vid högst 720 px. Varje knapp ska fortfarande vara minst 44 px hög,
  tydligt vald, fokuserbar och spärrad under pågående granskning.
- Bara Under tävlingens fyra underlägen får kompakta synliga mobiletiketter
  på en rad: Läget, Deltagare, Speaker, Rättning. Tillgängligt namn och
  desktoptext förblir fullständiga. Före-lägets sju val ändras inte här.
- Den kollapsade länken till separat speakerinloggning kommer efter den
  primära klassledarpanelen, före 25-radersfeeden. Två förklarande texter
  kortas med oförändrad betydelse om urval och nätanslutning.
- Allt är presentation av befintliga tillstånd; ingen ny teknik, domänregel,
  rättighet, serverroute eller lagring. Därför behövs ingen ADR.

## Riktad acceptans

Utöka det befintliga syntetiska TASK167-browserfallet, ingen ny svit:
före login behålls generell rubrik; efter login finns racekontext och alla
statusuppgifter kvar men generiskt skal är visuellt dolt. Alla fem
huvudvägar och fyra Under-val ska gå att nå utan horisontell sidscroll, med
minst 44 px tryckhöjd och korrekt `aria-pressed`/spärr vid olöst handling.
Mät att Speaker-rubrik och klassledarpanel börjar minst cirka 120 px högre än
i TASK216:s 390 px-bild (alternativt dokumentera faktisk avvikelse). Granska
390/900/1280 px; padda/dator och ej inloggat läge ska förbli oförändrade.
Kör riktad webblint/typecheck/build och samma browserfall en gång efter sista
ändring. Ingen databas, verklig tävling eller fysisk mobil ingår.

## Utfall och kontroll

Syntetisk browser vid 390 px visar tre plus två huvudknappar och fyra
Under-knappar på en rad, med minsta höjd 44 px. Generisk appheader är dold
efter login och sidrubriken visuellt klippt men tillgänglig; raceidentitet,
Mina tävlingar, uppdatera/logga ut, sex statusmått och underlagsversion/lästid
finns kvar. Före login syns generisk header/rubrik. Browserprovet kontrollerar
att Speaker börjar före y=540 och ledarpanelen före y=830, minst cirka 120 px
tidigare än TASK216:s föregående 390 px-bild. Slutlig skärmbild visar även
klassledarknappen inom den första 844 px-höga viewporten. Ingen sidscroll i
sidled. 900/1280 px-bilder granskades utan avsedd layoutändring.

Riktad webblint, web-typecheck och web-build: **exit 0** vardera.
E2E-TypeScript/ESLint: **exit 0** vardera. Befintligt syntetiskt Playwright-
fall: **1/1 passerat, exit 0** efter sista ändringen. Inga nya enhetstester
eller databassviter kördes. En Sol-agent gjorde läsande audit och därefter
avgränsad UI-implementation; huvudagenten ägde browsermätning och docs.
Agentens första pnpm-wrapperförsök stannade före själva kontrollen på
begränsad registry/non-TTY; lokala installerade binärer passerade och
huvudagentens slutliga pnpm-kommandon gav exit 0.

Kvar: fysisk mobil, textzoom/assistiv användning på enhet och verklig
tävlingsdag är inte verifierade. Före-lägets sju underflikar och övriga
arbetsytors egen innehållshöjd kan fortfarande kräva separata pass.
