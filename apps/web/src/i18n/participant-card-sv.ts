import type { StatusChoice } from "../lib/participant-status-choices";

/** Deltagarkortet: allt om en löpare på ett ställe (ADR-0169 beslut 4). */
export const participantCardSv = {
  title: "Deltagarkort",
  result: "Resultat", runningTime: "Löptid", noResult: "Inte avläst ännu",
  resultLoading: "Läser in resultatet…", resultError: "Resultatet kunde inte läsas in.",
  decision: "Beslut",
  history: "Historik", historyEmpty: "Inga resultatändringar ännu.",
  historyLine: (time: string, what: string, status: string) => `${time} · ${what}: ${status}`,
  historyCauses: {
    CARD_READOUT: "Avläst", CLASS_CHANGE_RECALCULATION: "Omräknat efter klassbyte", EXPLICIT_RECALCULATION: "Omräknat",
    UNKNOWN_READOUT_RESOLUTION: "Okänd bricka kopplad", MANUAL_DID_NOT_START: "Ej start registrerat",
    MANUAL_DISQUALIFICATION: "Diskvalificerad", MANUAL_DISQUALIFICATION_WITHDRAWAL: "Diskvalificeringen borttagen",
    MANUAL_RESULT_APPROVAL: "Godkänd manuellt", MANUAL_RESULT_APPROVAL_WITHDRAWAL: "Manuellt godkännande borttaget",
    MANUAL_DID_NOT_FINISH: "Brutit", MANUAL_DID_NOT_FINISH_WITHDRAWAL: "Brutit borttaget",
    MANUAL_OUT_OF_COMPETITION: "Utom tävlan", MANUAL_OUT_OF_COMPETITION_WITHDRAWAL: "Utom tävlan borttaget",
    MANUAL_WITHOUT_TIMING: "Deltog utan tid", MANUAL_WITHOUT_TIMING_WITHDRAWAL: "Deltog utan tid borttaget",
    START_CHECKIN_DID_NOT_START: "Ej start vid startkontrollen",
    MANUAL_FINISH_TIME_CORRECTION: "Måltid rättad", MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL: "Måltidsrättning borttagen",
    MANUAL_PUNCH_START_TIME_CORRECTION: "Starttid rättad", MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL: "Starttidsrättning borttagen",
    SHORTENED_COURSE_CLASS_TRANSFER: "Flyttad till kortare bana", MANUAL_DID_NOT_START_WITHDRAWAL: "Ej start borttaget",
    MANUAL_TIME: "Manuell tid", MANUAL_TIME_WITHDRAWAL: "Manuell tid borttagen",
    MANUAL_CONTROL_APPROVAL: "Kontroller godkända", MANUAL_CONTROL_APPROVAL_WITHDRAWAL: "Godkända kontroller borttagna",
    MANUAL_RESULT_REMOVED: "Manuellt resultat borttaget"
  },
  changeStatus: "Ändra status", chooseStatus: "Välj …",
  choices: {
    DNS: "Ej start", DNF: "Brutit", DSQ: "Diskvalificera", OOC: "Utom tävlan", NT: "Deltog utan tid",
    APPROVAL: "Godkänn manuellt", DNS_WITHDRAWAL: "Ta bort ej start", DNF_WITHDRAWAL: "Ta bort brutit",
    DSQ_WITHDRAWAL: "Ta bort diskvalificering", OOC_WITHDRAWAL: "Ta bort utom tävlan", NT_WITHDRAWAL: "Ta bort deltog utan tid",
    APPROVAL_WITHDRAWAL: "Ta bort manuellt godkännande", MANUAL_TIME_WITHDRAWAL: "Ta bort manuell tid",
    CONTROL_APPROVAL_WITHDRAWAL: "Ta bort godkända kontroller", RECALCULATION: "Räkna om från avläsningen"
  } satisfies Record<StatusChoice, string>,
  consequences: {
    DNS: "Löparen visas som ej startande och räknas inte längre som kvar i skogen.",
    DNF: "Löparen visas som brutit, utan tid och placering.",
    DSQ: "Löparen visas som diskvalificerad och tas bort ur placeringarna.",
    OOC: "Löparen springer utom tävlan: tiden visas om den finns, men löparen placeras inte.",
    NT: "Löparen visas som Deltog, sist i klassen, utan tid och placering. Passar den som sprang utan bricka.",
    APPROVAL: "Löparen visas som godkänd trots felstämplingen. Tiden behålls. Skriv varför.",
    RECALCULATION: "Resultatet räknas om från senaste avläsningen med klassens nuvarande bana."
  } satisfies Partial<Record<StatusChoice, string>>,
  withdrawalConsequence: (status: string) => `Beslutet tas bort och löparen visas som ${status.toLocaleLowerCase("sv-SE")} igen.`,
  dnsWithdrawalConsequence: "Ej start tas bort. Löparen räknas som anmäld igen.",
  confirm: "Bekräfta ändringen", cancel: "Avbryt", retry: "Försök igen",
  unknown: "Kunde inte nå servern. Försök igen.",
  notAvailable: "Det valet går inte att göra för löparen just nu.",
  loadError: "Deltagaren kunde inte läsas in. Välj igen.",
  entryChanges: "Ändringar i anmälan",
  /** Disk med orsak (PLAN.md steg 25): orsaken visas bara i arbetsytan. */
  dsqReason: "Orsak (valfritt)",
  dsqReasonShown: (reason: string) => `Orsak: ${reason}`,
  /** Steg 31: orsaken krävs för "Godkänn manuellt". */
  approvalReason: "Orsak (krävs)",
  reasonRequired: "Skriv en orsak.",
  noDecisionWithdrawalConsequence: "Beslutet tas bort. Löparen har ingen avläsning och får inget resultat.",
  decisionNoteShown: (note: string) => `Orsak: ${note}`
} as const;
