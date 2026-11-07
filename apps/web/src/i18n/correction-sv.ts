/**
 * ADR-0191 beslut 1: alla rättelser för en löpare på ett ställe, deltagarkortets "Rätta". Avläsning och Resultat länkar
 * hit i stället för att ha egna varianter.
 */
export const correctionSv = {
  title: "Rätta",
  help: "Allt som ändrar löparens resultat: status, tid, kontroller, bana, variant och bricka. Varje rättelse sparas i historiken och kan tas bort igen.",
  /** Rubriker för grupperna i panelen. */
  status: "Status",
  timeAndControls: "Tid och kontroller",
  courseAndCard: "Bana och bricka",
  courseAndCardHelp: "Byt bricka flyttar avläsningen till rätt löpare. Byt klass räknar om resultatet på den nya banan.",
  changeCard: "Byt bricka",
  changeClass: "Byt klass",
  more: "Mer",
  moreHelp: "Rätta en enstaka stämplad mål- eller starttid utan att ändra resten av avläsningen, och ta bort en sådan rättning.",
  /** Avläsning och Resultat: genvägen till kortet. */
  shortcutTitle: "Rätta en löpare",
  shortcutHelp: "Status, manuell tid, godkända kontroller, bana, variant och bricka rättas i löparens deltagarkort under Rätta.",
  shortcutChoose: "Löpare",
  shortcutPlaceholder: "Välj löpare …",
  shortcutOpen: "Öppna Rätta",
  /** Avläsning: verktygen för hela tävlingen ligger under Mer. */
  readoutMore: "Mer: verktyg för hela tävlingen",
  readoutMoreHelp: "Start- och återkomsthistorik, rättningar som gäller alla löpare, omläsning från rådata och avläsningar som inte gick att tolka."
} as const;
