# Tävlingsadministratör: första gemensamma arbetsvyn

TASK029/ADR-0069 inför en enda racebunden administratörsinloggning. Den nya
vyn ligger på `/admin/<race-id>/manage`. I första kopplingen kan samma session
läsa deltagarna, byta bricka och byta klass/starttid tillsammans; fler administrativa
arbetsytor ansluts sedan. Målklass med FIXED kräver explicit datum/klockslag/
UTC-offset, medan PUNCH tar bort den gamla fasta tiden. Deltagargränsen
kontrolleras vid sparande, men ingen minutstartlucka reserveras.
Resultat räknas inte om automatiskt. Äldre klassbytes-v1-kontrakt bevaras,
men även deras writes kontrollerar deltagartaket.

## Betrodd tilldelning

I avvaktan på webbhantering av administratörer utfärdar betrodd serverpersonal
en gemensam behörighet. Befintliga begränsade credentials blir inte automatiskt
administratörer. DATABASE_URL ska peka på avsedd databas med migration0044.
Välj en privat katalog utanför repository med katalogläge0700 och fil0600.
Använd restriktiv umask och noclobber för att undvika överskrivning.

```bash
pnpm --silent race:admin:access:issue --race-id <uuid> --label <operatör> --expires-at <UTC-ISO> > /private/path/new-race-administrator.json
pnpm --silent race:admin:access:revoke --credential-id <uuid> --reason <orsak>
```

Inga hemligheter i argv eller URL. Utfärdning vägrar interaktiv stdout.
Vid okänt utfärdningsutfall: kontrollera credential-/auditjournalen innan nytt
försök, eftersom utfärdning inte har requestbunden idempotens. Delge endast
avsedd administratör. Maxlivslängd åtta timmar, session högst en timme.
CLI är serveradministration, inte ännu ett användarkonto-/medlemsregister.

## Arbetsflöde och begränsningar

Logga in en gång, sök deltagare, välj målklass och granska klass och starttid. Vid
okänt sparutfall återförsök med samma begäran; skapa inte ett nytt klassbyte.
Samma administratör måste återautentiseras om sessionen gått ut mitt i ett
osäkert försök. Logout/omladdning kan förlora minnesburet retryintent; läs då
aktuellt underlag före nytt beslut. Ingen offlinekö eller beständig browser-
lagring av persondata införs. Gamla resultat och publiceringar bevaras.

Behörighet används endast av de dedikerade administratörsroutes som har
integrerats. Äldre funktionssidor delar inte automatiskt cookies. Stäng de
nya routes och spärra rollen vid incident; radera inte historik eller enums.

Fäll ut Deltagargränser per klass för att ändra tak med samma inloggning.
Tomt fält är obegränsat, 0 stänger en tom klass. Alla registrerade räknas,
även ej startande. Ändringen har egen version/historik och kräver inte
omräkning eller nya stationspaket. Import som överskrider taket avvisas helt;
inga tidigare rader i samma import sparas. Aktivera gränssättning först när
alla skrivvägar från samma release är driftsatta, se ADR-0070.

Brickbyte finns vid vald deltagare i samma arbetsvy enligt ADR-0071.
Granska gammal/ny bricka och bekräfta. Vid tappat svar används samma begäran,
inte ett nytt byte. Annans historiska bricka kan inte övertas i detta flöde;
egen tidigare bricka kan återaktiveras. Flera aktiva kopplingar visas som
konflikt. Resultat räknas inte om automatiskt och äldre rådata bevaras.
Underlagskontrakt och webben levereras tillsammans; redan öppen äldre
strikt klient kan behöva omladdning. Ingen ny migration behövs för TASK030.

Välj Klassbyte, Brickbyte eller Starttid vid samma deltagare. Endast valt
formulär visas. Starttid rättar en fast tid utan klassbyte (ADR-0072): datum,
klockslag och explicit UTC-offset granskas före sparande. Saknad fast tid kan
sättas, men tiden kan inte raderas här. PUNCH visar endast förklaring.
Inga startluckor reserveras och befintliga resultat räknas inte om automatiskt.
Finare lagrad precision än millisekunder ger fel/konflikt, aldrig tyst
avrundning. Historiska journaler och tidigare begränsade flöden bevaras.

Omräkning är en fjärde åtgärd med samma inloggning enligt ADR-0073. Den hämtar
aktuellt underlag för vald deltagare och kräver en entydig aktiv brickkoppling
med avläsning. Granska innan bekräftelse: en ny teknisk resultatrevision
publiceras. Aktiva manuella resultatbeslut kan fortfarande styra det publika
resultatet; gamla finaliserade dokument uppdateras inte. Saknat/ändrat
underlag kräver ny läsning, aldrig en fabricerad avläsning eller tyst retry.

Gällande resultat visas vid vald deltagare enligt ADR-0074. Lästid anger när
serverunderlaget hämtades; nya avläsningar kräver uppdatering. Ett styrande
manuellt beslut kan ge en äldre effektiv revision än senaste publicerade
tekniska revision. Resultatets historiska klass och äldre snapshot visas
uttryckligen efter klassbyte. Inget publicerat resultat och återtaget resultat
utan aktiv ersättare är olika tillstånd. Vyn är inte finalisering eller full
beslutshistorik och kvitterar aldrig en okänd mutation genom enbart läsning.

Namn och klubb är en femte åtgärd enligt ADR-0075. Välj deltagare, rätta de
tre fälten och granska före/efter. Tom klubb betyder ingen klubb; ändringen
gäller bara deltagandet i detta lopp. Samma inloggning och exakta retry används.
Nytt namn visas efter kvittens; en ny rättning kräver aktuellt namnunderlag.
Ingen automatisk omräkning, Eventorskrivning eller uppdatering av frysta
publika kopior sker. Migration0045 måste vara applicerad före aktivering.
Vid återgång stängs vägen men giltig adminjournal och utökad check behålls.

Ny deltagare öppnar Direktanmälan med samma session enligt ADR-0076. Välj
klass och fyll i namn samt valfri klubb/bricka. Minutstart kräver datum,
klockslag och UTC-offset; fri start får ingen fast tid. Platsläget är inte
en reservation och kontrolleras igen vid sparande. Kontrollera deltagarlistan
först: namn dedupliceras inte automatiskt. Efter kvittens väljs nya deltagaren
så att exempelvis brickbyte kan fortsätta direkt. Ingen ny migration krävs.

Vid Granska anmälan söks nu möjliga befintliga deltagare enligt ADR-0077.
Samma hela namn kräver kryss för att avsiktligt skapa en annan person;
historiskt upptagen bricka kan inte åsidosättas. Välj befintlig deltagare
lämnar oskickad anmälan utan att kopiera dess uppgifter. Högst20 träffar visas
med totalt antal; felstavningar fångas inte. Tappat registreringssvar använder
fortfarande samma begäran utan ny sökning. Ändra val kräver ny granskning.
