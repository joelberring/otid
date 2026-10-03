# TASK059: journaltider i tävlingens tidszon

Status: klar 2026-09-12.

Visa journalens observation/mottagning med befintlig svensk tidsformatterare
och tidszon från adminvyns validerade tävlingsunderlag. Behåll datum, UTC-offset
och eventuella millisekunder så att upprepad sommartidstimme är entydig.
UTC-värdet behålls i time-elementets dateTime. Om tävlingsunderlag saknas,
visa uttryckligen UTC, aldrig enhetens lokala tidszon.

Endast web-komponent/i18n. Ingen ny ADR: ADR-0094:s instanter, sortering,
cursor och behörighet ändras inte. Ett komponentprov av upprepad timme och
oförändrade UTC-attribut; web lint/typecheck/build. Ingen ny PG/browserkörning
för ren tidsformatering, befintlig formatterare har redan dygnsskiftesprov.

Utfall: ett komponentprov passerade (252ms), web lint/typecheck/build exit0.
Ingen tjänst, databas eller originaltid ändrad. Sommartidens upprepade timme
visar olika UTC-offset; UTC-attributen är bevarade. Ingen fysisk mobil eller
produktionsdrift verifierad. Tidszonen följer det inlästa tävlingsunderlaget.
