# TASK125: kompakt publik ruttöversikt vid deltagarresultat

Status: genomförd. Ingen ADR krävs eftersom snittet bara
renderar redan godkänd TASK117/118-data från samma publika ruttläsning.

## Användarvärde

En besökare ser direkt på deltagarens resultatsida att en publik rutt finns,
vad den omfattar och kan öppna den utan att först behöva gissa vad länken
"Visa rutt" leder till.

## Avgränsning

- Endast den existerande `readPublicParticipantRoute`-projektionen.
- Visa tillgänglighet, distans, punkt-/segmentantal och befintlig GPX-tidstatus.
- Länk till den befintliga exakta ruttvyn.
- Ingen ny API-data, migration, writer, samtyckes-/release-regel, GPS-analys,
  jämförelse, tidsuppspelning eller karta/OMAP-funktion.

## Acceptans

1. En godkänd publik rutt visar ett svenskt, kompakt kort med den befintliga
   härledda metadata och en länk till exakt samma deltagarrutt.
2. Saknad eller återtagen rutt visar inget kort och lämnar resultatsidan
   användbar.
3. Vid 390 px finns ingen horisontell sidscroll och ingen WGS84-, intern-,
   lagrings- eller releaseidentifierare i DOM.

## Genomförande

En liten serverrenderad komponent får endast den redan validerade publika
ruttvyn och dess publika URL från resultatsidan. `not-found` eller återtaget
underlag renderar ingenting; komponenten har ingen egen hämtning eller
fallback. Mobil-CSS använder två kolumner för fakta och fullbreddslänk.
