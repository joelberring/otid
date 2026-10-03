# TASK026 – rätta deltagarens namn och klubb

## Vertikalt snitt

Från deltagarlistan: välj deltagare, rätta namn/klubb, granska, spara med
versionskontroll och se journalförd före/efter. Inga automatiska ändringar av
resultat, externa identiteter eller publicerade dokument. ADR-0067 gäller.

Berörda paket: contracts, database (additiv migration), application och web.
Domain/resultatmotor och IOF-serializerare ändras inte. Inga externa system,
privata testdata eller AGPL-källor krävs.

## Acceptans

1. Separat racebehörighet, strikt begäran/svar och CSRF/Origin. Läsbehörighet
   för startlista eller registrering ger inte rättningsrätt.
2. Atomisk ändring av exakt tre fält, entry/snapshot +1, immutable journal
   och audit. Stale/no-op/overflow lämnar databasen oförändrad.
3. Exakt retry återger första svaret; ändrad actor/target/intent ger konflikt,
   även efter senare rättning. Samtidig rättning/import ser hela tillstånd.
4. Ny import får inte skriva över journalförd rättning; gammal identisk fil
   förblir skrivfri retry. Andra entries/klass/brickor/starttid påverkas inte.
5. Rådata, revisionsmängd och gamla publicerade startlist-/Complete-bytes
   oförändrade. Nytt paket visar ny text och version, gamla kvitton bevaras.
6. Kompakt sök/val/granska/spara/historik på desktop och mobil. Fryst retry,
   authrensning och inga namn/id/credentials i navigations-URL eller storage.
7. Lint, typecheck, riktade kontrakts-/PG-/browserprov och build med exakta
   resultat. Ingen full hårdvarusvit för en ren adminändring.

## Status

Arkitekturbeslut, grundkontrakt, migration0041, capability, skyddad listtjänst,
atomisk rättning och importskydd införda. Ny klubbtext max200 för att passa
befintliga stationspaket; exakt historisk/förväntad text får vara240.
Journalens scopebundna, versionssidande läsväg och skyddade HTTP-routes finns.
Senaste contracts/application/web lint, typecheck och build exit0. Sex
kontraktstest passerar; sju riktade PG-prov täcker även overflow och samtidig
import/rättning, sju routetester täcker cookie/auth/scope/8KiB. Tidigare18
import-/rättnings-/brickbytesprov passerade i föregående steg.
Kompakt UI med deltagargenväg, egen auth, explicit val/granskning och fryst
retry finns nu. Betrodd credential-CLI tillagd. Genomgående browser→HTTP→PG
passerar på1366/390px (2test,17.7s), inklusive tappat commitsvar, exakt retry,
en enda journalrad, rättningshistorik och authrensning. Desktop provar även
fördröjt svar efter logout och återinloggning. Bilder granskade utan horisontellt
överflöd. Web lint/typecheck/build exit0,16 riktade webtester passerar.
Script-/browser-tsc och eslint exit0. Exakta resultat i docs/status.md.

TASK026 är avgränsat implementerad och verifierad. Fysisk mobil, stora volymer,
verklig bfcache och produktion är inte bevisade. CLI-processens issue/revoke
har inte körts; motsvarande tjänst används av genomgående browserprovet.
Ingen full workspace/hårdvaruomkörning för detta adminsnitt. MeOS-paritet
och huvudmålet är inte klara.
