# TASK203: deltagarlista i fast starttidsordning

Status: genomfört och riktat verifierat 2026-09-27.

## Faktiskt utgångsläge

Administratörens deltagarunderlag kommer redan från servern i stabil
efternamn–förnamn–internt ID-ordning. Klientfiltret bevarar den ordningen och
sidindelar efter filtrering. DTO:n har bara ett sammanslaget visningsnamn;
att sortera om det skulle ge en annan och sämre ”namnordning”. Den publika,
frysta startlistan och dess serverordning berörs inte.

## Avgränsat operatörsutfall

I deltagarlistans befintliga kontrollrad kan arrangören välja mellan
”Efternamn” och ”Fast starttid”. Efternamn behåller exakt serverordning.
Fast starttid ordnar deltagare i minutstart med tilldelad tid kronologiskt;
fri start och saknad fast tid ligger sist. Lika tider och poster utan tid
behåller serverordningen. Hela det filtrerade urvalet sorteras före
sidindelning, utan att ändra underlaget eller vald person. Byte av ordning
börjar på första sidan och valet ligger kvar efter uppdaterat underlag.

Den extra väljaren får inte skapa en ny stor panel, ett annat typsnitt eller
horisontell sidscroll. På dator/padda får den plats i befintlig kontrollrad;
mobil kan stapla kontroller med tryckvänliga mål. Sorteringen är endast
privat visning, ingen API-/domänregel eller ADR.

## Proportionerlig kontroll

Ett rent test med fler än 25 poster, lika tider, fri start och saknad tid
kontrollerar immutabilitet och sidgräns. Ett tillägg i det befintliga
syntetiska browserfallet provar väljaren och ett första radbyte vid 390/1280
px. Därefter riktad browser-TypeScript/ESLint och web lint/typecheck/build.
Ingen DB- eller bred testsvit för klientprojektionen.

## Utfall och verifiering

”Ordning” ligger bredvid klass och antal rader. Standardvalet ”Efternamn”
kopierar serverns radföljd utan namnomsortering. ”Fast starttid” sorterar
minutstartens satta tider kronologiskt med serverns index som utslagsregel;
fri start och saknad fast tid ligger sist i sin tidigare inbördes ordning.
Filtrering sker först, därefter sortering av hela träffmängden och sist
sidindelning. Byte av ordning återgår till sidan 1 och privat underlag
modifieras inte. En kort förklaring visas när tidsordningen är vald.

Kontrollerna ryms på en rad i det riktade syntetiska browserprovet vid
390/900/1280 px. På minst 380 px kortas endast synlig etikett ”Rader per
sida” till ”Rader”; selectens tillgängliga namn förblir fullständigt.
Skärmbilder för mobil, padda och tidsordnad datorlista granskades utan
horisontell sidscroll.

Riktat rent test: **5/5 passerade, exit 0**, inklusive 28 poster över
25-radersgränsen, lika tider med olika tidszonsnotation, fri/saknad tid,
oförändrat indata och filter före sortering. Befintligt syntetiskt browser-
fall: **1/1 passerade, exit 0**. Browser-TypeScript/ESLint och slutlig web
lint/typecheck/build gav var för sig **exit 0**. En första web-lint gav
**exit 1** på onödiga testassertioner och en första web-typecheck gav
**exit 2** på saknat null-skydd vid ett testindex; båda rättades och
slutkontrollerna passerade. Ingen DB, extern data eller publicerad startlista
ändrades.

Kvarvarande antaganden: serverns validerade roster fortsätter ge stabil
efternamn–förnamn–ID-ordning; tidsstämplar är parsebara och hör bara till
minutstartklasser. Riktig 10 000-personerslista, fysisk mobil/padda,
textzoom och skärmläsare är inte accepterade.
