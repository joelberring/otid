# ADR-0096: tid sedan rapporterad start

Accepterad 2026-09-12 för TASK061.

Visa tid sedan den observation som inledde deltagarens nuvarande sammanhängande
STARTED-markering. Det är operativ uppföljning, inte verifierad löptid,
planerad starttid, fysisk startstämpling eller position.

Härled från verifierade APPLIED-operationer i stigande operativ revision.
UNCHANGED och CONFLICT är inte nya tillstånd. Övergång från annan markering
till STARTED väljer operationens observedAt. Senare APPLIED med fortsatt
STARTED (till exempel ändrad återkomstflagga) behåller ursprungstidpunkten.
Övergång bort från STARTED nollställer den; en ny startmarkering väljer ny tid.
Inkomplett/dubbel revisionskedja ska avvisas, inte gissas från senaste raden.

Beräkna åldern vid rapportens generatedAt, inte löpande mot mobilens klocka.
Gammal rapport måste fortsatt vara gammalmärkt. Saknad startobservation eller
observation efter rapporttiden visas som okänd tid, aldrig negativ/nollad
fabricerad löptid. Visa uppgiften endast som uppföljning för startad utan
registrerad återkomst; ursprungstidpunkten kan granskas i journalen.

Inför en separat utvidgad adminprojektion/kontrakt eller separat adminfält
utanför personalens rosterresponse. Ändra inte befintligt strikt offline-
rosterkontrakt så att äldre mobilklienter får nya okända fält. Båda läsarna
kan dela verifierad journal och rent domänstöd; inga nya lagrade klockvärden,
migrationer, resultatberäkningar eller externa tjänster behövs.
