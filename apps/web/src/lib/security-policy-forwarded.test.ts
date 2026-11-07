import { afterEach, describe, expect, it, vi } from "vitest";
import { clientAddressFrom, resetMissingForwardedWarning } from "./security-policy";

describe("klientens adress för spärren", () => {
  afterEach(() => { vi.restoreAllMocks(); resetMissingForwardedWarning(); });

  it("varnar en gång i https-drift när X-Forwarded-For saknas", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const https = { O_TID_PUBLIC_ORIGIN: "https://otid.example" };
    expect(clientAddressFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), https)).toBe("203.0.113.7");
    expect(warn).not.toHaveBeenCalled();
    expect(clientAddressFrom(new Headers(), https)).toBe("okänd");
    expect(clientAddressFrom(new Headers(), https)).toBe("okänd");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("varnar inte lokalt (http)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(clientAddressFrom(new Headers(), { O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" })).toBe("okänd");
    expect(warn).not.toHaveBeenCalled();
  });
});
