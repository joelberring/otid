# ADR-0130: publik historisk bana endast vid exakt revisionsmatchning

- Status: Accepterad, implementerad i TASK120
- Datum: 2026-09-21

## Kontext

TASK117–118 publicerar en deltagarrutt på en exakt karta efter samtycke och
explicit release. TASK119 lagrar privata, revisionsbundna kontrollpositioner.
En deltagares aktuella klass kan dock ha bytt bana efter att resultatet
beräknades. Att använda klassens senaste bana eller geometri skulle därför visa
en annan bana än den deltagaren faktiskt hade i sitt historiska resultat.

## Beslut

TASK120 får lägga pixelbaserade kontrollmarkörer i den befintliga publika
deltagarrutten utan ny writer eller migration, men bara när servern kan bevisa:

1. aktuell publik resultatrad och dess historiska `courseVersionId`;
2. aktuell TASK117-route-release för samma deltagare;
3. samma exakta map-manifest och georeferens i release och geometrirevision;
4. fortsatt aktivt TASK116-samtycke och TASK106-kartrelease för exakt karta;
5. en komplett, entydig och in-bounds TASK119-punktmängd för resultatets
   historiska course-version.

Minsta mismatch ger ingen bana och ingen "senaste" fallback. Den publika DTO:n
får bara innehålla kontrollkod, ordning och pixelkoordinat; inga interna ID:n,
hashar eller privata revisionsfält. Markörerna redigeras aldrig publikt.

## Konsekvenser

En publik deltagarrutt kan visa rätt bana när underlaget är komplett, men
förblir stängd när arrangören har ändrat karta/bana eller återtagit samtycke.
Fler-ruttjämförelse, kontrollpassageanalys, OMAP, GPS-live och tempo ligger
utanför beslutet.
