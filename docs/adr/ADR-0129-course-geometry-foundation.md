# ADR-0129: versionsbunden kontrollgeometri före publik banpåtryck

- Status: Accepterad och implementerad i TASK119
- Datum: 2026-09-21

## Kontext

TASK117–118 kan visa en samtyckt deltagarrutt som pixelspår på en exakt
släppt, georefererad rasterkarta. Orienteringsmodellen har dock bara
kontrollkod och ordning i `course_control`; den har ingen kontrollposition.
Att rita en bana från kontrollkoder eller deltagarens GPX-spår skulle fabricera
geometri och göra en felaktig karta trovärdig.

## Beslut

Före en publik eller privat banpåtryck skapas ett separat, immutable
geometriunderlag för exakt en course-version på exakt en kartmanifestversion.
Varje position binds till både kontrollförekomst och kartversion, har ordning,
källa och revision, och får aldrig väljas som "senaste" av en läsare.

Första snittet lagrar och granskar endast geometri privat för `MANAGE_RACE`.
Det publicerar varken kontroller, banor eller en ny karta och ändrar inte
TASK116-samtycket eller TASK117-ruttreleasen. En senare publicerings-ADR måste
kräva att den historiska course-versionen för deltagarens resultat och den
exakta kart-/georeferensversionen matchar samma geometriunderlag.

## Konsekvenser

TASK119 behöver en additiv migration och explicit administrativ writer med
optimistisk version, idempotency och audit. Browsern får inte skapa eller
gissa positioner. GPX, OMAP, GPS-live, ruttjämförelse och faktisk publik
banpåtryck ligger fortsatt utanför snittet.
