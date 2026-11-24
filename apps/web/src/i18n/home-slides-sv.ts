/** Startsidans bildspel för den som inte är inloggad (ägaren 2026-11-24): rubrik, en mening och bildens alt-text per bild. */
export const homeSlidesSv = {
  label: "Bilder från O-Tid",
  previous: "Föregående bild",
  next: "Nästa bild",
  pause: "Pausa bildspelet",
  play: "Spela bildspelet",
  choose: (index: number, title: string) => `Bild ${index}: ${title}`,
  position: (index: number, count: number) => `${index} av ${count}`,
  enlarge: "Öppna bilden i full storlek",
  slides: {
    grundkarta: { title: "Från laserdata till grundkarta", text: "Läs in laserdata, OpenStreetMap och ortofoto, så tar O-Tid fram ett första utkast till kartan.",
      alt: "Kartredigeraren med guiden Ny grundkarta: stegen laserdata, OpenStreetMap och ortofoto bredvid kartan." },
    rita: { title: "Rita i webben och i mobilen", text: "Kartan ritas i webbläsaren med normens symboler, och kan rättas i telefonen ute i skogen.",
      alt: "Kartredigerarens ritläge med symbolerna och en telefon i hörnet som visar samma karta." },
    vagval: { title: "Vägval", text: "Lägg banan och se vägvalen sträcka för sträcka, med bästa vägen på kartan.",
      alt: "Kontrollkartans vägvalsläge med en lång sträcka runt en sjö inzoomad och bästa vägen inritad." },
    gps: { title: "Sätt ut kontroller med GPS", text: "I fältläget visar telefonen var du står, så att kontrollerna hamnar rätt och kan bockas av.",
      alt: "Banläggningen med alla kontroller i datorn och fältläget i en stor telefon med positionen på kartan." },
    layout: { title: "Layout och tryckfärger", text: "Banor och kartor skrivs ut i rätt färger och i flera skalor och format i samma tävling.",
      alt: "Layoutens överblick med samma bana på A4 och A3 i olika skalor, ett utskriftsark med kartan och färgerna för tryck över och under banan." },
    forbered: { title: "Förbered tävlingen", text: "Klasser, anmälda, lottning och startlista på ett ställe.",
      alt: "Tävlingens arbetsyta med startlistan efter lottningen." },
    avlasning: { title: "Avläsning", text: "Läs av brickorna med SPORTident, också när nätet försvinner.",
      alt: "Avläsningsvyn med senaste avläsningen och en telefon i hörnet." },
    resultat: { title: "Resultat och live", text: "Resultat, sträcktider och liveresultat direkt, i datorn och i mobilen.",
      alt: "Den publika resultatsidan och liveresultaten i en telefon." },
    arkiv: { title: "Klubbens arkiv", text: "Klubbens kartor, banor och träningar samlade och sökbara.",
      alt: "Klubbarkivet med klubbens kartor och träningar." }
  }
} as const;
