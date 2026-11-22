/** PLAN.md steg M4: underlag som tagits bort ur förrådet och kan återskapas, när projektet öppnas. */
export const mapProjectRegenerableSv = {
  missing: (runs: number, layers: number, mb: number) => `${[runs > 0 ? `${runs} ${runs === 1 ? "laserkörning" : "laserkörningar"}` : "",
    layers > 0 ? `${layers} underlag` : ""].filter(Boolean).join(" och ")} (${mb} MB) har tagits bort ur förrådet för att spara plats. `
    + "Det kan återskapas: laserkörningar körs om med samma rutor och inställningar (räknas inte mot laserkvoten) och bilderna hämtas igen från källan.",
  regenerate: "Återskapa",
  working: (done: number, total: number) => `Återskapar ${done} av ${total} …`,
  queued: (runs: number) => runs > 0 ? `Klart. ${runs === 1 ? "Laserkörningen" : `${runs} laserkörningar`} väntar på geo-servern och tar över sina underlag när ${runs === 1 ? "den" : "de"} är klara.` : "Klart.",
  failed: (count: number) => `${count} kunde inte återskapas. Försök igen senare.`,
  noCredential: "Lägg in dina uppgifter till Lantmäteriet under Mitt konto för att köra om laserkörningar och hämta ortofoton.",
  busy: "Du har redan två laserkörningar som väntar eller pågår. Försök igen när någon är klar.",
  readOnly: "Den som får föreslå eller ändra i projektet kan återskapa det.",
  overLimit: (projects: readonly string[]) => `Du har mycket underlag i ${projects.join(" och ")}. Ta bort äldre körningar eller be superadmin om mer.`,
  ok: "OK"
};
