# Tävlingsarbete: MeOS, Ór och RACE RESULT

Läsande jämförelse av officiella guider 2026-09-24. Ingen källkod,
filstruktur, UI-grafik eller varumärkesutformning återanvänds. Underlaget är
beteendereferens enligt ADR-licensing, inte bevis för full funktionsparitet.

## Källor och observerat beteende

- [MeOS 5.0-handboken](https://www.melin.nu/meos/sv/show.php?base=156&id=5400)
  ordnar den lilla tävlingen från upplägg, deltagare, klasser, banor och
  lottning till avläsning och uppföljning. Större tävling, speaker,
  stafett/gaffling och etapper får egna ämnen. Funktioner väljs efter behov.
  Innehållsförteckningen visar arbetsområden, inte exakt hur varje skärm ser ut.
- [Ór](https://orienteering.ie/or/documentation/OR.html) och
  [Using Ór](https://orienteering.ie/or/documentation/UsingOr.html) beskriver
  ett resultatverktyg för mindre tävlingar: förbered tävling/banor/startlista,
  läs ut och följ upp under tävlingen, publicera efteråt. Separat skärm vid
  avläsningen kan hjälpa deltagaren utan att avbryta operatören. Systemets
  smalare uppdrag är inte modell för O-Tids hela produkt.
- [RACE RESULT 14: Participants](https://www.raceresult.com/en/support/kb?id=8687-Participants-Window)
  och [officiell manual](https://www.raceresult.com/en/support/kbexport2?id=2675)
  visar sök-/filterbar lista intill vald deltagare och detaljområden för
  exempelvis grunddata, resultat och historik. Listor/presentation är ett
  separat arbetsområde. Detta är ett generellt loppsystem, inte en källa
  till orienteringens resultatregler.

## Slutsatser för O-Tid (vår tolkning)

1. Överblick ska visa upplägget och vägen till arbetet, inte alla formulär.
2. Före/Under/Efter är arbetslägen, inte låsta tävlingsstatusar. Deltagare
   måste vara åtkomliga i alla skeden.
3. Lista och vald deltagare sida vid sida passar breda skärmar; mobilen
   behöver en uppgift i taget. Samma data innebär inte identisk layout.
4. Avläsningsstation och startpersonal behöver egna fokuserade arbetsytor.
5. Sammanfattningar måste skilja serverns senast hämtade uppgifter från
   verklig uppkoppling, lokal kö och säker kunskap om vem som är i skogen.
6. Avancerad rättning och historik ska ligga vid rätt arbetsområde, inte
   före den vanliga deltagaröverblicken. En pågående rättning får inte döljas.

O-Tid behåller egna explicita bekräftelser där resultat/historik ändras.
Stafett och gaffling är produktluckor, inte något navigation kan lösa.
## Kompletterande användarunderlag 2026-09-25

Användaren bifogade fyra MeOS-skärmbilder (Deltagare, Kvar-i-skogen, Banor,
Startlista) och en O-Tid-översikt, tagna cirka 06.42–06.44. De illustrerar
arbetsflödesbehovet: samtidig lista/detalj, täta tabellrader och liten
navigationsyta. TASK187 följer dessa beteenden med självständig CSS/markup;
ingen extern kod, UI-mall eller verkliga deltagare har återanvänts i tester.
