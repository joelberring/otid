/** Steg 45: avläsningar vars tider inte gick att tolka. */
export const uninterpretedReadoutsSv = {
  title: "Otolkade avläsningar",
  help: "Brickor vars tider inte gick att tolka vid avläsningen. Råramarna är sparade. Läs om med datorns klocka, eller ange när brickan lästes ut om datorns klocka gick fel. En okänd bricka hamnar sedan under Okända brickor.",
  load: "Visa otolkade avläsningar",
  none: "Inga otolkade avläsningar.",
  row: (card: string, time: string, error: string) => `Bricka ${card} kl. ${time} (${error})`,
  exercise: "övning",
  rereadDevice: "Läs om med datorns klocka",
  givenDate: "Datum",
  givenTime: "Klockslag när brickan lästes ut",
  rereadGiven: "Läs om med angiven tid",
  invalidTime: "Skriv klockslaget som 18:45.",
  read: (status: string, punches: number) => `Omläst: ${status}, ${punches} ${punches === 1 ? "stämpling" : "stämplingar"}.`,
  alreadyRead: (status: string) => `Omläst: ${status}.`,
  unreadable: (detail: string) => `Gick fortfarande inte att tolka (${detail}). Prova en angiven tid.`,
  conflict: "Avläsningen är redan omläst. Visa listan igen.",
  invalid: "Avläsningen finns inte längre. Visa listan igen.",
  unreachable: "Servern svarar inte. Inget är bekräftat sparat; försök igen.",
  loadError: "Listan kunde inte läsas.",
  status: { OK: "Godkänd", OVERTIME: "Maxtid", MP: "Felstämplad", UNKNOWN_CARD: "Okänd bricka" } as const
};
