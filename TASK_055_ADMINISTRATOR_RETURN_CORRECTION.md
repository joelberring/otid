# TASK055: rätta felaktig manuell återkomst

Status: implementerad 2026-09-12; riktad acceptans passerad.
Följ ADR-0092, som uttryckligen utvidgar ADR-0091.

Administratören väljer en deltagare med manuell återkomst, granskar konsekvensen
och tar bort markeringen med samma inloggning. Rapporten läses om. Behåll
startstatus, teknisk återkomst och all historik. Ingen offlinekö eller ny roll.

## Implementation

- Application: gemensam intern online-wrapper för servervald true/false;
  separat offentlig rättningsfunktion och exakt intent-/målbindning vid retry.
- Contracts: återanvänd strikt versionsbundet underlag; bevara TASK054:s
  registreringskontrakt utan ny klientvald action eller målflagga.
- Application källvalidatorer: tillåt false för MANAGE_RACE FINISH_CORRECTION,
  utan att ändra personalens behörigheter eller tillåta startstatusbyte.
- Web: separat POST-route och granska/bekräfta rättning i befintlig rapportyta.
  Återanvänd pending/retry-flödet; inga nya fristående admininloggningar.
- Domain/database: återanvänd befintlig plan och journal; ingen ny resultatmotor
  eller migration. API-nycklar, användardata och hårdvara ligger utanför snittet.

## Riktad acceptans

Utöka befintligt PostgreSQL-prov med registrera→rätta→registrera och replay
av rättningen efter sista steget: replay får inte ta bort senare återkomst.
Kontrollera målbyte med samma request-id, gammal revision, oförändrad start,
teknisk återkomst och återinförd checkin-DNS via befintlig domän. Läs historiken
även med personalens befintliga rosterkontrakt.

Utöka ett browserfall med granskning/avbryt och tappat svar vid rättning;
exakt retry, korrekt rapport och synlig DNS-konsekvens. Kör berörda lint,
typecheck och build, inte hela regressionen. Ingen andra agentgranskning
behövs; eventuell billig agent får en liten separat ändring först efter
att tjänstens interna gränssnitt är fastlagt.

## Utfall

Gemensam tjänst med servervald målflagga, separat rättningsroute och knapp
är implementerade. Samma request-id kan inte byta mellan registrering och
rättning. Historiken accepterar båda målflaggorna utan ny migration.

Två PostgreSQL-prov passerade (978ms); ett utökat browserfall passerade
(10,7s). Browsern verifierar även oförändrade avläsningar/resultatrevisioner
och fortsatt teknisk återkomst efter rättning. Lint/typecheck och browserns
TS/ESLint passerade. Exakta byggresultat redovisas i docs/status.md.
Personalroster efter en false-operation är inte separat browserprovat;
gemensam källvalidering läses genom adminrapporten. Fysisk mobil, produktion
och full offline/recovery-regression är inte verifierade. Nät krävs.
