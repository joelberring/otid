# TASK028: Dubblettvarning vid direktanmälan

## Vertikalt snitt

Operatören granskar möjliga befintliga deltagare före en direktanmälan.
Samma namn är en varning, inte en identitet eller ett förbud. En redan
historiskt kopplad bricka förblir en konflikt enligt ADR-0040/0041.
Ingen automatisk sammanslagning, extern personsökning eller ny resultatstatus.

ADR-0068 ska finnas före implementation. Berörda paket är contracts,
application och web; ingen schemaändring, dependency eller domänflytt behövs.
MeOS-kod eller externa personuppgifter används inte.

## Leverans

- Separat skyddad kandidatsökning under REGISTER_ENTRY, inte utökning av den
  befintliga klasslistans strikta svar. Läsningen kräver samma Origin/CSRF som
  övriga POST-anrop och skriver ingen tävlingsdata.
- Exakt normaliserat för- och efternamn eller historiskt brickägarskap i
  samma lopp. Visa namn, klubb, klass och träfforsak; inga resultat, rådata,
  kontaktuppgifter eller andra bricknummer.
- Högst 20 synliga kandidater med totalt träffantal och tydlig begränsning.
  Alla loppets entries undersöks före begränsningen; inget falskt tomt resultat.
- Kandidatsvaret måste avse det frysta granskningsunderlagets racesnapshot.
  Ändrat formulär/underlag kräver ny sökning. En namnträff kräver ett tydligt
  lokalt val att skapa en annan deltagare med samma namn.
- Fel eller stale snapshot är inte ”inga dubbletter”. Ny registrering kan
  inte bekräftas i denna vy innan sökningen lyckats. Exakt retry efter okänt
  commitsvar ska däremot fortsätta använda det ursprungliga intentet utan
  en ny sökning eller ett nytt request-id.
- Kompakt granskningsyta på dator och läsbar mobilvy. Logout/authfel/expiry/
  pagehide döljer persondata; sena svar får inte återöppna vyn.

## Riktad acceptans

1. Kontrakt: strikt scope, normaliserad fråga, maxgräns, unika entries och
   korrekta antal/träfforsaker; inga obehöriga extrafält.
2. Ren matchning: NFC, svensk skiftlägesjämförelse och whitespace; diakritik
   skiljs åt, inga delnamn/fuzzyträffar; klubb/klass utesluter inte namnträff.
3. PostgreSQL: samma lopp/behörighet, aktuell och inaktiv brickkoppling,
   snapshotkonflikt, begränsning efter matchning, läsning utan skrivningar.
4. HTTP: auth före JSON-läsning, Origin/CSRF, strikt bodygräns, no-store,
   inga namn i URL, avvisat scope/ogiltigt svar.
5. Browser: namnvarning och avsiktlig fortsatt anmälan, tomt/fel/stale svar,
   ändrat formulär, dubbla namn utan sammanslagning, tappat commitsvar med
   identiskt retry, auth/logout och sent svar, smal/bred layout.

Kör lint/typecheck/riktade tester/build för berörda paket. PostgreSQL/browser
körs sekventiellt mot uttryckligen isolerad syntetisk testdatabas, aldrig
privat tävling eller manuell demo. Ingen fysisk USB/GPS/stafett ingår.

## Status

Påbörjad. Beslut och kontraktsgrund först; server- och browseracceptans krävs
innan uppgiften får kallas klar.

TASK036 återanvänder nu kontrakt/matchning i en skyddad application-läsning och
gemensam administratörsvy enligt ADR-0077. Denna uppgifts separata begränsade
operatörs-HTTP/UI återstår; TASK028 i sin helhet markeras därför inte klar.
