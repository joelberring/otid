export const checkinConflictReviewSv = {
  title: "Granska mottagna konfliktrapporter",
  adminHelp: "Granskningen behåller registrerade uppgifter och historik. Den registrerar inte återkomst och ändrar inga resultat. Rätta felaktiga uppgifter separat innan granskning.",
  help: "Onlinebeslut för målpersonal. Granskningen behåller registrerat läge och historik; den registrerar inte återkomst och ändrar inga resultat. Rätta felaktiga uppgifter separat innan granskning.",
  entry: "Deltagare med ogranskade rapporter", choose: "Välj deltagare", load: "Visa rapporterna",
  current: "Nuvarande registrerade uppgifter", reports: "Mottagna men inte genomförda rapporter",
  noReports: "Det finns inga ogranskade rapporter. Motstridiga uppgifter rättas fortfarande i kvar i skogen.",
  generated: "Uppgifterna hämtade", observed: "Rapporterat på enheten", received: "Mottaget",
  mark: "Startmarkering", correction: "Målrättning", returnYes: "Manuell återkomst: ja", returnNo: "Manuell återkomst: nej",
  reason: "Orsak till granskningsbeslut", confirm: "Jag har kontrollerat rapporterna och vill behålla nuvarande registrerade uppgifter.",
  submit: "Bekräfta granskning – behåll registrerat läge", retry: "Försök igen",
  pending: "Kunde inte nå servern. Försök igen – samma beslut skickas igen.",
  stale: "Rapporterna har ändrats under tiden. Visa dem igen innan du bestämmer.",
  failedRead: "Rapporterna kunde inte hämtas. Kontrollera anslutningen och försök igen.",
  tooLarge: "Det är för många rapporter att granska på en gång. Inget har sparats.",
  saved: "Granskningen är sparad. Kvar-i-skogen-listan uppdateras; uppföljningsbehov kan kvarstå.",
  errors: {
    STALE_ENTRY: "Deltagaruppgifterna hade ändrats", STALE_PACKAGE: "Tävlingen hade ändrats",
    STALE_REVISION: "En nyare startuppgift fanns", DEPENDENCY_CONFLICT: "En föregående lokal rapport kunde inte genomföras",
    RETURN_ALREADY_REGISTERED: "Återkomst var redan registrerad", RESULT_CONFLICT: "Rapporten stred mot resultatet"
  }
} as const;
