/** Ortofoto från valfri öppen WMS-tjänst som underlag (kartprojektets lagerflik, «1. Hämta underlag»). */
export const GOTHENBURG_WMS = "https://opengeodata.goteborg.se/services/ortofoto/wms/v1";

export const mapWmsSv = {
  heading: "Ortofoto från WMS",
  help: "Hämta flygbild från en öppen WMS-tjänst, t.ex. din kommuns ortofoto. Kontrollera att tjänstens villkor tillåter att bilden används som underlag för kartritning.",
  responsibility: "Du ansvarar själv för att tjänstens villkor tillåter användningen.",
  presetAttribution: "Göteborgs Stad (CC0)",
  preset: "Tjänst",
  custom: "Egen adress",
  presets: { goteborg: "Göteborgs Stad (CC0)" },
  url: "Adress till WMS-tjänsten (https)",
  readLayers: "Läs lagren",
  reading: "Läser lagren …",
  layer: "Lager",
  noSweref: "Inget lager i tjänsten kan hämtas i SWEREF 99 TM eller kartans koordinatsystem.",
  resolution: "Upplösning",
  resolutions: { "0.25": "0,25 m per pixel (finast)", "0.5": "0,5 m per pixel", "1": "1 m per pixel", "2": "2 m per pixel (grövst)" },
  where: "Område",
  whole: "Hela kartan",
  fetch: "Hämta",
  fetching: (done: number, total: number) => total > 1 ? `Hämtar bild ${done} av ${total} …` : "Hämtar flygbilden …",
  /** Namnet på underlaget: lagret, området och tillskrivningen sist så att den inte klipps bort. */
  name: (layer: string, area: string | undefined, tile: string | undefined, attribution: string) => {
    const tail = ` · ${attribution}`.slice(0, 50);
    return `${[layer, area, tile].filter(Boolean).join(" ")}`.slice(0, 80 - tail.length) + tail;
  },
  attribution: (title: string) => `© ${title}`,
  added: (count: number) => count === 1 ? "Flygbilden är tillagd som underlag. Den kan tolkas under «Tolka flygbild»." : `${count} bildrutor är tillagda som underlag. De kan tolkas under «Tolka flygbild».`,
  failedAfter: (added: number) => `${added} bildrutor lades till innan det gick fel. Resten får du genom att hämta igen, eller med grövre upplösning.`,
  problems: {
    WMS_NOT_HTTPS: "Adressen måste börja med https://.",
    WMS_BAD_URL: "Adressen går inte att använda. Den ska vara en vanlig https-adress utan port och utan användarnamn.",
    WMS_PRIVATE_ADDRESS: "Adressen pekar på ett internt nät och kan inte hämtas. Ange en publik adress.",
    WMS_UNREACHABLE: "Tjänsten svarar inte just nu. Försök igen om en stund.",
    WMS_NOT_WMS: "Adressen svarar inte som en WMS-tjänst. Kontrollera adressen.",
    WMS_NO_LAYER: "Lagret finns inte längre i tjänsten. Läs lagren igen.",
    WMS_NO_SWEREF: "Inget lager i tjänsten kan hämtas i SWEREF 99 TM (EPSG:3006) eller kartans koordinatsystem.",
    WMS_IMAGE_TOO_LARGE: "Bilden är för stor. Välj grövre upplösning eller en etapp.",
    WMS_TOO_MANY_TILES: "Området blir för många bildrutor (högst 16). Välj grövre upplösning eller en etapp.",
    WMS_NO_FORMAT: "Tjänsten kan inte leverera JPEG eller PNG.",
    WMS_NOT_IMAGE: "Tjänsten svarade inte med en bild för området. Kontrollera att lagret täcker kartan, eller välj grövre upplösning.",
    SOURCE_THROTTLED: "För många hämtningar den senaste timmen. Försök igen senare.",
    generic: (status: number | string) => `Det gick inte (${status}).`
  }
};
