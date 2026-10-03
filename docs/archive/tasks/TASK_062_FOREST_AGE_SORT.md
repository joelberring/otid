# TASK062: valbar sortering efter rapporterad startålder

Status: klar 2026-09-12.

Checkbox i adminrapporten sorterar endast STARTED_NO_RETURN: okänd tid först
för uppföljning, därefter längst rapporterad tid vid generatedAt. Lika tider
behåller befintlig ordning. Konfliktgruppen och övriga grupper flyttas inte;
filter/antal/varningar är oförändrade. Utskriften visar samma val och ordning.

Endast web presentation/i18n. Ingen ny ADR behövs: ADR-0096:s tidsbegrepp,
data och behörighet ändras inte. Default är befintlig ordning; logout rensar
valet. Riktat komponentprov av ordning, okänt, lika tider och default;
web lint/typecheck/build. Ingen ny databas eller browsermatris för ren sortering.

Utfall: enhetligt val skickas till skärmrapport och printkopia, återställs
vid logout. Sortering sker på filtrerad kopia utan mutation av underlaget.
Ett komponentprov passerade (481ms), web lint/typecheck/build exit0.
Åtta orelaterade prov valdes bort. Checkboxens browserinteraktion och fysisk
utskrift är inte separat verifierade; båda rapportytorna använder samma prop.
