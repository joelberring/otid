import { describe, expect, it } from "vitest";
import { readRouteUploadCsrfCookie } from "./route-upload-cookies";

const token = "a".repeat(43);

describe("TASK111 route upload CSRF cookie", () => {
  it("uses the URL's cookie namespace and rejects duplicate or malformed values", () => {
    expect(readRouteUploadCsrfCookie(`otid_route_upload_csrf=${token}`, new URL("http://127.0.0.1:3000"))).toBe(token);
    expect(readRouteUploadCsrfCookie(`__Host-otid-route-upload-csrf=${token}`, new URL("https://otid.example"))).toBe(token);
    expect(readRouteUploadCsrfCookie(`otid_route_upload_csrf=${token}; otid_route_upload_csrf=${token}`, new URL("http://127.0.0.1:3000"))).toBeUndefined();
    expect(readRouteUploadCsrfCookie("otid_route_upload_csrf=not-a-token", new URL("http://127.0.0.1:3000"))).toBeUndefined();
    expect(readRouteUploadCsrfCookie(`otid_route_upload_csrf=${token}`, new URL("https://otid.example"))).toBeUndefined();
  });
});
