import { plural } from "./plural";

/** ADR-0205 tillägg: kontomenyn i alla inloggade sidors överlist (namnet eller initialerna). */
export const accountMenuSv = {
  open: (name: string) => `Konto: ${name}`,
  myClubs: "Mina klubbar",
  myGroups: "Mina grupper",
  myEvents: "Mina tävlingar",
  myAccount: "Mitt konto",
  logout: "Logga ut",
  loggingOut: "Loggar ut …",
  checking: "Kontrollerar ändringar som väntar …",
  /** Ändringar i telefonen eller datorn som inte har kommit fram till servern. */
  pending: (count: number) => `${plural(count, "ändring väntar", "ändringar väntar")} på nät – logga ut ändå?`,
  pendingCourseSetting: "Banläggningens ändringar som inte har skickats försvinner.",
  pendingTracks: (count: number) => `${plural(count, "GPS-spår", "GPS-spår")} som inte har skickats försvinner.`,
  pendingReadouts: (count: number) => `${plural(count, "avläsning", "avläsningar")} sparas kvar på datorn tills de har skickats.`,
  logoutAnyway: "Logga ut ändå",
  cancel: "Avbryt",
  failed: (status: number) => `Utloggningen kunde inte bekräftas (${status}). Kontrollera nätet och försök igen.`,
  network: "Utloggningen kunde inte bekräftas. Kontrollera nätet och försök igen."
} as const;
