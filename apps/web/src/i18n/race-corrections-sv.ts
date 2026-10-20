/** Rättningar för hela tävlingen (PLAN.md steg 31). */
type Station = "START" | "FINISH" | "CONTROL";

function signedMinutes(offsetMs: number): string {
  const sign = offsetMs < 0 ? "−" : "+";
  const totalSeconds = Math.round(Math.abs(offsetMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60), seconds = totalSeconds % 60;
  return `${sign}${minutes} min${seconds ? ` ${seconds} s` : ""}`;
}

export const raceCorrectionsSv = {
  title: "Rättningar för hela tävlingen",
  help: "Gäller alla löpare som redan läst ut och alla som läser ut senare. Avläsningarna ändras aldrig; allt kan tas bort igen.",
  timeTitle: "Justera tid för en station",
  timeHelp: "När en enhet haft fel klocka: ange stationen och hur mycket tiden ska ändras. Tiden ändras för alla som stämplat där, innan resultatet räknas.",
  station: "Station",
  stations: { START: "Start", FINISH: "Mål", CONTROL: "Kontroll" } satisfies Record<Station, string>,
  controlCode: "Kontrollens kod",
  direction: "Ändring",
  later: "Senare (+)",
  earlier: "Tidigare (−)",
  minutes: "Minuter",
  seconds: "Sekunder",
  reason: "Varför",
  reasonPlaceholder: "T.ex. målklockan gick en timme fel",
  outTitle: "Kontroll ur funktion",
  outHelp: "Kontrollen krävs inte på någon bana, även gafflade. Sträcktiden går från kontrollen före till kontrollen efter, och kontrollen står som ur funktion i sträcktiderna.",
  outReasonPlaceholder: "T.ex. enheten saknades vid kontrollen",
  show: "Visa vad som händer",
  confirm: "Spara och räkna om",
  cancel: "Avbryt",
  retry: "Försök igen",
  active: "Aktiva rättningar",
  none: "Inga rättningar.",
  history: "Borttagna",
  remove: "Ta bort",
  removeReview: (label: string) => `Ta bort: ${label}`,
  stationLabel: (station: Station, controlCode: number | null) =>
    station === "CONTROL" ? `Kontroll ${controlCode ?? ""}`.trim() : station === "START" ? "Start" : "Mål",
  adjustmentLabel: (station: Station, controlCode: number | null, offsetMs: number) =>
    `${raceCorrectionsSv.stationLabel(station, controlCode)}: ${signedMinutes(offsetMs)}`,
  outLabel: (controlCode: number | null) => `Kontroll ${controlCode ?? ""} ur funktion`,
  signedMinutes,
  readOut: (count: number) => `${count} ${count === 1 ? "löpare har" : "löpare har"} läst ut.`,
  affected: (count: number) => count === 0 ? "Ingen får ny tid eller ny status." :
    `${count} ${count === 1 ? "löpare får" : "löpare får"} ny tid eller ny status.`,
  statusChanges: "Byter status",
  noStatusChanges: "Ingen byter status.",
  notRecalculated: (count: number) => `${count} ${count === 1 ? "löpare har" : "löpare har"} manuellt rättad tid och räknas inte om. Ta bort rättningen i deltagarkortet om den nya tiden ska gälla.`,
  notSaved: "Inget är sparat än.",
  saved: (count: number) => `Sparat. ${count} ${count === 1 ? "resultat räknades" : "resultat räknades"} om.`,
  conflict: "Något har ändrats sedan du tryckte på Visa vad som händer. Visa igen.",
  duplicate: "Det finns redan en sådan rättning. Ta bort den först.",
  invalid: "Kontrollera uppgifterna. En kontroll ur funktion måste finnas på någon bana.",
  unreachable: "Servern svarar inte. Inget är bekräftat sparat; försök igen.",
  loadError: "Rättningarna kunde inte läsas.",
  status: { OK: "Godkänd", OVERTIME: "Maxtid", MP: "Felstämplad", UNKNOWN_CARD: "Okänd bricka" } as const,
  shiftTitle: "Flytta starttider",
  shiftHelp: "Alla tilldelade starttider i klassen flyttas lika mycket, även gemensam start. De som redan läst ut räknas om. Ångra genom att flytta tillbaka lika mycket.",
  shiftNoClasses: "Ingen klass har lottade eller tilldelade starttider.",
  shiftClass: "Klass",
  shiftChooseClass: "Välj klass",
  shiftReasonPlaceholder: "T.ex. starten kom igång fem minuter sent",
  shiftReview: (className: string, offset: string) => `Flytta starttider: ${className} ${offset}`,
  shiftCount: (count: number) => `${count} ${count === 1 ? "starttid flyttas" : "starttider flyttas"}.`,
  shiftFirst: "Första start",
  shiftLast: "Sista start",
  shiftSaved: (count: number) => `Sparat. ${count} resultat räknades om. Publicera startlistan igen så att den visar de nya tiderna.`,
  adjustedNotice: (labels: readonly string[]) => `Tiden är justerad: ${labels.join(", ")}.`
};
