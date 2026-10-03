const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeServerBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Serveradressen är ogiltig");
  }
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("Servern får endast kontaktas över HTTPS eller lokal utvecklingsadress");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("Serveradressen får inte innehålla inloggning, query eller fragment");
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url.toString();
}

export function stationApiUrl(baseUrl: string, raceId: string, resource: "station-package" | "device-batches"): URL {
  if (!UUID_PATTERN.test(raceId)) throw new Error("Lopp-id är ogiltigt");
  return new URL(`api/races/${encodeURIComponent(raceId)}/${resource}`, normalizeServerBaseUrl(baseUrl));
}
