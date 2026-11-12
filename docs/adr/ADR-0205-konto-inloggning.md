# ADR-0205: Bekräftelselänken väljer lösenord, återställning loggar in och inloggning med Google

Status: beslutad 2026-11-03 (grenen `konto-inloggning`). Ändrar ADR-0186 beslut 9 (bekräftelselänken) och ADR-0172 beslut 1
("Inloggning med Google … Inte nu").

## Bakgrund

På ett klubbmöte 2026-11-03 skrev en person fel lösenord när kontot skapades. Han fick ett bekräftelsemejl och ett
återställningsmejl och kom ändå aldrig in:

1. Bekräftelselänken krävde lösenordet från registreringen (ADR-0186), som han inte kände till. Sidan sa "ogiltig länk …
   eller så stämmer inte lösenordet. Logga in … så skickar vi en ny länk", och inloggningen med det lösenord han trodde han
   valt sa "Öppna länken i mejlet först". Ingen ny länk kom, eftersom lösenordet var fel.
2. Efter fem försök spärrades adressen från hans IP-adress i 15 minuter (ADR-0189 beslut 7). Återställningen bekräftade
   adressen, men nollställde bara spärrens nyckel utan IP-adress, så inloggningen med det nya lösenordet gav "För många
   misslyckade försök". Den gamla bekräftelselänken sa fortfarande "ogiltig". Han fastnade mellan sidorna.

## Beslut

1. **Bekräftelselänken bevisar adressen; personen väljer lösenord.** Sidan bakom länken ber om lösenordet två gånger
   ("Lösenord", "Upprepa lösenordet"); det får vara samma som vid registreringen eller ett nytt. Kontot får det lösenordet,
   adressen blir bekräftad, öppna inbjudningar tas och kontot loggas in. Skyddet i ADR-0186 består: det lösenord som gäller
   efter bekräftelsen är alltid det som den som har länken skrev, aldrig ett som någon annan valde vid registreringen.
   En länk till ett konto som redan är bekräftat säger det och visar inloggningen; en gammal eller använd länk till ett
   obekräftat konto leder till "Glömt lösenordet", som också bekräftar adressen.
2. **Återställningslänken loggar in.** Den fungerar alltid för ett obekräftat konto, bekräftar adressen, tar öppna
   inbjudningar, förbrukar kontots bekräftelselänkar och loggar in på enheten där länken öppnades.
3. **Ett nytt lösenord häver inloggningsspärren** för adressen: är spärren satt och lösenordet bytt efter att felen började
   räknas, gäller spärren inte (också spärren per IP-adress för just det försöket). Spärren skyddar mot gissning; den som
   har bytt lösenord via e-posten gissar inte.
4. **Lösenordet två gånger** vid registrering, återställning, bekräftelse och byte, med besked direkt om fälten skiljer sig och
   en knapp som visar lösenordet.
5. **Logga in med Google** (OpenID Connect, kodflöde med PKCE, `state` och `nonce`; ID-token kontrolleras mot Googles JWKS med
   `iss`, `aud` och `exp`) när `OTID_GOOGLE_CLIENT_ID` och `OTID_GOOGLE_CLIENT_SECRET` är satta. Adressen godtas bara med
   `email_verified`. Ett konto med samma adress kopplas till Google-kontot (`sub`, migration 0072) och adressen blir bekräftad;
   var kontot obekräftat byts lösenordet mot ett slumpat (samma skydd som beslut 1), annars behålls det. Utan konto skapas ett
   med Googles namn och ett slumpat lösenord som ingen känner till; ett eget lösenord väljs med "Glömt lösenordet". Ett spärrat
   konto förblir spärrat. Sessionen och inbjudningarna fungerar som vid inloggning med lösenord.
6. **Samma steg efter varje inloggning.** Lösenord, bekräftelselänk, återställningslänk och Google går genom samma funktion
   (`acceptOnLogin`): öppna inbjudningar tas (ADR-0188 beslut 6) och adressen jämförs med klubbarnas medlemslistor från Eventor
   (ADR-0209 beslut B). Båda kräver bekräftad adress, så ett obekräftat konto får inget förrän en länk eller Google har
   bekräftat den.

## Följder

- Migration 0072 (endast tillägg): `user_account_google_identity`.
- Beroende: `jose` (JWKS och JWT) i `@o-tid/application`.
- Drift: Google-klienten skapas i Google Cloud Console (docs/drift.md, Inloggning med Google); `OTID_GOOGLE_CLIENT_ID` och
  `OTID_GOOGLE_CLIENT_SECRET` i `.env`. Återkomstadressen är `{O_TID_PUBLIC_ORIGIN}/api/account/google/callback`.
- Tester: `adr-0205-konto.test.ts` (ordningarna från mötet och en falsk OpenID-leverantör), ett fall i
  `adr-0209-klubbtillhorighet.test.ts` (medlemslistan vid Google och återställning) och `tests/e2e/konto-inloggning.spec.ts`
  (mejlen ur den falska SMTP-servern, länkarna i andra webbläsare).

## Tillägg 2026-11-04: Koppla Google-konto, kontomenyn och utloggning (grenen `google-koppla`)

Ägaren loggade in med Google, vars adress (Gmail) skiljer sig från kontots (joel@berring.se). Beslut 5 kopplar bara ett konto
med samma adress, så Google skapade ett andra konto. Ägaren hittade heller ingen "Logga ut" utanför tävlingens arbetsyta, och
loggar in på klubbens och tävlingens lånade datorer.

7. **Koppla Google-konto under Mitt konto.** Inloggad startar man OpenID-flödet i läget `link` (state, nonce och PKCE som förut);
   kakan med state bär också sessionens id, så återkomsten bara gäller inloggningen som började den. Sessionens kakor är
   SameSite=Strict och följer inte med navigeringen från Google, så återkomsten går först vidare till sig själv från O-Tids egen
   sida (`steg=2`). Google-kontot (`sub`) kopplas till det aktuella kontot även om Googles adress är en annan; adressen måste vara
   bekräftad hos Google (`email_verified`). Kontots adress ändras inte. Googles adress sparas med kopplingen (migration 0082, en
   kolumn som får vara tom; äldre rader får den vid nästa inloggning) och visas under Mitt konto med "Ta bort kopplingen".
   Borttagningen vägras om kontot då saknar sätt att logga in: inget lösenord som någon känner till. Ett slumpat lösenord från
   beslut 5 känns igen på att lösenordsversionen har samma tidpunkt som kopplingens `linked_at` (samma transaktion); ett lösenord
   som valts efteråt är nyare. Därför står `linked_at` kvar när kopplingen byter Google-konto.
8. **Kopplat till ett annat konto.** Är det andra kontot tomt flyttas kopplingen efter en sida som säger vad som händer och en
   bekräftelse med lösenordet (utan känt lösenord: en inloggning de senaste tio minuterna). Det tomma kontot tas sedan bort som
   när kontot själv tas bort (sessionerna spärras, raderna följer främmande nycklar) och det loggas i superadmins logg
   (`DELETE_ACCOUNT`, med kontot som gjorde det som utförare). Den påbörjade flytten ligger i en signerad HttpOnly-kaka (tio
   minuter, bunden till sessionen). "Tomt" betyder att ingen annan rad pekar på kontot (kolumner `…account_id` och `…_by` i alla
   tabeller utom inloggningens egna och svaret på "Vilken klubb tillhör du?"), och att det inte är superadmin eller spärrat. Nya
   tabeller räknas alltså med. Avvikelse från uppdraget: kontots egna sessioner räknas inte, eftersom den som just bevisat
   Google-kontot ändå kan logga in på det; de spärras vid flytten. Väntande inbjudningar till adressen lämnas; de gäller adressen.
   Används kontot vägras kopplingen ("… Logga in på det och ta bort kopplingen där först"); superadmin kan flytta med
   `node superadmin.mjs google move <källa> <mål> [--delete-source-if-empty]` (docs/drift.md).
   Ändrat 2026-11-07: kontots egna klubbsvar (`account_club_membership` utan `decided_by`, alltså väntande eller bekräftade via
   Eventors medlemslista) räknas också som tomt och tas bort med dubbletten; bara en tillhörighet som ett klubbarkiv har avgjort
   för hand gör att kontot används. Används ett konto utan eget lösenord säger beskedet i stället att man först väljer ett med
   Glömt lösenordet till det kontots adress, loggar in där och tar bort kopplingen (`?google=upptaget-utan-losenord`); kopplingen
   flyttas inte från ett konto som används.
9. **Kontomenyn.** Varje inloggad sida har namnet (initialerna på telefonen) i överlisten med Mina tävlingar, Mina klubbar, Mina
   grupper, Mitt konto och Logga ut. Utloggningen spärrar sessionen (samma route som förut), tar bort det som webbläsaren sparat om
   tävlingar och personer (banläggningens kopia med service workerns sidor, inbjudan, följda löpare, självregistreringens namn och
   flikarnas `otid…` i sessionStorage) och visar "Du är utloggad." på inloggningen. Väntar ändringar på nät frågar menyn först
   ("2 ändringar väntar på nät – logga ut ändå?"). Avläsningarnas och festens köer tas aldrig bort (AGENTS.md); de räknas i
   varningen och ligger kvar tills servern har kvitterat dem. "Logga ut från alla enheter" under Mitt konto spärrar alla sessioner.
10. **Kom ihåg mig på den här datorn**, av som förval: utan den gäller inloggningen tolv timmar och kakan är en sessionskaka; med
    den 30 dygn som förut (ADR-0168). Valet följer med till Google (`?remember=1`) och behålls vid lösenordsbyte. Andra vägar in
    (bekräftelse- och återställningslänken, registreringen) ger som förut 30 dygn.

Följder: migration 0082 (endast tillägg); `google-link.ts` i `@o-tid/application`; rutterna `/api/account/google/link`, `/move`,
`/unlink` och `/api/account/logout-all`; sidan `/konto/flytta-google`. Tester: `adr-0205-google-koppla.test.ts` (koppling med annan
adress, obekräftad adress, flytt, vägran, sista inloggningssättet, bindningen till sessionen, superadmins kommando, Kom ihåg mig och
alla enheter), `google-route-handlers.test.ts` (läget link) och `tests/e2e/konto-meny.spec.ts` mot en falsk OpenID-leverantör
(`tests/e2e/fake-google.ts`; webben pekas dit med `OTID_GOOGLE_BASE_URL` och `OTID_GOOGLE_AUTHORIZE_URL`, endast test).

Ändrat 2026-11-07 (städrundan, grenen `a1-sakerhet`, migration 0084): en ny registrering av en obekräftad adress skriver över
kontots visningsnamn, och mejlet hälsar med namnet från den registreringen. Bekräftelselänken minns sitt namn
(`email_verification_token.display_name`); den som öppnar länken får namnet från sin egen registrering. `created_at` skyddas av
databasen och står kvar. Utloggningen (`/api/organizer/logout`) kräver exakt Origin och sessionskakan men inte CSRF-kakan, så att
sessionen alltid spärras på servern; "Du är utloggad" visas först när servern svarat (annars ett fel). "Från alla enheter" kräver
CSRF som förut.

Ändrat 2026-11-07 (städrundan, grenen `d-smafixar`, ägarens beslut "dubbelinloggning med Google verkar ok om det beskrivs
tydligt"): ett konto som bara loggar in med Google (inget känt lösenord, en Google-koppling) tar bort sig självt under Mitt konto
med en ny inloggning hos Google i stället för lösenordet. `POST /api/account/google/delete` börjar en inloggning med
`prompt=login` och `max_age=0`, bunden till sessionen och syftet `delete` i den kortlivade kakan (som läget `link`). Efter
återkomsten (`steg=2` från O-Tids egen sida) prövas att det är samma session, att `sub` är kontots koppling och att `auth_time` är
högst fem minuter gammal (`deleteAccountConfirmedWithGoogle`); sedan samma regler som med lösenordet, också att den som ensam
äger en klubb eller leder en grupp lämnar över först. Ett konto med eget lösenord bekräftar som förut med lösenordet.

## Tillägg 2026-11-12: lösenordet två gånger räcker (grenen `claude/r3-b`, migration 0115)

Ägarens beslut "två gånger räcker": i dag skrevs lösenordet två gånger i "Skapa konto" och två gånger till bakom
bekräftelselänken (beslut 1). Varför länken frågar: den som registrerar en adress väljer ett lösenord utan att visa att adressen
är hens. Om länken bara bekräftade adressen skulle det lösenordet gälla, och den som registrerat någon annans adress (och känner
lösenordet) skulle få ett bekräftat konto med ägarens inbjudningar och behörigheter. Beslut 1 löste det genom att lösenordet
alltid väljs av den som har länken.

11. **Samma webbläsare: registreringens lösenord gäller.** Registreringens svar (med e-post på servern) sätter alltid, oavsett om
    adressen finns, en kaka med en ny slumpad hemlighet: `__Host-otid-registration` (lokalt `otid_registration`), 32 byte,
    HttpOnly, SameSite=Strict, Secure i drift, en timme. Arbetet efter svaret sparar med den nya bekräftelselänken hemlighetens
    sha256 och verifieraren för lösenordet som skrevs i formuläret (`browser_secret_hash`, `salt_hex`, `verifier_hex`; migration
    0115). Bekräftelsesidan frågar servern som förut; när kakans hemlighet hör till just den länken och länken är högst en timme
    gammal svarar servern `sameBrowser`, och sidan visar "Du skapade kontot i den här webbläsaren …" med knappen "Bekräfta och
    logga in" (och "Välj ett annat lösenord", som visar fälten). `POST /api/organizer/verify-email` utan `password` ger kontot
    registreringens verifierare (en ny lösenordsversion om den skiljer sig från kontots), bekräftar, spärrar andra sessioner, tar
    inbjudningarna och loggar in som beslut 1; kakan tas bort. Stämmer inte kakan svarar servern 403 och sidan ber om lösenord.
12. **Varför det är lika säkert.** Bekräftelsen kräver både länken (bara adressens ägare har mejlet) och kakan (bara webbläsaren
    som skrev lösenordet har den; HttpOnly och `__Host-`). Bindningen gäller registreringen som skapade länken, aldrig kontots
    lösenord: har någon annan registrerat adressen tidigare har kontot den personens verifierare, men ägarens länk bär ägarens.
    - *Annan webbläsare* (telefonen, en annan dator): ingen kaka, lösenordet väljs som förut (beslut 1).
    - *Någon annan registrerade adressen*: den personen har en kaka men inte mejlet; ägaren har mejlet men en annan (eller ingen)
      kaka. Den andras länk i ägarens webbläsare ber om lösenord, och ägarens egen registrering ger ägarens lösenord.
    - *Inbjuden utan konto*: "Skapa konto" från inbjudningslänken är en vanlig registrering; i samma webbläsare tas inbjudan när
      länken öppnas, utan nytt lösenord. ADR-0206 beslut 4 står kvar: bekräftelsen hoppas inte över, och den som kopierade
      inbjudningslänken (`delivery = LINK`) har inte bekräftelsemejlet.
    - *Google*: oförändrat (beslut 5). Inloggning med Google, återställningen och superadmins bekräftelse förbrukar länkarna och
      tömmer kopiorna, så kakan ger inget efteråt.
    - *Lånad dator*: om någon annan registrerat ägarens adress på samma webbläsare och ägaren sedan öppnar bekräftelsemejlet där,
      gällde den andras lösenord. Därför gäller kakan bara en timme, sidan säger att lösenordet från registreringen i den här
      webbläsaren gäller och erbjuder "Välj ett annat lösenord", och den som ändå hamnat där kan välja nytt med Glömt lösenordet
      (som spärrar alla sessioner). Den som delar webbläsare med någon som vill illa kan redan i dag få sin session läst.
    - *Fel lösenord två gånger vid registreringen* (mötet 2026-11-03) i samma webbläsare: lösenordet gäller som det skrevs;
      dubbelinmatningen och "Visa lösenordet" (beslut 4) gör det ovanligt, och Glömt lösenordet fungerar som förut.
13. **Lösenordet skrivs alltså två gånger** i det vanliga fallet (registrering och länken i samma webbläsare inom en timme) och
    fyra gånger när länken öppnas någon annanstans eller senare. Registreringens besked, mejlet och hjälpen säger det.

Valt bort: (a) att länken alltid bekräftar och registreringens lösenord gäller (skyddet i beslut 1 försvinner); (b) att länken
frågar efter registreringens lösenord en gång (ADR-0186 före ADR-0205; den som skrev fel kom inte in); (c) att binda till "inloggad"
i stället för till registreringen (ett obekräftat konto loggas inte in med e-post på servern, och en session säger inget om vem
som skrev lösenordet för just den länken); (d) att binda en inloggning med rätt lösenord på ett obekräftat konto (det mejlet får en
länk utan bindning, som förut).

Följder: migration 0115 (bara tillägg: kolumnen `browser_secret_hash` med formvillkor; `salt_hex`/`verifier_hex` från 0040, nullbara
sedan 0087, används igen och tas inte bort – ändrar ADR-0186 beslut 9, ändringen 2026-11-07, och idén om steg 2 i STATUS.md). Kolumnerna
töms när länkarna förbrukas. Tester: `adr-0205-samma-webblasare.test.ts` (samma webbläsare, annan och fel kaka, efter en timme,
någon annan registrerade först, inbjuden, Google och återställningen), `organizer-account-route-handlers.test.ts` (kakan vid
registreringen, bekräftelsen och kontrollen), `tests/e2e/konto-inloggning.spec.ts` (ny: samma webbläsare och någon annans
registrering) och hjälparna i `tests/e2e/helpers.ts` (`registerAccount` bekräftar i samma kontext utan lösenord).

