/** Steg 33: kort info om tävlingen, första start och bricka i den publika startlistan. */
export const raceInfoSv = {
  settings: {
    title: "Information till löparna",
    info: "Kort info om tävlingen",
    infoHelp: (count: number, max: number) => `Visas överst på tävlingssidan och i arbetsytan. Bara text, radbrytningar behålls. ${count} av ${max} tecken.`,
    infoTooLong: (max: number) => `Högst ${max} tecken.`,
    firstStart: "Första start",
    firstStartHelp: "Klockslag, t.ex. 18:30. Bara information: ändrar inte starttider, lottning eller tävlingsklocka.",
    firstStartInvalid: "Skriv klockslaget som TT:MM, till exempel 18:30, eller lämna fältet tomt.",
    cardNumbers: "Visa bricknummer i den publika startlistan",
    cardNumbersHelp: "Bricknumret syns bara i startlistan, inte i resultat, Live eller speaker. En ändrad bricka syns först när startlistan publiceras igen. Avstängt döljs bricknumret direkt."
  },
  view: {
    title: "Om tävlingen",
    firstStart: "Första start"
  }
} as const;
