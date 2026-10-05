# ADR-0171: Sträcktidsanalys, karta och vägval

Status: beslutad 2026-10-05 (PLAN.md steg 16, ägarens önskemål samma dag). Kompletterar ADR-0168–0170.

## Bakgrund

Ägaren vill ha en sträcktidsanalys i stil med WinSplits där man kan trycka sig vidare till vägvalen på kartan.
Kart- och ruttkoden från före omstarten var parkerad (ADR-0168 beslut 5). Den byggde på MinIO med reservationer,
debiterade försök och versionsmanifest, deltagarlänkar med egna sessioner för uppladdning, deltagarsamtycke,
publiceringsjournaler, kontrollgeometri och privata ruttkontexter – och den nåddes inte längre från webben,
eftersom den krävde de gamla funktionsvisa credentials som steg 1 tog bort.

## Beslut

1. **Kartor och rutter lyfts ur parkeringen** för vägval i sträcktidsanalysen. GPS-följning, deltagarkonton,
   MinIO-replikering och Livelox är fortfarande parkerade.
2. **Den gamla koden tas bort** (applikation, kontrakt, webbsidor, API:er, objektlagringsadaptrar, tester och
   17 tabeller, migration 0098) i stället för att byggas om. Det som återanvänds är domänens georeferens
   (tre punkter → affin transform) och GPX-tolken, som gjorts tolerant för vanliga klockor och appar.
3. **Lagring i PostgreSQL**: kartbilden och GPX-filen som `bytea` (`race_map`, `participant_route`). Det kräver
   ingen ny tjänst, `docker-compose.prod.yml` behöver inte MinIO och den nattliga `pg_dump` tar med allt.
   Storleken (en karta på några MB och rutter på några hundra kB per lopp) är liten för PostgreSQL.
4. **Bara admin laddar upp** (ADR-0168 beslut 4): kartbild, georeferens och GPX per löpare, i arbetsytan under
   Resultat → Karta och vägval. Deltagarnas uppladdningslänkar (route-upload-grant) tas bort; inga nya
   credentials. Löpare skickar sin GPX-fil till arrangören.
5. **Publikt**: kartbilden bara när den är georefererad och rutterna bara som delar för en sträcka i ett
   publicerat resultat – aldrig tiden före start eller efter mål, aldrig den råa filen.
6. **Sträckornas identitet** är från- och till-kontroll. En gafflad klass analyseras per variant; en sträcka
   över en missad kontroll är en egen sträcka. Stafett får ingen analys än (sträckresultaten finns i listan),
   rogaining har inga sträckor.

## Konsekvenser

- Tidsförskjutning mellan GPS-klockan och stationerna rättas inte; skillnaden är normalt några sekunder.
- Kontrollernas lägen på kartan finns inte (banfilens koordinater läses inte in); vägvalens ändpunkter är
  löparens position vid stämplingen.
- `docs/map-and-route-model.md` beskriver modellen. Avsnitten om TASK106–155 i `docs/architecture.md` är historik.
