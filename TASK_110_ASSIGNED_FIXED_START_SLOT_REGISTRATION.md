# TASK110: direktanmälan till verifierad lottad fast starttid

Status: genomförd och verifierad 2026-09-20. ADR-0122 beslutades före produktkod.

## Användarvärde

En administratör kan direktanmäla en ny deltagare i en `FIXED`-klass och välja
en specifik framtida, vakant starttid från klassens senaste verifierbara
lottningsunderlag — utan att uppfinna en generell startbokning.

## Avgränsning

- Utökar endast befintlig direktanmälan för en ny entry.
- Endast målklass `FIXED`, aktuell klasskapacitet, senaste kompletta draw och
  en framtida entydigt vakant slot.
- Den nya slotvägen har egen immutable journal, atomisk retry och återger
  exakt bevis i registreringskvittensen.
- Befintlig manuella FIXED-registrering finns kvar som separat undantagsväg;
  den får inte tolkas som en lottad slot.
- Ingen PUNCH-slot, samma-entry-ändring, reservlista, allmän bokning,
  återlottning, klubbspridning/seedning, resultat- eller startlistepublicering,
  avprickning, GPS eller stafett.

## Acceptans

1. Kandidat-GET visar enbart framtida, verifierbara, vakanta tider och blir
   explicit otillgänglig vid avvikande/dubbel/stale plan.
2. Sista sloten och sista deltagarplatsen kan bara vinnas av en skrivning;
   ingen entry, brickkoppling, registreringsjournal eller slotjournal får bli
   halvcommittad.
3. Samma idempotensnyckel, aktör och intent återger identisk registrering och
   samma assignment-bevis; ändrat intent eller aktör konflikterar.
4. PUNCH och passerade/manuella/icke-planerade tider avvisas som slotval;
   ingen global unik starttidsconstraint införs.
5. Rådata, resultat och redan publicerade/frysta listor ändras inte.

## Verifiering

- Contracts: 3/3 riktade tester.
- Webbrutter: 39/39 riktade tester.
- Isolerad PostgreSQL17: TASK110, TASK109 och TASK035, 6/6 riktade tester.
- Playwright: 1/1 i 390 px mot riktig lokal Next/HTTP och isolerad PostgreSQL;
  första svaret avbryts efter commit och samma registreringsintent återförsöks.
- Berörd lint, typecheck och web production build passerar.
