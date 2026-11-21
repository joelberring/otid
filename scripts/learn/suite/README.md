# Facit-sviten (2026-11-21)

Mäter grundkartans regler och tränade modeller mot alla facitkartor i ett svep, så att en ändring som hjälper en karta
inte i smyg försämrar en annan. Data hämtas med AI-kopplingen (`training_labels` i 2 m, `training_raster` lasveg, lasmark,
laskron, fuktdjup) till en mapp per karta; `suite.py` har kartornas hörn och världsfiler.

- `evalsuite.py` – dagens regler mot en modell för alla klasser, tränad på de andra kartorna (lämna en karta utanför).
- `veg3.py` – bara skog, öppet och grönt.
- `hybrid.py` – öppet ur regeln, grönt ur en modell.

Resultat: projektets `ortofoto-och-facitsvit-2026-11-21.md`.
