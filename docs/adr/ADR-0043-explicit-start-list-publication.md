# ADR-0043: Explicit publicering och avpublicering av startlista

- Status: Accepterad
- Datum: 2026-09-04

## Beslut

TASK 006S ger publik och tävlande en startlista först efter ett explicit
racebundet arrangörsbeslut. TASK 006R förblir privat; dess läsbehörighet
utökas inte. `PUBLISH_START_LIST` med prefix `otid_org_start_list_publication_v1`,
egna cookies, åtta timmars access och en timmes session tillåter att granska,
publicera och avpublicera exakt ett lopps startlista. Befintlig auth,
Origin/CSRF och strikt 4 KiB mutationsbody återanvänds.

Publicerad data fryser eventnamn, loppnamn, loppdatum, tidszon och klassvis
namn, klubb och planerad start. Bricknummer, interna entry-/class-id:n,
rawdata, externa identiteter och resultat ingår inte. PUNCH har null tid och
visas som startstämpling; FIXED utan tid visas uttryckligt som saknad tid.
Detta är planerad information, aldrig faktiskt startad/DNS eller IOF Complete.

Projektionen byggs genom explicit kolumnurval under race SHARE/UPDATE.
Max 1 000 klasser och 10 000 entries totalt, unika interna referenser och
korrekta race-/klassrelationer krävs; overflow/korruption avvisas utan
trunkering. Presentationens klass-/tid-/namnordning följer ADR-0042.
Publicering kräver minst en deltagare; tomt underlag får granskas men inte
publiceras. Inga personuppgifter hämtas från resultat eller externa system.

## Intent och historik

En privat förhandsgranskning lämnar snapshotversion, serverberäknad SHA-256
över canonical `{snapshotVersion, content}` samt senaste beslutsrevision.
Från TASK 006T använder nya granskningar hashformat 2 enligt ADR-0044 för att
också binda strukturerade namn och XML-projektion. Gamla beslut förblir orörda.
PUBLISH-intent binder samtliga tre. Under session → credential → race UPDATE
→ request advisory kontrolleras samma underlag igen. Inga uppgifter ändras
mellan förhandsgranskning och skrivning utan att intentet blir stale.

Om det nya underlaget inte går att validera lämnar privat granskning ändå
senaste beslutsmetadata och snapshot, med både content och sourceHash null.
Det blockerar publicering men inte avpublicering av den gamla kopian.
Endast specifika projektions-/valideringsfel får hanteras så; databasfel
rapporteras som fel. Withdrawal och exakt replay läser ingen ny innehållsprojektion.

En immutable `start_list_publication`-rad är både beslut och requestjournal:
request UUID, actorcredential, race, stigande revision, PUBLISH/WITHDRAW,
normaliserat intent, faktisk snapshotversion, valfri sourceHash/fryst content
och decidedAt. Beslut och actor-audit committar atomiskt. Exakt samma
actor/request/intent returnerar samma svar även efter senare beslut; ändrad
kontext ger konflikt. Ett nytt identiskt PUBLISH på redan identisk aktuell
publikation avvisas som no-op. Gamla beslut skrivs aldrig över.

WITHDRAW binder endast senaste beslutsrevision och kräver en aktiv PUBLISH.
Det ska gå att avpublicera även när tävlingsunderlaget ändrats. Withdrawal
sparar null content/sourceHash och gör den publika läsningen otillgänglig.
En senare ny publicering kräver ny granskning och ny beslutsrevision.

Ändringar av deltagare, namn, klass eller tid påverkar aldrig en publicerad
kopia tyst. Ny publicering är explicit; befintlig kopia visar sin beslutstid
och revision. Endast senaste beslutet är publikt åtkomligt. Äldre frysta
personuppgifter ingår i den privata beslutshistoriken, inte i publika
historik-URL:er. Återtagande kan inte radera redan nedladdade/skärmdumpade kopior.

## Webb och offline

Arrangören ser exakt de fält som kommer att bli offentliga och bekräftar i ett
andra steg. Vid okänt commitsvar används samma request-id; ingen automatisk
ny request eller Web Storage av credential/intent. Separata publika GET och
shell kräver inget konto och använder no-store. Browsern uppdaterar var femte
sekund och vid återgång till synlig flik; varje misslyckad hämtning tar bort
tidigare lista i stället för att fortsätta visa möjligen avpublicerad PII.
Ingen cookie sätts av publik läsning. Före första publicering eller efter
withdrawal lämnas ingen deltagardata.

Detta är serverberoende publicering, inte en offlinekö. Stationens paket,
outbox, kvittenser, resultat och rådata ändras inte.

## Migration och avgränsning

0028 lägger additivt till capability och immutable beslutstabell med unika
request- och race/revision-nycklar, FK till race/actor och tydliga CHECKs för
action/content/hash samt auditaktören START_LIST_PUBLICATION_ACCESS_CREDENTIAL.
Ingen ny motorregel, resultatstatus eller dependency.
Vid incident stängs writer/CLI och credentials spärras. Använd explicit
withdrawal, additiv rättning eller verifierad backuprestore, aldrig radering
av gamla journaler/enumvärden. Ingen lottning, Eventor eller faktisk start.
