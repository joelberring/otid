# TASK027 – separat lokal provtävling för deltagarflödet

## Avgränsning före åtgärd

Gör TASK026 manuellt provbar med syntetiska Ada/Bo, deltagarlista och separat
namn-/klubbbehörighet. Återanvänd befintlig demo:provision oförändrad, följt
av befintliga roll-CLI:er. Inga privata tävlingsdatabaser eller gamla demodata
uppdateras, inga Eventoranrop, inga kartor eller hårdvara används.

Ny lokal PostgreSQL-cluster på egen loopbackport55441, skild från automatiska
testers stoppbara cluster55440. Ny tom otid_demo_20260909_participants migreras
genom0041 och provisioneras. Webben binds till127.0.0.1:3002 och använder
befintlig .next-local-demo; kontrollera först att gammal manuell server inte
kör. Nya credentials läggs i separata privata0600filer, inte i originalets
strikta trerollersmanifest. Ingen ny teknik, domängräns eller authmodell;
tidigare demo-/rättnings-ADR gäller, inget nytt ADR-beslut behövs.

## Acceptans

1. Verifiera nytt mål, migrationsversion, syntetiskt innehåll och tom journal.
2. Utfärda separata kortlivade VIEW_START_LIST/CHANGE_ENTRY_IDENTITY via CLI
   till avsiktligt privat stdout; inga tokenvärden i logg eller guide.
3. Lokal server svarar; privata API ger401 utan auth,200 med rätt roll och
   no-store. Fel roll ger inte rättningsrätt. Ingen provmutation i manuellt
   underlag behövs eftersom TASK026:s riktiga browserkedja redan är verifierad.
4. Ge användaren verifierad URL och kort guide för val/granska/spara/historik,
   giltighet, återstart utan seed och stopphantering.

Detta är en drift-/provisioneringsuppgift med befintlig kod, inte nya
tävlingsregler. Använd proportionerliga readinesskontroller, inte ny full
workspace-/hårdvarusvit. Funktionen är bara åtkomlig på denna dator.

Status: avgränsat klar. Ny cluster55441 och webb3002 kör, 42migrationer,
ett lopp/två entries/tom rättningsjournal verifierade. Befintlig demo-CLI och
separata roll-CLI:er exit0, privata filer0600 i0700katalog. HTTP401/200,
fel roll401, logout204 och no-store verifierade utan provmutationer.
Se docs/local-demo-20260909.md för länk, privata filvägar, giltighet och
återstart. Ingen produktkod ändrad; TASK026:s tidigare bygg-/testbevis gäller.
Huvudmål/MeOS-paritet och produktion är inte klara.
