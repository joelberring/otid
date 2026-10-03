# ADR-0162: automatisk lokal utvecklingsåtkomst

Status: accepterad 2026-09-24, efter uttrycklig användarbegäran. Före kod.

Utgången demobehörighet ska inte hindra UI-utveckling. En separat serverflagga
`O_TID_DEV_AUTO_LOGIN_RACE_ID` väljer exakt ett lokalt demolopp. Endast
NODE_ENV=development, explicit HTTP-loopback-origin och lokal PostgreSQL
med `otid_demo_`-namn får använda en ny POST för automatisk session.
Begäran måste ha samma exakta Origin och Host som konfigurationen. Faktiskt
databasnamn kontrolleras före utfärdning; servern ska bindas till loopback,
aldrig exponeras genom proxy eller på nätet.
Nexts interna `request.url` kan normaliseras till ett annat servervärdnamn;
den används därför inte som ersättning för inkommande Host/Origin.

Åtkomsten återanvänder befintlig credentialutfärdning, inloggning, audit,
sessioncookie och CSRF. Inga API-writers hoppar över autentisering. Ingen
hemlighet bäddas in i klienten, loggas eller skickas i URL. Produktion,
testläge, andra lopp och fjärrdatabaser är alltid spärrade. Giltig befintlig
session återanvänds; annars skapas vanlig kortlivad MANAGE_RACE-behörighet.
Sidan öppnar sessionen automatiskt. Efter utgång kan sidan laddas om eller
öppnas med en knapp, utan att ange någon nyckel. Pågående handlingar behåller
befintlig spärr vid utgång; inga osäkra writes återspelas automatiskt.

Detta kompletterar ADR-0057:s förbud mot generell auth-avstängning:
produktionsauth stängs inte av och demon provisioneras inte om. Bara privata
åtkomst-/sessions-/auditrader får tillkomma, inte tävlingsdata eller migration.
Flaggan sparas lokalt i ignorerad `.env.local` och tas bort för att stänga av.
