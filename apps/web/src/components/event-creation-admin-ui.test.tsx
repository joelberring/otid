import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventCreationAdmin } from "./event-creation-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 005K event creation UI", () => {
  it("serverrenderar endast ett svenskt privat login-shell", () => {
    const html = renderToStaticMarkup(<EventCreationAdmin />);
    expect(html).toContain("Skapa tävling och första lopp");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("Inget pågående försök");
    expect(html).not.toContain("otid_org_event_create_v1");
  });

  it("håller credential, intent, request och svar i React-minne", () => {
    const component = source("./event-creation-admin.tsx");
    const client = source("../lib/event-creation-admin-client.ts");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setInterval|setTimeout/);
    expect(client).not.toMatch(/localStorage|sessionStorage|indexedDB|setInterval|setTimeout/);
    expect(component).toContain("useState<EventCreationAttempt>()");
    expect(component).toContain("useState<EventCreationResponse>()");
    expect(component).toContain('setAccessCredential("")');
  });

  it("binder explicit retry till exakt samma request-id och body utan automatisk retry", () => {
    const component = source("./event-creation-admin.tsx");
    expect(component).toContain('"idempotency-key": `event-create:${current.requestId}`');
    expect(component).toContain("body: JSON.stringify(current.request)");
    expect(component).toContain("submitAttempt(attempt)");
    expect(component).not.toMatch(/setTimeout|setInterval/);
  });

  it("busy-låser och rensar endast definitiva 400/409-försök", () => {
    const component = source("./event-creation-admin.tsx");
    const client = source("../lib/event-creation-admin-client.ts");
    expect(component).toContain("disabled={busy || attempt !== undefined}");
    expect(component).toContain("isDefinitiveEventCreationRejection(response.status)");
    expect(client).toContain("return status === 400 || status === 409");
  });

  it("logout rensar credential, request och svar före nätanrop och har explicit retry", () => {
    const component = source("./event-creation-admin.tsx");
    const logout = component.indexOf("async function requestLogout");
    const fetch = component.indexOf("await fetch(sessionUrl", logout);
    for (const clear of ['setAccessCredential("")', "setAttempt(undefined)", "setCreated(undefined)"]) {
      expect(component.indexOf(clear, logout)).toBeLessThan(fetch);
    }
    expect(component).toContain("setLogoutUnconfirmed(true)");
    expect(component).toContain("onClick={() => void requestLogout()}");
  });

  it("publika root saknar createformulär och länkar neutralt till skapandeshellet", () => {
    const root = source("../app/page.tsx");
    const page = source("../app/admin/events/new/page.tsx");
    expect(root).not.toContain("CreateEventForm");
    expect(root).toContain('/admin/events/new');
    expect(page).toContain("<EventCreationAdmin />");
  });

  it("deklarerar privata pageheaders för den exakta skapandeytan", () => {
    const config = source("../../next.config.ts");
    expect(config).toContain('{ source: "/admin/events/new", headers: [...privateAdminHeaders] }');
    expect(config).toContain('{ key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" }');
    expect(config).toContain('{ key: "X-Frame-Options", value: "DENY" }');
  });
});
