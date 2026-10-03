export const eventorSv = {
  heading: "Importera från Eventor", lead: "Skapa en ny tävling med ett valt lopp. Inga deltagare importeras.",
  boundary: "Anslutningen konfigureras privat av serveradministratören. Ange aldrig Eventors API-nyckel här.",
  login: "Logga in", credential: "Skapandebehörighet", logout: "Logga ut", checking: "Kontrollerar session…",
  connection: "Eventoranslutning", choose: "Välj…", eventId: "Eventors tävlings-id", fetch: "Hämta och granska",
  race: "Lopp att importera", zone: "Tidszon (IANA)", confirm: "Bekräfta och skapa tävling",
  warning: "Tävlingens och loppets namn samt datum blir offentligt synliga. Start- och resultatlistor publiceras inte. Inga nya loppbehörigheter utfärdas.",
  noConnections: "Ingen aktiv anslutning är kopplad till denna behörighet. Kontakta serveradministratören.",
  noRaces: "Tävlingen saknar importerbara lopp. Ingen tävling kan skapas från detta underlag.",
  unknown: "Svaret är osäkert. Behåll samma försök och använd återförsök; skapa inte en ny import.",
  retry: "Försök igen med samma id", discard: "Avsluta försöket", discardHelp: "Kontrollera tävlingslistan innan du startar en ny import efter osäkert svar.",
  failed: "Begäran misslyckades. Kontrollera nät och behörighet.", conflict: "Underlaget eller importavsikten har ändrats, eller tävlingen är redan importerad. Granska på nytt.",
  success: "Tävlingen har importerats.", invalid: "Ogiltigt underlag eller svar.", requestId: "Försöks-id",
  sourceHash: "Källhash", fetchedAt: "Hämtat", open: "Öppna tävlingsöversikt", events: "Tävlingar",
  busy: "Arbetar…", online: "Internet: anslutning tillgänglig", offline: "Internet: offline – import kräver nät",
  logoutUnknown: "Utloggningen kunde inte bekräftas. Försök logga ut igen.",
} as const;

export function eventorProfileLabel(profile: "testeventor-se" | "production-se"): string {
  return profile === "testeventor-se" ? "Testeventor" : "Eventor Sverige – produktion";
}
