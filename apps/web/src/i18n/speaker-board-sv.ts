export const speakerBoardSv = {
  empty: "Inga publicerade resultatunderlag finns ännu.",
  name: "Deltagare", raceClass: "Klass", result: "Aktuellt resultat", time: "Tid", registered: "Underlag registrerat",
  noResult: "Inget aktivt resultat", noTime: "Ingen tid",
  statuses: { OK: "Godkänd (OK)", MP: "Felstämplad (MP)", DSQ: "Diskvalificerad (DSQ)", OOC: "Utom tävlan (OOC)",
    DNS: "Ej start (DNS)", DNF: "Ej fullföljt (DNF)", NT: "Utan tidtagning (NT)" }
} as const;
