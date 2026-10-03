# ADR-0102: aktuell provbar demo använder befintlig gemensam administratör

- Status: Accepterad för TASK078
- Datum: 2026-09-19
- Ersätter endast ADR-0057:s exakta antal demobehörigheter och sammanfattningslänkar.

## Kontext

Den isolerade syntetiska demon provisionerar atomiskt ett lopp och tre
begränsade roller, men ger ingen ingång till den senare accepterade gemensamma
`MANAGE_RACE`-vyn. Båda importerade klasserna får dessutom `PUNCH`, så en ny
operatör kan inte prova det avsedda blandade upplägget med fri start och
minutstart utan separat handbyggd data.

ADR-0069 har redan accepterat den racebundna `MANAGE_RACE`-rollen och dess
session. IOF StartList-import, klasskapacitet och klass-/starttidsbyte är också
befintliga domänflöden. Problemet är därför demonstrationsunderlag och åtkomst,
inte en ny produktionsroll eller arkitektur.

## Beslut

Den befintliga betrodda `demo:provision` återanvänds. Ingen ny route, auth-
bypass eller demotjänst skapas.

- Det privata mode-0600-manifestet utökas med exakt en befintlig,
  entimmeslång, racebunden `MANAGE_RACE`-credential. Den omfattas av samma
  privata output, scope-, identitets- och livslängdsvalidering som de tre
  befintliga rollerna och får aldrig skrivas till stdout, URL eller logg.
- Den hemlighetsfria sammanfattningen får en scopebunden `/manage`-path.
- Repositoryägda demo-specifika IOF-fixtures ger Ada en `PUNCH`-klass och Bo
  en annan klass som blir `FIXED` genom den befintliga StartList-importen.
  Tävlingsdatum och starttid är fasta syntetiska värden för reproducerbarhet.
- Den fasta målklassen får initialt `maxEntries = 2` och ordinarie
  `capacityVersion = 1` inom samma tomma demotransaktion. Detta är en del av
  den ursprungliga syntetiska installationen, inte en dold produktionsmutation
  eller en ersättning för den journalförda adminskrivvägen.
- Det befintliga TASK007-browserprovet utökas med gemensam admininloggning,
  sökning, synlig kapacitet och ett verkligt klass-/starttidsbyte. Ingen andra
  bred demosvit skapas.

## Konsekvenser

Demon blir enklare att prova och visar samma gemensamma arbetsyta som dagens
produktkod. `MANAGE_RACE` är bredare än de gamla tre rollerna och manifestet
ska därför fortsatt delas endast med avsedd lokal testoperatör. Produktion,
fjärråtkomst och generell användaradministration påverkas inte.

Demo-fixtures är inte Eventordata och påstår inte fysisk SPORTident-, mobil-
eller produktionsverifiering. Klassbyte räknar inte automatiskt om gamla
resultat; browserflödet utför därför bytet före den syntetiska avläsningen.

## Avvisade alternativ

- En ny anonym demoroute avvisas eftersom den skulle kringgå befintlig auth.
- Separata manuella CLI-steg för varje provning avvisas som onödigt svåra när
  samma privata manifest redan är den etablerade överlämningsytan.
- Påhittat `startRule` i CourseData avvisas; startregeln sätts genom stödd IOF
  StartList.
- Ändring av de generella IOF-fixtures som används av andra tester avvisas;
  demon får egna syntetiska filer.
