# TASK073: journalförd hyrbrickemarkering

Påbörjad 2026-09-18 som nästa minsta vertikala snitt efter TASK072. Ingen
produktionsdriftsättning ingår. Se ADR-0100.

## Användarvärde

Tävlingsadministratören ska kunna markera eller avmarkera den aktiva brickan
som hyrbricka och se statusen direkt i deltagarlistan utan att fabricera ett
brickbyte.

## Avgränsning

- Additiv hyrstatus på den konkreta brickkopplingen.
- Separat immutable/idempotent rättningsjournal under `MANAGE_RACE`.
- Atomisk optimistic-concurrency mot entryversion och race-snapshot.
- Textbunden "Hyrbricka" på deltagarraden och explicit granskning före skrivning.
- Tappat svar återförsöks med exakt samma request.
- Ingen betalning, avgift, återlämning, rapport, Eventor, offlinekö, SPORTident-
  protokoll, GPS eller stafett.

## Berörda paket

- `packages/database`
- `packages/contracts`
- `packages/application`
- `apps/web`
- befintligt riktat TASK029/TASK030-browserflöde

## Acceptans

1. Roster och kontrakt skiljer `isRental: true` och `false` endast på en
   entydig aktiv assignment; saknad/multipel assignment väljs inte.
2. Markering och avmarkering binder exakt assignment, föregående hyrstatus,
   entryversion och snapshot och skapar vardera en ny journalförd version.
3. Samma idempotensbegäran ger samma kvittens; ändrad aktör/target/intent samt
   stale eller inaktiv assignment ger konflikt utan delskrivning.
4. Rådata, avläsningar, resultat, bricknummer och tidigare journaler förblir
   oförändrade.
5. Deltagarraden visar texten "Hyrbricka" endast när aktiv assignment har
   `isRental: true`.
6. UI:t kräver separat granskning, klarar tappat svar med exakt retry och visar
   den uppdaterade statusen efter serverns nya rosterläsning.

## Verifieringsplan

Kör riktade kontraktsprov, ett nytt namngivet PostgreSQL-integrationsprov,
webbens route-handlerprov endast för den nya grenen, statiska kontroller för
berörda paket, ett enda TASK073-browserfall och build. Ingen bred regression.

