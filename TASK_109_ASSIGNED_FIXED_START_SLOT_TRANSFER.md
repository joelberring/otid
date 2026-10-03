# TASK109: klassbyte till verifierad lottad fast starttid

Status: slutförd 2026-09-20. ADR-0121 är accepterad före produktkod.

## Användarvärde

En tävlingsadministratör kan flytta en redan anmäld deltagare till en
FIXED-klass med både plats enligt deltagartaket och en specifik, ännu framtida
vakant tid från senaste sparade startlottning.

## Avgränsning

- Utökar enbart befintligt klassbyte för redan existerande entry.
- Endast `MANAGE_RACE`, målklass `FIXED`, senaste kompletta lottningsjournal
  och framtida entydigt vakant tid.
- Additiv immutable slot-assignment-journal, exakt retry och atomisk
  race-/klass-/entry-/kapacitetskontroll.
- Ingen **ny** fri-text-slot, PUNCH, direktanmälan, samma-klass-tilldelning,
  passerad tid, ny lottning, klubbseparering, resultat-/startlistepublicering,
  avprickning, GPS, karta eller stafett.

## Berörda delar

- `packages/contracts`: uttryckligt slotval och läskandidat, aldrig klientens
  egen slotlista.
- `packages/database`: additiv assignment-journal med restore-not.
- `packages/application`: atomisk transfer med planbevis och konfliktbarriär.
- `apps/web`: slotval i befintlig klassbytesgranskning.
- `tests`: kontrakt, PostgreSQL för slutlig plats/slot-race och exact retry,
  samt ett kompakt 390 px-browserfall.

## Acceptans

1. Bara en aktuell, planbevisad, framtida och vakant slot kan väljas; en
   manuell/dubbel/stale plan visar inte något skrivbart val.
2. Kapacitetsrace och slotrace ger exakt en vinnare och lämnar ingen halv
   transfer eller halv journal.
3. Retry med samma request återger samma transfer, assignment-id och
   slotbevis; annan aktör/intent/slot konflikterar.
4. PUNCH och passerade slots avvisas, och gamla manuella dubbla tider får
   fortsätta existera utan global constraint.
5. Resultat, rådata och frysta startlistor ändras inte automatiskt.

Den befintliga manuella klassbytesvägen med explicit administratörstid är
bevarad för operativa undantag. Den får aldrig presenteras eller journalföras
som ett lottat slotanspråk.
