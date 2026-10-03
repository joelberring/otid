import "server-only";

export const privateStationHeaders = {
  "cache-control": "no-store, private",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff"
};

export function stationUnauthorized(): Response {
  return Response.json({ error: "Stationsautentisering misslyckades" }, {
    status: 401,
    headers: { ...privateStationHeaders, "www-authenticate": "Bearer" }
  });
}

export function stationForbidden(): Response {
  return Response.json({ error: "Stationen saknar behörighet" }, {
    status: 403,
    headers: privateStationHeaders
  });
}

export function stationInvalidBatch(status: 400 | 413 | 415): Response {
  return Response.json({ error: "Ogiltig stationsbatch" }, {
    status,
    headers: privateStationHeaders
  });
}

export function stationBatchFailure(): Response {
  return Response.json({ error: "Batchen kunde inte behandlas" }, {
    status: 500,
    headers: privateStationHeaders
  });
}
