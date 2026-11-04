# ADR-0206: Inbjudningar med e-post

Status: beslutad 2026-11-03 (grenen `inbjudan-mejl`, migration 0073, ägarens önskemål samma dag). Bygger på ADR-0188 beslut 6,
ADR-0189 beslut 9 och ADR-0194 beslut 1 (behörigheter sparade per e-postadress) och ADR-0186 (bekräftad e-post). Ändrar inget i
dem.

## Bakgrund

En administratör lägger till en person med e-postadressen i klubbarkivets Medlemmar, under tävlingens Personer med behörighet
(också banläggningens roller och kartritaren) och i träningsgruppens Ledare och medlemmar. Inbjudan sparas för adressen och blir en
behörighet när ett konto med adressen och bekräftad e-post loggar in. Men inget mejl skickades, så den inbjudna visste inte om det.

## Beslut

1. **Ett mejl per inbjudan när e-post finns.** Med `OTID_SMTP_URL` mejlas varje ny inbjudan direkt (efter att den sparats, i samma
   anrop). Mejlet är vanlig svenska och innehåller bara den inbjudandes visningsnamn, klubbens, tävlingens (med datum) eller gruppens
   namn, rollen i ord ("administratör", "funktionär", "banläggare – kan ändra" …) och en länk. Inga andra personuppgifter.
   Mejlet går till adressen oavsett om den har ett konto, så att svaret och mejlet inte avslöjar något (ADR-0188 beslut 6).
2. **Länken** är `/inbjudan#token=…`: 32 slumpade byte (base64url) efter #, så att nyckeln inte hamnar i serverns loggar. Bara
   nyckelns sha256 sparas (`invitation_link`, som återställnings- och bekräftelselänkarna). Länken gäller 14 dagar. Länksidan
   frågar `POST /api/invitation` med nyckeln i kroppen och visar vem som bjudit in, till vad och som vad, och två knappar:
   "Skapa konto" (registreringen med adressen ifylld och låst) och "Logga in" (inloggningen med adressen ifylld). Okänd, ersatt,
   för gammal och återkallad länk ger samma svar: "Inbjudan gäller inte längre". Sidan ser likadan ut oavsett om adressen har ett
   konto; en redan tagen inbjudan visas som en öppen.
3. **Länken ger ingenting.** Behörigheten kommer som förut bara när ett konto med exakt adressen och bekräftad e-post loggar in,
   bekräftar adressen eller öppnar klubben, gruppen eller tävlingen. Efter inloggningen eller bekräftelsen hamnar personen på
   klubben, gruppen (ledare), tävlingen eller banläggningen (banläggare och kartritare). Vart sparas i webbläsaren
   (localStorage, ett dygn, bara en sökväg i O-Tid), eftersom bekräftelselänken ofta öppnas i en ny flik. Utan den hamnar personen
   på Mina tävlingar, där klubben eller tävlingen syns.
4. **Bekräftelsen hoppas inte över.** Vi valde bort att en registrering via en giltig inbjudningslänk markerar adressen som
   bekräftad, fast nyckeln mejlades till adressen: (a) utan e-post kopierar administratören länken själv och känner då nyckeln,
   och en bekräftad adress skulle ge administratören alla inbjudningar som andra sparat för adressen; (b) en direkt inloggning för
   ett nytt konto men inte för ett befintligt skulle visa den som har länken (t.ex. ett vidarebefordrat mejl) om adressen har ett
   konto; (c) en enda väg för bekräftelse (ADR-0186) är lättare att granska. Kostnaden är ett mejl till och ett lösenord till vid
   bekräftelsen.
5. **Spärrar mot skräppost.** Per avsändare högst 100 mejl i timmen och 300 per dygn; per mottagare (alla avsändare) högst 3 i
   timmen och 10 per dygn; "Skicka igen" tidigast 10 minuter efter förra skickade mejlet till samma inbjudan; kopierade länkar
   högst 100 i timmen per avsändare. Raderna i `invitation_link` är räknarna; mottagaren lagras bara som HMAC (samma hemlighet som
   kontospärrarna). En spärrad inbjudan sparas ändå och visas som "inte skickad". Namn från användare (klubbens, tävlingens) står i
   mejlet utan radbrytningar och styrtecken.
6. **Listorna.** Öppna inbjudningar visar när de senast mejlades ("skickad 3 nov. 14:02" eller "inte skickad") och "Skicka igen"
   (ny nyckel; de tidigare länkarna slutar gälla). Utan e-post på servern står "Kopiera länken" i stället: en ny länk kopieras (och
   visas i ett fält) så att administratören kan skicka den själv; tidigare kopierade länkar gäller kvar. Samma regler som för att ta
   bort: en ägarinbjudan i klubben och en administratörsinbjudan på tävlingen bara av ägaren. Att ta bort inbjudan gör alla dess
   länkar ogiltiga.
7. **Flera adresser på en gång.** Fältet tar adresser åtskilda med komma, semikolon, mellanslag eller ny rad (också "Namn
   <adress>"), högst 100, alla med samma roll. Varje adress blir en egen inbjudan med eget mejl (en begäran per adress, som förut);
   sammanfattningen säger till exempel "5 inbjudningar skickade, 1 adress var ogiltig".

8. **"Från klubben" (ADR-0209).** Inbjudningar som skapas genom väljaren går samma väg som när adressen skrivs in och mejlas
   från servern med samma text. Adressen står aldrig i svaret eller i listorna (namnet visas). Sådana inbjudningar kan bara
   mejlas ("Skicka igen"), inte kopieras: länksidan visar adressen, och den som har en kopierad länk är den som bjöd in. Utan
   e-post på servern visas ingen knapp; personen har redan ett konto och får behörigheten nästa gång hen loggar in.

## Konsekvenser

- Migration 0073 (bara tillägg): tabellen `invitation_link` med nyckel till en av de tre inbjudningstabellerna och till kontot
  som skickade, så att raderna tas bort med dem (purge.ts).
- Klubbens roller i mejlet följer ADR-0209: ägare, administratör, ledare och medlem (`READER`). Tävlingens lista (Personer med
  behörighet) har både funktionärer, administratörer och banläggningens roller med kartritaren.
- Nya anrop: `POST /api/invitation`, `POST /api/organizer/clubs/{id}/invitations/{id}`,
  `POST /api/organizer/groups/{id}/invitations/{id}` och `POST /api/admin/races/{id}/administrator/people/invitations/{id}`
  (`{ delivery: "MAIL" | "LINK" }`; tävlingens går genom arbetsytans route, så rollen prövas innan begäran tolkas). Svaren på "Lägg till"/"Bjud in" har `mail` (sent, failed, throttled, off); listorna har
  `sentAt` och `mailEnabled`.
- Utan e-post är allt som förut, plus "Kopiera länken".
