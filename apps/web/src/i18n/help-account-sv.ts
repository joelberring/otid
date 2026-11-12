import type { HelpArticle } from "./help-sv";

/**
 * ADR-0205: hjälpen om kontot – skapa konto, bekräfta adressen, glömt lösenord och Logga in med Google. ADR-0205 tillägg: Koppla
 * Google-konto med en annan adress, kontomenyn, Logga ut och lånade datorer.
 */
export const accountHelpArticles: readonly HelpArticle[] = [
  {
    id: "konto",
    title: "Skapa konto och bekräfta e-postadressen",
    views: ["EVENTS"],
    body: [
      "Ett konto behövs för att skapa tävlingar och få behörigheter. Det skapas med e-postadressen, som du bekräftar med en länk.",
      [
        "Välj ”Har du inget konto? Skapa ett” på inloggningen och skriv namn och e-postadress.",
        "Skriv lösenordet i både ”Lösenord” och ”Upprepa lösenordet”. Är de olika säger sidan det direkt.",
        "Ögat vid fältet (”Visa lösenordet”) visar vad du har skrivit.",
        "Tryck på ”Skapa konto”. Länken i mejlet fungerar i vilken webbläsare som helst, till exempel i telefonen.",
        "Öppnar du länken i samma webbläsare inom en timme gäller lösenordet du just valde: tryck på ”Bekräfta och logga in”.",
        "Öppnar du den någon annanstans (eller senare) väljer du lösenordet där (samma eller ett nytt) och trycker på ”Bekräfta och logga in”."
      ],
      "Har länken gått ut, eller kommer du inte in: se [Glömt lösenordet](#glomt-losenord). Det bekräftar också adressen."
    ]
  },
  {
    id: "glomt-losenord",
    title: "Glömt lösenordet",
    views: ["EVENTS"],
    body: [
      "Välj ”Glömt lösenordet?” på inloggningen, skriv e-postadressen och tryck på ”Skicka länk”. Länken gäller i en timme och kan användas en gång.",
      "Öppna länken, skriv det nya lösenordet två gånger och tryck på ”Spara och logga in”. Du är inloggad direkt, och andra enheter loggas ut.",
      [
        "Det fungerar också om du aldrig har bekräftat adressen: länken bekräftar den.",
        "Har du skrivit fel lösenord för många gånger häver det nya lösenordet spärren, så du behöver inte vänta.",
        "Öppnar du sedan det gamla bekräftelsemejlet säger sidan att adressen redan är bekräftad."
      ],
      "Är du inloggad byter du lösenord under ”Mitt konto” → ”Byt lösenord”."
    ]
  },
  {
    id: "google",
    title: "Logga in med Google",
    views: ["EVENTS"],
    body: [
      "Finns knappen ”Logga in med Google” på inloggningen kan du använda ditt Google-konto i stället för ett lösenord.",
      "Finns ett konto i O-Tid med samma e-postadress kopplas Google till det och adressen räknas som bekräftad; annars skapas ett nytt konto.",
      "Google måste ha bekräftat e-postadressen. Vill du också kunna logga in med lösenord: välj ett med [Glömt lösenordet](#glomt-losenord).",
      "Ett spärrat konto kommer inte in med Google heller.",
      "Har ditt Google-konto en annan adress? Logga in som vanligt och koppla Google under Mitt konto ([Koppla Google-konto](#google-koppla))."
    ]
  },
  {
    id: "google-koppla",
    title: "Koppla Google-konto",
    views: ["EVENTS"],
    body: [
      "Har ditt Google-konto en annan adress? Logga in som vanligt och koppla Google under Mitt konto.",
      { steps: [
        "Logga in med e-postadressen och lösenordet och öppna ”Mitt konto” i menyn med ditt namn.",
        "Tryck på ”Koppla Google-konto” under ”Inloggning med Google” och välj Google-kontot hos Google.",
        "Tillbaka i O-Tid står det att Google-kontot är kopplat. Sedan räcker ”Logga in med Google”."
      ] },
      "Kontots e-postadress ändras inte; Googles adress visas bara vid kopplingen.",
      [
        "”Ta bort kopplingen” tar bort den igen, men inte om kontot saknar eget lösenord.",
        "Skapade Google tidigare ett tomt konto åt dig flyttas kopplingen hit när du bekräftar med lösenordet.",
        "Bekräfta med ”Flytta kopplingen och ta bort dubbletten”; det tomma kontot tas bort.",
        "Används det andra kontot (tävlingar, behörigheter, klubbar): logga in där och ta bort kopplingen först."
      ]
    ]
  },
  {
    id: "logga-ut",
    title: "Logga ut och lånade datorer",
    views: ["EVENTS", "COURSE_SETTING", "CS_PRINT_PAGE"],
    body: [
      "Menyn med ditt namn (initialerna på telefonen) finns överst på varje sida när du är inloggad.",
      [
        "Där finns ”Mina tävlingar”, ”Mina klubbar”, ”Mina grupper”, ”Mitt konto” och ”Logga ut”.",
        "”Logga ut” tar också bort det webbläsaren sparat om tävlingar och personer, som fältlägets kopia.",
        "Väntar ändringar på nät frågar menyn först. Avläsningar som inte har skickats ligger kvar tills de kommit fram.",
        "”Kom ihåg mig på den här datorn” gäller i 30 dagar. Utan den gäller inloggningen tolv timmar.",
        "Glömt att logga ut någonstans: ”Mitt konto” → ”Logga ut från alla enheter”."
      ],
      "Använd inte ”Kom ihåg mig på den här datorn” på en lånad dator."
    ]
  }
];
