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

## Följder

- Migration 0072 (endast tillägg): `user_account_google_identity`.
- Beroende: `jose` (JWKS och JWT) i `@o-tid/application`.
- Drift: Google-klienten skapas i Google Cloud Console (docs/drift.md).
