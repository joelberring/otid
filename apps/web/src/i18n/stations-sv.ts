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
    open: "Porten kunde inte öppnas. Stäng andra flikar som använder stationen.",
    "invalid-plan": "Välj vad som ska ställas in (koden 1–511)."
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
  noPackage: "Tävlingens deltagare kunde inte hämtas; brickorna visas utan namn.",
  write: {
    title: "Ställ in enheten",
    help: "Klockan efter datorns, koden och läget. Inget annat ändras; backupminnet rörs inte. Efteråt läses enheten igen så att du ser att ändringen gick fram.",
    time: "Ställ klockan efter datorn",
    code: "Kod (lämna tomt för att inte ändra)",
    mode: "Läge",
    keepMode: "Ändra inte",
    submit: "Ställ in",
    confirm: (serial: string) => `Ställa in enheten ${serial}? Klockan, koden och läget skrivs till enheten.`,
    writing: "Ställer in …",
    done: "Klart. Enheten läst igen:",
    codeResult: (before: number, after: number, ok: boolean) => `Kod ${before} → ${after}${ok ? "" : " (ändringen gick inte fram)"}`,
    modeResult: (before: string, after: string, ok: boolean) => `Läge ${before} → ${after}${ok ? "" : " (ändringen gick inte fram)"}`,
    clockResult: (diff: number) => Math.abs(diff) < 2 ? "Klockan stämmer med datorn." : `Klockan skiljer ${Math.round(diff)} s från datorn.`,
    noClock: "Klockan kunde inte läsas efteråt."
  },
  register: {
    label: "Spara i klubbens enhetsregister",
    none: "Spara inte",
    saved: (club: string) => `Sparad i ${club}s enhetsregister.`,
    failed: "Kunde inte spara i enhetsregistret.",
    help: "Varje enhet som läses ut eller ställs in sparas med serienummer, kod, batteri och klocka (du behöver vara ledare eller administratör i klubben)."
  }
} as const;
