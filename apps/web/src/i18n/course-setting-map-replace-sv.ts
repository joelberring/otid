/** Byt kartfil i banläggningen (ägaren 2026-11-17: «att byta karta borde inte vara under resultat utan som ett alternativ under banläggning»). */
export const mapReplaceSv = {
  menu: "Byt kartfil …",
  heading: "Byt kartfil",
  current: (fileName: string, scale: string) => `Nu: ${fileName} · 1:${scale}`,
  help: "För en ny version av kartan, t.ex. från kartritaren eller banläggaren. Banorna och kontrollerna ligger kvar på samma ställe i kartans koordinater: är det samma karta, reviderad, hamnar de rätt. Kartbilden i Karta och vägval byts samtidigt.",
  unsaved: "Det osparade i banläggningen kunde inte skickas. Vänta tills det är sparat och försök igen.",
  replaced: (fileName: string) => `Kartfilen är bytt till ${fileName}.`,
  outside: (count: number) => count === 1 ? "1 kontroll ligger utanför den nya kartan; titta på den." : `${count} kontroller ligger utanför den nya kartan; titta på dem.`,
  checkPhone: "Har du sparat banläggningen i telefonen, spara den igen så att den nya kartan följer med."
};
