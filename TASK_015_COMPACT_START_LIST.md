# TASK015 – Kompakt sökbar startlista

Status: implementerad och verifierad, se docs/status.md. Fortsätter
produktprioriteringen i CODEX_BRIEF §24.

Startpersonal ska på befintligt behörigt underlag kunna hitta deltagare genom
namn, klubb eller bricknummer och kombinera sökningen med befintligt klassval.
En kompakt tabell samlar namn/klubb, klass, planerad start och bricka. Mobilen
ska visa samma uppgifter läsbart utan horisontell sidskroll. Inga faktiska
startmarkeringar skapas: länken till separat offlineavprickning bevaras.

Scope: endast web/start-list-admin, svenska texter, komponentavgränsad CSS
och fokuserade tester. Filtrering är presentation i minnet, inte domänlogik;
befintlig serverordning och tidszonsformatering bevaras. Klassens PUNCH-regel
visas som startstämpling, aldrig som fabricerad klocktid. Saknad starttid,
ingen bricka/flera aktiva brickor och gammalt underlag förblir tydliga.
Ingen API-, schema-, behörighets- eller teknikändring; ingen ADR behövs för
den rena layout-/filterändringen. Konsekvensfull utökning kräver ny ADR.
Inga nya dependencies, stafett, GPS, USB eller Eventoranrop.

Acceptans: kombinerat klass/textfilter, skiftlägesokänslig matchning, tydligt
visat antal och återställning av filter, båda startreglerna i samma tävling,
oförändrad ordning/tidszon, synliga datavarningar, authfel/logout döljer
persondata. Söktext hålls endast i minnet och rensas vid authfel/logout.
Riktig browser på1366×768/390×844 med syntetiska svar, fokuserat filter-/tidsprov,
lint/typecheck/build. Ingen ny PG-/hårdvaruacceptans för ren UI-ändring.
Privata tävlingar och gamla demodatabaser lämnas orörda.
