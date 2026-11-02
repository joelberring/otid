import { describe, expect, it, vi } from "vitest";
import { configurationProblems, logConfigurationProblems } from "./startup-check";

const good = { NODE_ENV: "production", DATABASE_URL: "postgresql://otid_app:hemligt@postgres:5432/otid", O_TID_PUBLIC_ORIGIN: "https://otid.berring.se",
  OTID_INSTANCE_ROLE: "competition" };

describe("ADR-0186: fel inställningar syns i loggen vid start", () => {
  it("godtar en riktig driftmiljö", () => {
    expect(configurationProblems(good)).toEqual([]);
  });

  it("säger vad som är fel med O_TID_PUBLIC_ORIGIN, DATABASE_URL, e-posten och instansens roll", () => {
    expect(configurationProblems({ ...good, O_TID_PUBLIC_ORIGIN: "http://otid.berring.se" }).join(" ")).toContain("O_TID_PUBLIC_ORIGIN är fel");
    expect(configurationProblems({ ...good, O_TID_PUBLIC_ORIGIN: "https://otid.berring.se/" }).join(" ")).toContain("O_TID_PUBLIC_ORIGIN");
    expect(configurationProblems({ ...good, O_TID_PUBLIC_ORIGIN: undefined }).join(" ")).toContain("O_TID_PUBLIC_ORIGIN är fel (O_TID_PUBLIC_ORIGIN saknas)");
    expect(configurationProblems({ ...good, DATABASE_URL: "" }).join(" ")).toContain("DATABASE_URL saknas");
    expect(configurationProblems({ ...good, OTID_SMTP_URL: "inte en adress" }).join(" ")).toContain("OTID_SMTP_URL är fel");
    expect(configurationProblems({ ...good, OTID_INSTANCE_ROLE: "publik" }).join(" ")).toContain("OTID_INSTANCE_ROLE");
  });

  it("skriver felen utan lösenord ur miljön", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logConfigurationProblems({ ...good, O_TID_PUBLIC_ORIGIN: "ftp://x", OTID_SMTP_URL: "smtp://anvandare:superhemligt@" });
    const text = log.mock.calls.flat().join(" ");
    expect(text).toContain("KONFIGURATIONSFEL");
    expect(text).not.toContain("superhemligt");
    expect(text).not.toContain("hemligt@postgres");
    log.mockRestore();
  });
});
