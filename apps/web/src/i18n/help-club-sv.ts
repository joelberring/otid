import { EVENTOR_KEY_PLACE } from "./club-affiliation-sv";
import type { HelpArticle } from "./help-sv";

/** ADR-0209: hjälpen om klubbtillhörighet – Mina klubbar, klubben i Eventor, bekräfta, bjuda in från klubben och klubbarkivet. */
export const clubHelpArticles: readonly HelpArticle[] = [
  {
    id: "mina-klubbar",
    title: "Mina klubbar",
    views: ["EVENTS"],
    body: [
      "När du har skapat ett konto frågar O-Tid vilken klubb du tillhör. Det är frivilligt: välj ”Hoppa över” om du inte vill svara nu.",
      [
        "Sök på klubbens namn eller förkortning, till exempel älvsjö eller okäö, och välj klubben i listan. Du kan välja flera.",
        "Finns inte klubben i listan: skriv namnet under ”Annan klubb”.",
        "Spara med ”Spara klubbarna”. Du ändrar senare under ”Mitt konto” → ”Mina klubbar”."
      ],
      "Att du väljer en klubb ger dig ingenting i O-Tid förrän klubben har bekräftat dig. Har klubben kopplat sin klubbyta till Eventor och din e-postadress finns i klubbens medlemslista där, är du bekräftad direkt.",
      "Har ingen från klubben startat en klubbyta än visas ”Starta klubbytan”. Det är till för den som är administratör i Eventor: se [Koppla klubbytan till Eventor](#klubben-i-eventor)."
    ]
  },
  {
    id: "klubben-i-eventor",
    title: "Koppla klubbytan till Eventor",
    views: ["ARCHIVE_CLUB"],
    body: [
      "Klubbytan visar ”Inte kopplad till Eventor” tills klubbens egen API-nyckel från Eventor är inlagd. Bara en administratör i klubben i Eventor kan skapa nyckeln, så kopplingen visar att klubbytan är klubbens.",
      { steps: [
        `Hämta klubbens API-nyckel. Den finns i Eventor under ${EVENTOR_KEY_PLACE}. Har du den inte: se [Kom igång med klubbytan](#klubbytan-kom-igang).`,
        "Öppna klubbytan och fliken ”Klubben”.",
        "Klistra in nyckeln under ”Klubbens API-nyckel” och välj ”Koppla till Eventor”.",
        "Låt rutan om klubbens namn vara ikryssad, så heter klubbytan som klubben i Eventor.",
        "O-Tid frågar Eventor vilken klubb nyckeln hör till och hämtar medlemslistan. Medlemmar med samma adress i O-Tid blir bekräftade.",
        "Listan hämtas igen en gång per dygn. Vill du hämta den direkt: ”Hämta medlemmar nu”. Se också [Bekräfta medlemmar](#bekrafta-medlemmar)."
      ] },
      "Nyckeln sparas krypterad och visas aldrig igen, bara de sista fyra tecknen. Av medlemslistan sparas bara Eventors person-id och ett oläsbart avtryck av e-postadressen, inga namn eller andra uppgifter. Med ”Byt nyckel” lägger du in en ny nyckel och med ”Ta bort kopplingen” tas nyckeln och listan bort.",
      "En klubb i Eventor kan bara kopplas till en klubbyta. Är den redan kopplad: kontakta ägaren av den klubbytan."
    ]
  },
  {
    id: "klubbytan-kom-igang",
    title: "Kom igång med klubbytan",
    views: ["ARCHIVE_TRAININGS", "ARCHIVE_CLUB"],
    body: [
      "Ägare och administratörer ser ”Kom igång” överst i klubbytan tills den är kopplad till Eventor och har minst en karta. Du kan också välja ”Dölj”.",
      [
        "Koppla klubben till Eventor med klubbens API-nyckel. Det är nästa steg i en ny klubbyta.",
        "Bjud in fler ledare och administratörer under ”Medlemmar”.",
        "Ladda upp kartor under ”Kartor” eller importera arkivet under ”Import”.",
        "Välj under ”Vem ser vad”. Förvalet är ”Alla medlemmar”."
      ],
      "Har du inte nyckeln: välj ”Be klubbens Eventor-administratör koppla”. Du får en färdig text att kopiera eller öppna i e-post. Den säger vad O-Tid är, var nyckeln finns i Eventor och var den klistras in.",
      "Bjud in personen som ”Administratör” under ”Medlemmar”, så klistrar hen in nyckeln själv. Texten har ingen nyckel, och nyckeln ska aldrig skickas i mejl."
    ]
  },
  {
    id: "klubbens-enheter",
    title: "Läsa ut och ställa in enheter, och klubbens enhetsregister",
    views: ["ARCHIVE_DEVICES", "READOUT_PAGE"],
    body: [
      "Under avläsningen finns ”Läs ut enheter”: sätt en SPORTident-enhet i masterstationen så läser O-Tid systemdata, klocka och backupminnet med löparna.",
      [
        "”Ställ in enheten” ställer klockan efter datorn, koden och läget. Enheten läses igen och sidan visar före och efter.",
        "Välj klubb på sidan, så sparas varje utläst eller inställd enhet i klubbens register.",
        "Fliken ”Enheter” i klubbytan visar enheterna med serienummer, kod, läge, batteriets ålder, klockans fel och en anteckning."
      ],
      "Inställningen är provad bara mot en falsk enhet. Prova på några enheter först och spara råloggen från sidan om något ser fel ut."
    ]
  },
  {
    id: "bekrafta-medlemmar",
    title: "Bekräfta medlemmar och Vem ser vad",
    views: ["ARCHIVE_CLUB", "ARCHIVE_MEMBERS"],
    body: [
      "Under fliken ”Klubben” ser ägare och administratörer vilka som väntar på bekräftelse. Det är de som har valt klubben men vars adress inte fanns i Eventor, och de som skrev ett liknande namn under ”Annan klubb”.",
      [
        "”Bekräfta”: personen blir medlem i klubbytan. Bekräfta bara den du vet är med i klubben.",
        "”Avböj”: personen får inget, och ser att klubben inte har bekräftat.",
        "”Ta bort” vid en bekräftad medlem tar bort det personen ser i klubbytan.",
        "Slutar någon i klubben i Eventor försvinner det som Eventor gav vid nästa hämtning. Bekräftelser för hand står kvar.",
        "Listan Medlemmar i klubben är tillhörigheten (Eventor eller för hand). Rollerna står under ”Medlemmar”."
      ],
      "Rollerna är ”Medlem”, ”Ledare”, ”Administratör” och ”Ägare”. Ledare sätts av en administratör i listan under ”Medlemmar” (Behörigheter i klubbytan) eller när man bjuder in.",
      "Under ”Vem ser vad” väljer klubben vem som ser träningsarkivet och vem som får använda kartbanken (kartfiler, Använd igen, nedladdning). Förvalet för båda är ”Alla medlemmar”; välj ”Ledare och admin” om kartorna inte ska delas med alla medlemmar. Ägare och administratörer ser och använder alltid allt. För medlemmar och ledare gäller kartans egna rättigheter också; den strängaste vinner."
    ]
  },
  {
    id: "bjud-in-fran-klubben",
    title: "Bjuda in från klubben",
    views: ["SETTINGS", "ARCHIVE_MEMBERS"],
    body: [
      "Där du kan lägga till personer, under ”Personer med behörighet” i en tävling, i klubbytan och i en träningsgrupp, finns ”Från klubben”. Där finns de bekräftade medlemmarna i dina klubbar som har O-Tid.",
      [
        "Sök på namnet och kryssa i en eller flera.",
        "Välj roll och bjud in. Inbjudan går till personens adress, som du aldrig ser.",
        "Personen tar inbjudan som vanligt, genom mejlet eller när hen loggar in.",
        "I klubbytan gäller rollen direkt för den du väljer i listan."
      ],
      "Du kan fortfarande skriva en e-postadress som förut. Den som inte är bekräftad medlem i någon av dina klubbar syns inte i listan."
    ]
  },
  {
    id: "tavling-i-klubbarkivet",
    title: "Lägga en tävling i klubbarkivet",
    views: ["SETTINGS", "RESULTS", "ARCHIVE_TRAININGS"],
    body: [
      "Under ”Inställningar” → ”Klubben och klubbarkivet” väljer du tävlingens ”Arrangörsklubb”. Förvalet är din bekräftade klubb. Före tävlingen visas ingenting om tävlingen för klubben, bara för dem som har behörighet på tävlingen.",
      "När tävlingen är klar visar arbetsytan en påminnelse. ”Lägg i klubbarkivet” gör en träning i klubbens arkiv med kartfilen, banläggningen (.ppen), banorna (IOF XML) och en länk till tävlingen. Startlistor, resultat och deltagare följer aldrig med.",
      [
        "Du behöver vara administratör både i tävlingen och i klubbytan.",
        "Före tävlingsdagen, eller medan banorna är hemliga, frågar O-Tid först om banhemligheten.",
        "”Ta ur klubbarkivet” tar bort träningen ur arkivet. Tävlingen ändras inte.",
        "Banor som bara finns i tidtagningen (inte ritade i banläggningen) kommer inte med i banfilerna. O-Tid och arkivposten säger vilka."
      ]
    ]
  },
  {
    id: "terminsplanering",
    title: "Planera terminen och ge ut uppgifter",
    views: ["ARCHIVE_PLANNING", "EVENTS"],
    body: [
      "Fliken ”Planering” i klubbytan är för ledare, administratörer och ägare. Där planerar ni en termin i taget, vecka för vecka.",
      { steps: [
        "Välj ”Ny termin”. O-Tid föreslår nästa termin; ändra namn och datum om det behövs och välj ”Spara terminen”.",
        "Välj ”Lägg till träning” i veckan. Skriv datum, tid, rubrik och plats, och välj karta, ansvarig, grupp, moment och nivå om ni vill.",
        "Kryssa i ”Varje vecka till terminens slut” för en träning som går samma veckodag hela terminen. Varje vecka kan sedan ändras för sig.",
        "Under ”Uppgifter” lägger du till vad som ska göras, till exempel ”Skriva ut kartor” eller ”Sätta ut kontroller”, och vem som gör det.",
        "När det är dags: ”Skapa träningen”. Den blir en riktig träning med rubriken, datumet och tiden, och den ansvarige blir administratör.",
        "Finns banläggningen redan, egen eller i en grupp: ”Koppla en träning” på veckan och välj den.",
        "Från arkivet: ”Använd igen” och välj veckan under ”Till terminsplanen”.",
        "Åt andra hållet läggs en färdig träning i arkivet med ”Lägg i klubbarkivet” på träningens sida."
      ] },
      [
        "En uppgift kan gå till en medlem i klubben eller till en e-postadress, till exempel en förälder.",
        "Med e-post på servern får personen ett kort mejl, liksom den som blir ansvarig (ett för alla veckorna). Inte den som ger sig själv uppgiften.",
        "Har adressen inget konto säger mejlet att ett konto ska skapas med just den adressen.",
        "I innevarande vecka föreslås dagens datum. Koppla en träning visar först träningarna inom två veckor från veckan.",
        "”Ändra” vid en uppgift byter rubriken eller personen. Den nya personen får ett mejl och läsrätten flyttar med.",
        "Personen ser bara sina egna uppgifter under ”Mina uppgifter” på Mina tävlingar, med tid, plats och den ansvarige, och kan bocka av dem.",
        "När träningen finns får personen läsrätt i banläggningen för just den träningen: banorna, kontrollkartan, beskrivningarna och utskriften.",
        "Tas uppgiften bort försvinner läsrätten också. Många mejl till samma person på kort tid spärras; uppgiften sparas då utan mejl."
      ],
      "Moment, nivåer och egna ord följer med när träningen läggs i klubbarkivet, där du kan söka på dem. I arkivet föreslås nivån ur banornas namn. Planen är aldrig publik; medlemmar utan ledarroll ser bara sina egna uppgifter."
    ]
  }
];
