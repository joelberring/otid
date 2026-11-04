import type { HelpArticle } from "./help-sv";

/** ADR-0205: hjälpen om kontot – skapa konto, bekräfta adressen, glömt lösenord och Logga in med Google. */
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
        "Bakom länken väljer du lösenordet (samma eller ett nytt) och trycker på ”Bekräfta och logga in”."
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
      "Finns ett konto i O-Tid med samma e-postadress kopplas Google till det, och adressen räknas som bekräftad. Annars skapas ett nytt konto.",
      "Google måste ha bekräftat e-postadressen. Vill du också kunna logga in med lösenord: välj ett med [Glömt lösenordet](#glomt-losenord).",
      "Ett spärrat konto kommer inte in med Google heller."
    ]
  }
];
