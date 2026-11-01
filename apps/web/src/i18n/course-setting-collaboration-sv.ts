/** Steg 66 (ADR-0181): samarbetet och arbetsytan i banläggningen. Enkel svenska. */
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const time = (value: string) => new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

export const collaborationSv = {
  access: {
    EDIT: "Du kan ändra banorna",
    SUGGEST: "Du kan föreslå ändringar",
    COMMENT: "Du kan läsa och kommentera"
  } as Record<string, string>,
  mode: {
    heading: "Arbetssätt",
    label: "Hur ni arbetar",
    LEAD: "Huvudbanläggare",
    SHARED: "Gemensamt",
    help: {
      LEAD: "De med behörigheten ändra ändrar direkt; övriga föreslår ändringar som huvudbanläggaren godkänner.",
      SHARED: "Alla med behörigheten ändra ändrar direkt; notiserna används för diskussionen. Den som föreslår gör det även här."
    } as Record<string, string>,
    saved: "Arbetssättet är sparat.",
    failed: "Arbetssättet kunde inte sparas."
  },
  presence: (names: readonly string[]) => names.length === 0 ? "" : `Inne nu: ${names.join(", ")}`,
  someone: "Någon",
  waitForMap: "Ägaren eller en administratör laddar upp kartfilen. Sidan visar banläggningen när den finns.",
  waitForStart: "Banläggningen är inte påbörjad än. Den som har behörigheten ändra läser in en .ppen eller börjar tomt.",
  remoteChanged: (name: string, kept: boolean) => `${name} ändrade banorna.${kept ? " Dina osparade ändringar är kvar." : ""}`,
  lost: (count: number) => `${plural(count, "ändring", "ändringar")} gick inte att spara efter andras ändringar:`,
  topbar: {
    course: "Visa bana",
    variant: "Variant",
    file: "Fil",
    fileMenu: "Fil och versioner …",
    transfer: "Överför till tävlingen …",
    settings: "Arbetssätt …",
    fullscreen: "Helskärm",
    exitFullscreen: "Lämna helskärm",
    close: "Stäng",
    menu: "Meny"
  },
  drawer: {
    label: "Paneler",
    collapse: "Fäll ihop panelerna",
    expand: "Visa panelerna",
    resize: "Ändra panelernas bredd",
    tabs: { courses: "Banor", description: "Beskrivning", selected: "Vald", checks: "Varningar", notes: "Notiser", inspections: "Kollat",
      suggestions: "Förslag", settings: "Inställningar" },
    count: (label: string, count: number) => count > 0 ? `${label} (${count})` : label
  },
  card: {
    label: "Vald på kartan",
    description: "Beskrivning",
    more: "Mer",
    close: "Avmarkera"
  },
  notes: {
    heading: "Notiser",
    show: "Visa notiser på kartan",
    filter: "Visa",
    filters: { OPEN: "Öppna", DONE: "Klara", ALL: "Alla" } as Record<string, string>,
    none: "Inga notiser.",
    target: {
      POINT: "Punkt på kartan",
      CONTROL: (label: string) => `Kontroll: ${label}`,
      LEG: (from: string, to: string) => `Sträckan ${from}–${to}`,
      COURSE: (name: string) => `Banan ${name}`
    },
    newHeading: "Ny notis",
    newHelp: "Välj verktyget Notis och klicka på kartan, en kontroll eller en sträcka. En notis om banan skrivs här.",
    aboutCourse: (name: string) => `Notis om banan ${name}`,
    text: "Text",
    photo: "Foto (valfritt)",
    photoHelp: "Från kameran eller en bild. Förminskas till högst 2 MB.",
    photoTooLarge: "Fotot är för stort även förminskat.",
    photoFailed: "Fotot kunde inte läsas.",
    save: "Spara notisen",
    cancel: "Avbryt",
    saving: "Sparar …",
    failed: "Notisen kunde inte sparas.",
    reply: "Svara",
    replyLabel: "Svar",
    sendReply: "Skicka svaret",
    done: "Klar",
    reopen: "Öppna igen",
    status: { OPEN: "Öppen", DONE: "Klar" } as Record<string, string>,
    by: (name: string | null, at: string) => `${name ?? "Någon"}, ${time(at)}`,
    show_on_map: "Visa på kartan",
    photoAlt: "Foto till notisen",
    replies: (count: number) => plural(count, "svar", "svar"),
    mark: (count: number) => count === 1 ? "Notis" : `${count} notiser`
  },
  suggestions: {
    heading: "Förslag",
    none: "Inga öppna förslag.",
    drafting: "Förslagsläge",
    draftHelp: "Dina ändringar samlas som ett förslag. De syns bara hos dig tills du skickar förslaget; den som ändrar godkänner det.",
    draftCount: (count: number) => count === 0 ? "Inga ändringar än." : `${plural(count, "ändring", "ändringar")} i förslaget.`,
    comment: "Kommentar till förslaget",
    send: "Skicka förslaget",
    discard: "Kasta förslaget",
    discardConfirm: "Kasta ändringarna i förslaget?",
    sent: "Förslaget är skickat.",
    failed: "Förslaget kunde inte skickas.",
    open: (count: number) => plural(count, "öppet förslag", "öppna förslag"),
    row: (name: string | null, at: string, count: number) => `${name ?? "Någon"}, ${time(at)} · ${plural(count, "ändring", "ändringar")}`,
    status: { OPEN: "Öppet", APPROVED: "Godkänt", PARTIAL: "Delvis godkänt", DECLINED: "Avböjt" } as Record<string, string>,
    review: "Granska",
    stopReview: "Sluta granska",
    reviewing: "Förslaget ritas streckat ovanpå banan: pilar för flyttade kontroller, streckade ringar för nya och kryss för borttagna.",
    pick: "Ändringar att godkänna",
    approveAll: "Godkänn alla",
    approveSelected: (count: number) => `Godkänn ${plural(count, "vald ändring", "valda ändringar")}`,
    decline: "Avböj",
    declineComment: "Kommentar (till den som föreslog)",
    declined: "Förslaget är avböjt.",
    approved: (applied: number) => `${plural(applied, "ändring", "ändringar")} är gjorda.`,
    notPossible: "Går inte längre:",
    decisionFailed: "Beslutet kunde inte sparas.",
    history: "Tidigare förslag",
    decisionBy: (name: string | null, at: string) => `${name ?? "Någon"}, ${time(at)}`
  }
};
