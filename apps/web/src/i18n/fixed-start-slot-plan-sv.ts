export const fixedStartSlotPlanSv = {
  title: "Planerade startluckor", load: "Visa startplan", loading: "Läser startplan…",
  help: "Visar endast luckor från senaste sparade lottning. En ledig planerad tid är inte en bokning och ändrar inte klassens deltagartak.",
  error: "Startplanen kunde inte läsas. Inga tider har ändrats.", empty: "Det finns inga klasser med fast start i loppet.",
  noSavedDraw: "Ingen beräkningsbar startplan: klassen saknar sparad lottning.",
  changed: "Ingen beräkningsbar startplan: aktuella fasta tider stämmer inte entydigt med senaste sparade lottning.",
  plan: "Lottad", capacity: "Deltagartak", unlimited: "Obegränsat", remaining: "platser kvar",
  occupied: "Upptagen", vacant: "Ledig planerad tid", unassigned: "Utan fast starttid",
  slots: "Planerade tider", previous: "Föregående", next: "Nästa", page: "Sida", shown: "Visar"
} as const;
