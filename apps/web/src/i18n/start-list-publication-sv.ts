export const startListPublicationSv = {
  downloadXml: "Ladda ner startlista (IOF XML 3.0)",
  xmlUnavailable: "XML-export saknas för denna äldre publicering. Arrangören behöver publicera listan på nytt.",
  title: "Publicera startlista", publicTitle: "Startlista",
  help: "Namn, klubb, klass och planerad start blir offentliga på webben och i IOF XML. Bricknummer ingår inte. Senare ändringar kräver ny publicering.",
  loadError: "Kunde inte läsa publiceringen. Försök igen.", error: "Startlistan kunde inte publiceras. Försök igen.",
  refresh: "Visa publicering", noPublication: "Ingen startlista är publicerad.",
  publish: "Publicera startlistan", withdraw: "Avpublicera",
  published: "Startlistan är publicerad.", withdrawn: "Startlistan är avpublicerad.",
  changed: "Något har ändrats sedan startlistan publicerades. Publicera igen för att visa ändringarna.",
  conflict: "Tävlingen har ändrats under tiden, eller samma lista är redan publicerad. Visa publiceringen igen.",
  saved: "Klart.", publicLink: "Visa publik startlista",
  empty: "En tom deltagarlista kan inte publiceras.",
  invalidContent: "Startlistan kan inte publiceras just nu. En redan publicerad lista kan fortfarande avpubliceras.",
  publicUnavailable: "Ingen startlista kan visas just nu. Listan kan vara opublicerad, avpublicerad eller tillfälligt otillgänglig.",
  publicHelp: "Planerad start, inte bekräftelse på faktisk start. Listan uppdateras automatiskt var femte sekund.",
  publishedAt: "Publicerad"
} as const;
