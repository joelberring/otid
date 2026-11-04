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
        "Skapa eller kopiera klubbens API-nyckel i Eventor (klubbens sidor, API-nyckel).",
        "Öppna klubbytan och fliken ”Klubben”.",
        "Klistra in nyckeln under ”Klubbens API-nyckel” och välj ”Koppla till Eventor”.",
        "O-Tid frågar Eventor vilken klubb nyckeln hör till och hämtar medlemslistan. Medlemmar med samma adress i O-Tid blir bekräftade.",
        "Listan hämtas igen en gång per dygn. Vill du hämta den direkt: ”Hämta medlemmar nu”. Se också [Bekräfta medlemmar](#bekrafta-medlemmar)."
      ] },
      "Nyckeln sparas krypterad och visas aldrig igen, bara de sista fyra tecknen. Av medlemslistan sparas bara Eventors person-id och ett oläsbart avtryck av e-postadressen, inga namn eller andra uppgifter. Med ”Byt nyckel” lägger du in en ny nyckel och med ”Ta bort kopplingen” tas nyckeln och listan bort.",
      "En klubb i Eventor kan bara kopplas till en klubbyta. Är den redan kopplad: kontakta ägaren av den klubbytan."
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
        "Slutar någon i klubben i Eventor försvinner det som Eventor gav vid nästa hämtning. Bekräftelser för hand står kvar."
      ],
      "Rollerna är ”Medlem”, ”Ledare”, ”Administratör” och ”Ägare”. Ledare sätts av en administratör i listan under ”Medlemmar” eller när man bjuder in.",
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
        "Personen tar inbjudan som vanligt, genom mejlet eller när hen loggar in."
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
        "”Ta ur klubbarkivet” tar bort träningen ur arkivet. Tävlingen ändras inte."
      ]
    ]
  }
];
