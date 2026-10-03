export const publicParticipantRouteSv = {
  title: "Deltagarens rutt", back: "Till resultatet", loading: "Laddar rutt…",
  unavailable: "Rutten är inte tillgänglig.", notice: "Rutten är inte GPS-verifierad.", image: "Karta med deltagarens rutt",
  distance: "Distans", points: "Punkter", segments: "Segment", recordedTime: "GPX-tid (UTC)", timeless: "GPX-filen saknar sammanhängande tidsinformation.",
  playbackTitle: "Spela upp GPX-rutt", playbackNotice: "Tidsaxeln följer GPX-filens relativa inspelningstid, inte tävlingstid eller kontrollpassager.",
  playbackPlay: "Spela", playbackPause: "Pausa", playbackRestart: "Börja om", playbackTimeline: "Position i GPX-rutten",
  zoomControls: "Kartans zoom", zoomLevel: "Förstoring", zoomIn: "Zooma in", zoomOut: "Zooma ut", zoomReset: "Visa hela kartan",
  mapViewport: "Flyttbar karta med deltagarens rutt", panHint: "Förstora kartan och svep för att flytta den. Använd piltangenter när kartan har fokus.",
  summaryTitle: "Publik rutt", summaryAvailable: "En publik rutt finns för detta resultat.", viewRoute: "Visa rutt",
  control: (sequence: number, controlCode: number) => `Kontroll ${sequence}, kod ${controlCode}`
} as const;
