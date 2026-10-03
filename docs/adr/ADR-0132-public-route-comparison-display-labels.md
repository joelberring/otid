# ADR-0132: publika deltagaretiketter i exakt ruttjämförelse

- Status: Accepterad, implementerad i TASK122
- Datum: 2026-09-21

## Kontext

TASK121 visar korrekt två rutter i röd och blå färg, men en direktlänk till
jämförelsen säger bara "första" och "andra" rutt. Då går det inte att avgöra
vem färgen avser utan att gå tillbaka till resultatlistan.

## Beslut

TASK122 får lägga till `givenName` och `familyName` för vardera sida i
TASK121:s publika jämförelsesvar. Värdena ska återanvända exakt de nuvarande
visningsnamn som den publika resultatprojektionen redan använder för samma
effektiva publicerade resultathuvud. De ska inte komma från GPX, samtycke,
release, interna identiteter eller ny lagring.

Namn lämnas bara när hela TASK121-grinden redan har accepterat jämförelsen;
ett `not-found` svar läcker varken ett namn eller vilken sida som saknade
underlag. Organisation, bricknummer, starttid, resultat, position, intern id,
hash och WGS84 ingår inte i denna nya route-DT0.

## Konsekvenser

Färgförklaringen kan visa två entydiga deltagarnamn i den befintliga vyn utan
extra API-anrop eller skrivväg. Namnändringar följer samma redan publika,
aktuella resultatvisning; detta är inte ett historiskt profilarkiv. Bilder,
klubbar, fler deltagarfält, favoriter och jämförelsehistorik kräver nya beslut.
