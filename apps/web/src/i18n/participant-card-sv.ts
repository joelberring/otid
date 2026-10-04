import type { StatusChoice } from "../lib/participant-status-choices";

/** Deltagarkortet: allt om en löpare på ett ställe (ADR-0169 beslut 4). */
export const participantCardSv = {
  title: "Deltagarkort",
  result: "Resultat", runningTime: "Löptid", noResult: "Inget resultat ännu",
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
    MANUAL_WITHOUT_TIMING: "Utan tidtagning", MANUAL_WITHOUT_TIMING_WITHDRAWAL: "Utan tidtagning borttaget",
    START_CHECKIN_DID_NOT_START: "Ej start vid startkontrollen",
    MANUAL_FINISH_TIME_CORRECTION: "Måltid rättad", MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL: "Måltidsrättning borttagen",
    MANUAL_PUNCH_START_TIME_CORRECTION: "Starttid rättad", MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL: "Starttidsrättning borttagen",
    SHORTENED_COURSE_CLASS_TRANSFER: "Flyttad till kortare bana"
  },
  changeStatus: "Ändra status", chooseStatus: "Välj …",
  choices: {
    DNS: "Ej start", DNF: "Brutit", DSQ: "Diskvalificera", OOC: "Utom tävlan", NT: "Utan tidtagning",
    APPROVAL: "Godkänn manuellt", DNS_WITHDRAWAL: "Ta bort ej start", DNF_WITHDRAWAL: "Ta bort brutit",
    DSQ_WITHDRAWAL: "Ta bort diskvalificering", OOC_WITHDRAWAL: "Ta bort utom tävlan", NT_WITHDRAWAL: "Ta bort utan tidtagning",
    APPROVAL_WITHDRAWAL: "Ta bort manuellt godkännande", RECALCULATION: "Räkna om från avläsningen"
  } satisfies Record<StatusChoice, string>,
  consequences: {
    DNS: "Löparen visas som ej startande och räknas inte längre som kvar i skogen.",
    DNF: "Löparen visas som brutit, utan tid och placering.",
    DSQ: "Löparen visas som diskvalificerad och tas bort ur placeringarna.",
    OOC: "Löparen behåller sin tid men visas utom tävlan, utan placering.",
    NT: "Löparen visas utan tid och placering. Export och fastställande väntar tills beslutet tas bort.",
    APPROVAL: "Löparen visas som godkänd trots felstämplingen. Tiden behålls.",
    RECALCULATION: "Resultatet räknas om från senaste avläsningen med klassens nuvarande bana."
  } satisfies Partial<Record<StatusChoice, string>>,
  withdrawalConsequence: (status: string) => `Beslutet tas bort och löparen visas som ${status.toLocaleLowerCase("sv-SE")} igen.`,
  dnsWithdrawalConsequence: "Ej start tas bort. Löparen räknas som anmäld igen.",
  confirm: "Bekräfta ändringen", cancel: "Avbryt", retry: "Försök igen",
  unknown: "Svaret saknas. Ändringen kan redan vara sparad. Tryck på Försök igen; den sparas bara en gång.",
  notAvailable: "Det valet går inte att göra för löparen just nu.",
  loadError: "Underlaget kunde inte läsas in. Välj igen.",
  entryChanges: "Ändringar i anmälan"
} as const;
