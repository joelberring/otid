import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Database } from "@o-tid/database";

const startMapProjectPdf = vi.fn();
vi.mock("@o-tid/application", async importOriginal => {
  const actual = await importOriginal<typeof import("@o-tid/application")>();
  return { ...actual, startMapProjectPdf };
});

(globalThis as { React?: typeof React }).React = React;
const { MapProjectPrintButton } = await import("./map-project-print-button");
const { mapProjectPdfRoute } = await import("../../lib/map-project-route-handlers");

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ENV = { NODE_ENV: "development" as const, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" };
const SESSION = `otid_user_session_v1.${PROJECT_ID}.${"a".repeat(43)}`;
const CSRF = "b".repeat(43);

function postPdf(body?: unknown, contentType?: string) {
  const headers: Record<string, string> = {
    origin: ENV.O_TID_PUBLIC_ORIGIN,
    cookie: `otid_organizer_session=${SESSION}; otid_organizer_csrf=${CSRF}`,
    "x-otid-csrf": CSRF
  };
  if (contentType) headers["content-type"] = contentType;
  return new Request(`http://127.0.0.1:3000/api/organizer/map-projects/${PROJECT_ID}/pdf`, {
    method: "POST",
    headers,
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {})
  });
}

describe("MapProjectPrintButton och POST /pdf (Etapp 1C)", () => {
  it("renderar utskriftsknappen och inställningsmenyn med kartans riktiga färger som förval", () => {
    const html = renderToStaticMarkup(<MapProjectPrintButton projectId={PROJECT_ID} pending={0} />);
    expect(html).toContain('data-testid="map-project-print-pdf"');
    expect(html).toContain('data-testid="map-project-print-options"');
    expect(html).toContain("kartans riktiga färger");
  });

  it("mapProjectPdfRoute tar emot både tom body och { mode, lightenForOffice } och avvisar ogiltiga fält", async () => {
    startMapProjectPdf.mockReset();
    startMapProjectPdf.mockResolvedValue({ status: "ok", jobId: "job-1" });
    const db = {} as Database;

    const empty = await mapProjectPdfRoute(db, postPdf(), PROJECT_ID, ENV);
    expect(empty.status).toBe(202);
    expect(startMapProjectPdf).toHaveBeenLastCalledWith(db, expect.objectContaining({ projectId: PROJECT_ID }));

    const lightened = await mapProjectPdfRoute(db, postPdf({ mode: "OFFICE", lightenForOffice: true }, "application/json"), PROJECT_ID, ENV);
    expect(lightened.status).toBe(202);
    expect(startMapProjectPdf).toHaveBeenLastCalledWith(db, expect.objectContaining({ projectId: PROJECT_ID, mode: "OFFICE", lightenForOffice: true }));

    const press = await mapProjectPdfRoute(db, postPdf({ mode: "PRESS", lightenForOffice: false }, "application/json"), PROJECT_ID, ENV);
    expect(press.status).toBe(202);
    expect(startMapProjectPdf).toHaveBeenLastCalledWith(db, expect.objectContaining({ projectId: PROJECT_ID, mode: "PRESS", lightenForOffice: false }));

    const invalid = await mapProjectPdfRoute(db, postPdf({ mode: "INVALID" }, "application/json"), PROJECT_ID, ENV);
    expect(invalid.status).toBe(400);
    const unknown = await mapProjectPdfRoute(db, postPdf({ extra: 1 }, "application/json"), PROJECT_ID, ENV);
    expect(unknown.status).toBe(400);
  });
});
