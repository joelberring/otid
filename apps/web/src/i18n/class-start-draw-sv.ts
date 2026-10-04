/** Lottning av starttider i arbetsytans Start-steg. Första start skrivs som klockslag på tävlingsdagen. */
export const classStartDrawSv = {
  title: "Lotta klassens starttider",
  help: "Enkel lottning för hela klassen med fasta starttider, utan klubbseparering eller seedning. Du ser gamla och nya tider innan något sparas.",
  warning: "Befintliga tider kan ersättas. En publicerad startlista behöver publiceras igen efteråt.",
  class: "Klass", first: "Första start (klockslag)", firstExample: "18:00", interval: "Startintervall i sekunder",
  refresh: "Välj klass att lotta", inspect: "Visa lottningen",
  confirm: "Spara klassens starttider", cancel: "Avbryt",
  error: "Kunde inte läsa lottningen. Försök igen.",
  invalid: "Välj klass, skriv första start som klockslag (till exempel 18:00) och ett intervall mellan 1 och 3600 sekunder.",
  conflict: "Tävlingen har ändrats under tiden, eller lottningen ändrar inga tider. Visa lottningen igen.",
  saved: "Klassens starttider är sparade.",
  previous: "Tidigare start", next: "Ny start", missing: "Starttid saknas",
  count: "Deltagare", changes: "Ändrade tider"
} as const;
