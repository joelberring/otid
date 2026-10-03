# ADR-0098: ändra klassens startregel med gemensam admin

Accepterad 2026-09-12 för TASK065.

Modellen stöder redan PUNCH (fri start via startstämpling) och FIXED
(tilldelad tid/minutstart) per klass. Import kan ändra startregel och
lottning hanterar FIXED, men manuell klassändring saknas. Inga nya starttyper,
teknikval eller domängränser införs.

MANAGE_RACE ska kunna ändra i båda riktningar även med befintliga deltagare
och resultat. Förhandsunderlag visar antal deltagare, befintliga fasta tider
och resultat som behöver ses över. Orsak och uttrycklig bekräftelse krävs,
inte separat roll eller förbud enbart för att resultat finns.

Vid verkligt regelbyte töms klassens deltagares fixedStartTime i båda
riktningar. Gamla tider ska inte tyst återaktiveras efter fri start. De
gamla värdena bevaras i ändringsjournalen. FIXED kan därför först sakna tider;
administratören tilldelar dem genom befintlig lottning eller tidsrättning.
Ingen fabricerad starttid, startmarkering, återkomst eller DNS skapas.
Oförändrad regel är no-op och får inte rensa tider.

Skrivningen använder race UPDATE-lås, förväntad snapshotVersion/startregel,
idempotent request-id och verklig aktör. Vid ändring ökas snapshotversion och
berörda entryversioner atomiskt. Snapshoten uppdateras med befintlig mekanism.
Ny immutable header/items-journal kräver migration med scope-FK och bevarade
gamla tider/versioner. Retry matchas före kontroll av aktuellt underlag.

Resultatrevisioner, råavläsningar och operativa startmarkeringar ändras inte.
Resultat med gammalt paket hanteras med befintlig stale-/omräkningsmekanism;
UI ska tydligt påminna om explicit omräkning. Publicerade frysta startlistor
och slutresultat förblir historia, aldrig tyst uppdaterade. Ny publicering
är ett separat beslut. Offlineenheter behöver nytt paket; tidigare lokala
rapporter behålls och går genom befintlig versionskonflikthantering.

Rollback: stäng skrivvägen, behåll läsning och journal. Återställ regel genom
ny journalförd ändring; återställ inte tider eller resultat tyst. Destruktiv
återgång kräver verifierad backup/restore, inte borttagning av historik.
