import { plural } from "./plural";

/** Ägaren 2026-11-08: läsa ut enheter (kontroller, start, mål) i webbläsaren. Bara läsning; provas. */
export const stationsSv = {
  title: "Läs ut enheter",
  back: "Till tävlingen",
  trial: "Provas: utläsningen är byggd efter öppna beskrivningar av protokollet men inte provad mot riktiga enheter än. "
    + "Inget skrivs till enheten. Ladda ner råloggen och skicka den om något ser fel ut.",
  howTo: "Anslut en huvudstation (BSM7/BSM8) med USB. Sätt den i läget fjärr (remote) eller låt O-Tid göra det, lägg enheten mot huvudstationen och tryck Läs ut. "
    + "Huvudstationen ställs tillbaka i direktläge efteråt.",
  serialUnsupported: "Webbläsaren kan inte nå stationen. Använd Chrome eller Edge på en dator.",
  connect: "Anslut huvudstation",
  connected: "Huvudstationen är ansluten.",
  disconnect: "Koppla från",
  remote: "Läs enheten som ligger mot huvudstationen (fjärr)",
  direct: "Läs huvudstationen själv",
  read: "Läs ut",
  reading: (done: number, total: number) => total ? `Läser backupminnet: ${done} av ${total} …` : "Läser …",
  problems: {
    "no-station": "Ingen enhet svarade. Lägg enheten mot huvudstationen (eller väck den med en bricka) och försök igen.",
    timeout: "Enheten slutade svara. Försök igen.",
    nak: "Enheten vägrade läsningen.",
    unexpected: "Enheten svarade oväntat. Ladda ner råloggen.",
    transport: "Kontakten med huvudstationen bröts.",
    open: "Porten kunde inte öppnas. Stäng andra flikar som använder stationen."
  },
  facts: {
    serial: "Serienummer", model: "Modell", firmware: "Programversion", code: "Kod", mode: "Läge", battery: "Batteri bytt",
    capacity: "Batterikapacitet (rått värde)", memory: "Backupminne", clock: "Klocka",
    clockDiff: (seconds: number) => Math.abs(seconds) < 2 ? "stämmer med datorn" : `${seconds > 0 ? "före" : "efter"} datorn med ${Math.abs(Math.round(seconds))} s`,
    memoryValue: (kb: number, count: number, overflow: boolean) => `${kb} kB, ${plural(count, "stämpling", "stämplingar")}${overflow ? " (minnet har gått runt)" : ""}`
  },
  modes: { CONTROL: "Kontroll", START: "Start", FINISH: "Mål", READOUT: "Avläsning", CLEAR: "Nollställning", CHECK: "Check",
    BEACON_CONTROL: "Kontroll (Air+)", BEACON_START: "Start (Air+)", BEACON_FINISH: "Mål (Air+)" } as Record<string, string>,
  punches: "Stämplingar i backupminnet",
  truncated: "Bara de senaste 4 000 stämplingarna visas.",
  none: "Inga stämplingar.",
  card: "Bricka", time: "Tid (12 h)", runner: "Löpare", unknownCard: "Inte i tävlingen",
  controlInRace: (code: number, used: boolean) => used ? `Kod ${code} finns på tävlingens banor.` : `Kod ${code} finns inte på tävlingens banor.`,
  csv: "Ladda ner stämplingarna (CSV)",
  rawLog: "Ladda ner rålogg",
  noPackage: "Tävlingens deltagare kunde inte hämtas; brickorna visas utan namn."
} as const;
