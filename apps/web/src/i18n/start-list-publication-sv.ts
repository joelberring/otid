export const startListPublicationSv = {
  publicTitle: "Startlista",
  loadError: "Kunde inte läsa publiceringen. Försök igen.", error: "Startlistan kunde inte publiceras. Försök igen.",
  publish: "Publicera startlistan", withdraw: "Avpublicera",
  published: "Startlistan är publicerad.", withdrawn: "Startlistan är avpublicerad.",
  conflict: "Tävlingen har ändrats under tiden, eller samma lista är redan publicerad. Försök igen.",
  publicLink: "Visa publik startlista",
  empty: "En tom deltagarlista kan inte publiceras.",
  invalidContent: "Startlistan kan inte publiceras just nu. En redan publicerad lista kan fortfarande avpubliceras.",
  publicUnavailable: "Ingen startlista kan visas just nu. Listan kan vara opublicerad, avpublicerad eller tillfälligt otillgänglig.",
  publicHelp: "Planerad start, inte bekräftelse på faktisk start. Listan uppdateras automatiskt var femte sekund.",
  publicRefreshFailed: "Startlistan kunde inte uppdateras. Senast hämtade lista visas.",
  publishedAt: "Publicerad",
  /** "Uppdatera startlistan löpande". */
  publicLive: "Uppdateras löpande",
  live: "Uppdatera startlistan löpande",
  liveHelp: "På: besökare ser ändringar direkt (nya anmälda, starttider, klasser och bricka) utan ny publicering. Av: besökare ser den senast publicerade listan.",
  statusLive: "Uppdateras löpande. Besökare ser ändringar direkt.",
  liveOn: "Startlistan uppdateras löpande.",
  liveOff: "Startlistan uppdateras inte längre löpande. Besökare ser den senast publicerade listan; publicera igen för att visa läget nu.",
  liveFailed: "Inställningen kunde inte sparas. Försök igen.",
  heading: "Publicera startlistan",
  listHeading: "Startlistan",
  listHelp: "Startlistan som den ser ut nu, per klass, starttid eller klubb. Skriv ut eller exportera den här.",
  /** Steg 33: bricka visas när Inställningar → "Visa bricknummer i den publika startlistan" är på. */
  shortHelp: (cards: boolean) => (cards ? "Den publika startlistan visar namn, klubb, klass, starttid och bricka. "
    : "Den publika startlistan visar namn, klubb, klass och starttid, inte bricka. ") +
    "Ändringar, även en ändrad bricka, syns först när du publicerar igen. Besökare ser den först när tävlingen också är publicerad.",
  loading: "Läser publiceringen…",
  statusNone: "Startlistan är inte publicerad.",
  statusPublished: (time: string) => `Publicerad kl. ${time}. Den publika listan är aktuell.`,
  statusWithdrawn: (time: string) => `Avpublicerad kl. ${time}.`,
  statusChanged: (time: string) => `Publicerad kl. ${time}, men startlistan har ändrats sedan dess. Publicera igen för att visa ändringarna.`,
  exportDownloading: "Hämtar startlistan…",
  exportDownloaded: "Startlistan är nedladdad som IOF XML.",
  exportEmpty: "Det finns ingen startlista att ladda ner än.",
  exportError: "Ingen startlista laddades ner. Kontrollera anslutningen och försök igen."
} as const;
