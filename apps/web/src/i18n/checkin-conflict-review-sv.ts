export const checkinConflictReviewSv = {
  title: "Granska mottagna konfliktrapporter",
  adminHelp: "Granskningen behåller registrerade uppgifter och historik. Den registrerar inte återkomst och ändrar inga resultat. Rätta felaktiga uppgifter separat innan granskning.",
  help: "Onlinebeslut för målpersonal. Granskningen behåller registrerat läge och historik; den registrerar inte återkomst och ändrar inga resultat. Rätta felaktiga uppgifter separat innan granskning.",
  entry: "Deltagare med ogranskade rapporter", choose: "Välj deltagare", load: "Hämta granskningsunderlag",
  current: "Nuvarande registrerade uppgifter", reports: "Mottagna men inte genomförda rapporter",
  noReports: "Inga ogranskade rapporter finns i detta underlag. Aktuella motsägelser måste fortfarande rättas separat.",
  generated: "Underlag hämtat (UTC)", observed: "Rapporterat på enheten (UTC)", received: "Mottaget på servern (UTC)",
  revision: "Startrevision", expected: "Rapportens förväntade startrevision", resultRevision: "Resultatrevision",
  mark: "Startmarkering", correction: "Målrättning", returnYes: "Manuell återkomst: ja", returnNo: "Manuell återkomst: nej",
  reason: "Orsak till granskningsbeslut", confirm: "Jag har kontrollerat rapporterna och vill behålla nuvarande registrerade uppgifter.",
  submit: "Bekräfta granskning – behåll registrerat läge", retry: "Försök igen med samma granskningsbeslut",
  pending: "Svaret är osäkert. Samma beslut behålls för återförsök på denna sida. Efter omladdning: hämta aktuellt underlag innan ett nytt beslut.",
  stale: "Underlaget har ändrats. Hämta och granska nytt underlag innan du fattar ett nytt beslut.",
  failedRead: "Underlaget kunde inte hämtas. Kontrollera anslutningen och försök igen.",
  tooLarge: "Underlaget överskrider granskningsgränsen. Ingen delvis granskning har sparats.",
  saved: "Granskningen är sparad. Kvar-i-skogen-listan uppdateras; uppföljningsbehov kan kvarstå.",
  errors: {
    STALE_ENTRY: "Deltagaruppgifterna hade ändrats", STALE_PACKAGE: "Tävlingsversionen hade ändrats",
    STALE_REVISION: "En nyare startuppgift fanns", DEPENDENCY_CONFLICT: "En föregående lokal rapport kunde inte genomföras",
    RETURN_ALREADY_REGISTERED: "Återkomst var redan registrerad", RESULT_CONFLICT: "Rapporten stred mot resultatunderlaget"
  }
} as const;
