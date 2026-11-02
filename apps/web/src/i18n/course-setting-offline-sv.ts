/** Steg 67 (ADR-0181 beslut 6–7): kollad, notis i fältet, utan täckning och kompassen. Enkel svenska. */
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const clock = (value: string) => new Date(value).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
const when = (value: string) => {
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return today ? clock(value) : date.toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const megabytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB`
  : `${(bytes / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB`;

/** Varför servern inte tog emot en post i kön (409 = kontrollen eller banan finns inte). */
const reason = (status: number) => status === 409 ? "kontrollen eller banan finns inte längre" : `svar ${status}`;

export const offlineSv = {
  more: "Mer",
  status: {
    offline: (waiting: number) => waiting === 0 ? "Utan nät" : `Utan nät – ${plural(waiting, "ändring", "ändringar")} väntar`,
    loggedOut: (waiting: number) => `Utloggad – ${plural(waiting, "ändring", "ändringar")} väntar i telefonen`,
    sending: (waiting: number) => `Skickar ${plural(waiting, "ändring", "ändringar")} …`,
    /** Översynen 2026-11-02: telefonen kunde inte spara (t.ex. fullt på iOS). */
    storageFailed: (waiting: number) => `Kan inte spara i telefonen${waiting > 0 ? ` – ${plural(waiting, "ändring", "ändringar")} bara i minnet` : ""}. Synka med nät eller frigör plats.`
  },
  storageFailed: "Telefonen kunde inte spara ändringarna (lagringen kan vara full). Ladda inte om sidan: anslut till nätet så att ändringarna sparas på servern, eller frigör plats (ta bort sparade kartor eller bilder).",
  accessGone: "Du har inte längre tillgång till banläggningen. Kopian i telefonen är borttagen.",
  targetGone: "pekar på en kontroll eller bana som inte finns längre",
  back: (parts: readonly string[]) => `Nätet är tillbaka: ${parts.join(", ")} sparade.`,
  backEdits: (count: number) => plural(count, "ändring på kartan", "ändringar på kartan"),
  backNotes: (count: number) => plural(count, "notis", "notiser"),
  backInspections: (count: number) => plural(count, "bock för kollad", "bockar för kollad"),
  rejected: (count: number) => `${plural(count, "sak", "saker")} i kön kunde inte sparas:`,
  rejectedNote: (text: string, status: number) => `Notisen "${text.slice(0, 40)}" (${reason(status)})`,
  rejectedInspection: (label: string, status: number) => `Kollad för ${label} (${reason(status)})`,
  loggedOut: (waiting: number) => `Inloggningen har gått ut. ${plural(waiting, "ändring", "ändringar")} finns kvar i telefonen och skickas när du loggat in igen.`,
  login: "Logga in (ny flik)",
  openedFromPhone: (at: string) => `Utan nät: banläggningen från telefonen (sparad ${when(at)}). Ändringarna skickas när nätet kommer tillbaka.`,
  resumed: (count: number) => `${plural(count, "ändring", "ändringar")} från förra gången skickas.`,
  olderMap: "Kartfilen i telefonen är en äldre version än den på servern.",
  panel: {
    heading: "Utan nät",
    help: "Spara sidan och kartfilen i telefonen innan du går ut. Ändringar, notiser och bockar sparas alltid i telefonen tills servern tagit emot dem.",
    save: (size: number | undefined) => size === undefined ? "Spara kartan för offline" : `Spara kartan för offline (${megabytes(size)})`,
    saving: "Sparar i telefonen …",
    saved: (bytes: number, at: string) => `Sparad i telefonen ${when(at)}: kartfilen ${megabytes(bytes)} och sidan.`,
    stale: "Kartfilen på servern är ny – spara igen.",
    update: "Spara igen",
    remove: "Ta bort från telefonen",
    removed: "Borttaget från telefonen.",
    failed: "Det gick inte att spara i telefonen.",
    noShell: "Webbläsaren kan inte spara sidan; kartan och ändringarna sparas ändå.",
    shellFailed: "Sidan sparades inte – kartfilen och ändringarna finns ändå i telefonen.",
    waiting: (count: number) => count === 0 ? "Inget väntar på att skickas." : `${plural(count, "ändring", "ändringar")} väntar på att skickas.`,
    sendNow: "Skicka nu"
  },
  inspection: {
    button: "Kollad",
    checked: "Kollad ✓",
    selected: (label: string) => `Bocka ${label.toLowerCase()} som kollad`,
    by: (name: string | null, at: string) => `Kollad av ${name ?? "någon"} ${when(at)}`,
    pending: "väntar på nät",
    sending: "skickas …",
    movedSince: "flyttad efter kollen",
    notSaved: "Kontrollen är inte sparad än – kolla den när den är sparad.",
    heading: "Kollade kontroller",
    filter: "Visa",
    filters: { UNCHECKED: "Ej kollade", ALL: "Alla" } as Record<string, string>,
    count: (checked: number, total: number) => `${checked} av ${total} kollade`,
    none: "Alla kontroller är kollade.",
    noControls: "Inga kontroller.",
    unchecked: "Ej kollad",
    help: "Tryck på en kontroll för att visa den på kartan. Bocka i fältet med Kollad.",
    tab: "Kollat"
  },
  noteHere: {
    button: "Notis här",
    heading: (target: string) => `Notis: ${target}`,
    atPosition: "din position",
    atCenter: "kartans mitt",
    retake: "Nytt foto",
    takePhoto: "Ta foto",
    photoReady: "Foto bifogat",
    text: "Text (valfritt med foto)",
    save: "Spara notisen",
    cancel: "Avbryt",
    photoOnly: "Foto",
    queued: "Notisen är sparad i telefonen och skickas när nätet finns.",
    saved: "Notisen är sparad."
  },
  list: "Lista",
  offlineButton: "Offline",
  follow: "Följer",
  poorAccuracy: (meters: number) => `Position ±${meters} m – osäker (sämre än 15 m). Vänta en stund eller gå ut i det öppna.`,
  movedPoor: (meters: number) => `Flyttad, men noggrannheten var bara ±${meters} m – kontrollera mot kartbilden.`
} as const;
