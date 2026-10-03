# Namn och klubb – privat arrangörsrättning

TASK026/ADR-0067. Rättning gäller bara en deltagares förnamn, efternamn och
klubbtext. Varken extern personidentitet eller globalt klubbregister ändras.
Resultat räknas inte om automatiskt och tidigare publicerade listor/exporter
behåller sitt innehåll. Ny publicering och eventuell omräkning är separata
uttryckliga åtgärder. Ny klubbtext högst200 tecken.

## Behörighet

Betrodd operatör kör mot avsiktligt vald, migrerad serverdatabas med
DATABASE_URL i privat servermiljö. Issue ger endast CHANGE_ENTRY_IDENTITY för
ett lopp, högst åtta timmar. Session högst en timme. Startlistebehörighet,
brickbytesbehörighet eller en navigationshint ger inte denna rätt.

Skapa privat katalog utanför repository och använd restriktiv umask innan
avsiktlig omdirigering. Exempel (ersätt platshållare; inga hemligheter i argv):

```bash
umask 077
CI=true pnpm --silent entry:identity:access:issue --race-id <uuid> --label <label> --expires-at <UTC-ISO> > /private/path/new-identity-access.json
CI=true pnpm --silent entry:identity:access:revoke --credential-id <uuid> --reason <reason>
```

JSON från issue innehåller bearercredential. Dela säkert med den avsedda
operatören, lägg inte i URL, logg, repository eller chatt. CLI vägrar utfärda
till interaktiv terminal. Omdirigering måste fortfarande göras medvetet;
icke-interaktiv stdout är inte automatiskt privat. Om svaret förloras,
kontrollera credentialjournalen före nytt issue; CLI är inte ett idempotent
utfärdandeflöde. Spärra överflödig/förlorad credential, radera inte historik.

## Arbetsflöde

Deltagare och startlista → Rätta → Namn och klubb. Destinationen behöver egen
inloggning och ett explicit deltagarval. Sök och välj deltagare; kontrollera
före/efter innan spara. Tom klubb innebär uttryckligen ingen klubb.
Okänt commitsvar ska återförsökas med samma granskat intent/request-id, aldrig
som en ny rättning. Omladdning tappar minnesburet intent: läs aktuell lista
och historik innan nytt beslut. Detta är en onlinefunktion, inte en offlinekö.

Journalen visar endast explicita rättningar, inte full personhistorik eller
avläsningar. Ny import med avvikande text efter en rättning avvisas atomärt;
rätta uttryckligen först om importens uppgifter verkligen ska gälla.

## Verifieringsläge

Server/kontrakt/HTTP har riktade tester. Genomgående browser→HTTP→PostgreSQL
passerar på1366/390px, inklusive tappat commitsvar, exakt retry, journal och
spärrad behörighet. Fördröjt lässvar efter logout får inte återvisa persondata.
CLI är lint-/typkontrollerat. TASK027 verifierade dessutom faktisk issue via
CLI till privat fil och använde denna credential för lyckad HTTP-login/läsning.
Direkt CLI-revoke har inte körts; bakomliggande spärrtjänst används i browserprovet.
Fysisk mobil, stora datamängder och produktionsdrift är inte verifierade.
Inga riktiga tävlingscredentials har utfärdats inom TASK026.
