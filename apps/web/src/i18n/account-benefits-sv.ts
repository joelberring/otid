/**
 * Ägaren 2026-11-22: rutan bredvid inloggningen om vad ett konto ger. "Arrangör" avskräckte; kontot är för alla som lägger
 * banor, ritar kartor, leder träningar eller arrangerar. Påståendena ska stämma: O-Tid skickar mejl som gäller kontot
 * (bekräftelse, nytt lösenord, inbjudningar, uppgifter i träningsplaneringen) men aldrig nyhetsbrev eller reklam.
 */
export const accountBenefitsSv = {
  title: "Vad du kan göra med ett konto",
  free: "Gratis.",
  freeText: "O-Tid kostar inget att använda.",
  items: [
    "Lägga banor i webbläsaren och skriva ut kartor med rätt färger",
    "Rita och revidera kartor, även från Mapper och OCAD",
    "Ta tid på träningar och tävlingar med SPORTident, även utan nät",
    "Planera träningar och spara dem i klubbens arkiv",
    "Bjuda in andra att jobba med dig"
  ],
  promisesTitle: "Om ditt konto",
  promises: [
    "Du kan ta bort ditt konto när som helst under Mitt konto.",
    "Vi skickar inga nyhetsbrev eller reklam."
  ],
  eventorTip: "Tips: använd samma e-postadress som i Eventor. Har din klubb kopplat O-Tid till Eventor blir du då klubbmedlem i O-Tid direkt.",
  noAccount: "Du behöver inget konto för att se resultat eller vara med på en träning."
};

export type AccountBenefitsTexts = typeof accountBenefitsSv;
