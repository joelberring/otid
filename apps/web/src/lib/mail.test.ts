import { describe, expect, it, vi } from "vitest";
import { mailConfiguration, mailEnabled, mailErrorSummary, passwordResetMessage, sendPasswordResetMail } from "./mail";

describe("ADR-0172 e-post för återställningslänkar", () => {
  it("är avstängd utan OTID_SMTP_URL och påslagen med giltig adress och avsändare", () => {
    expect(mailConfiguration({})).toEqual({ status: "off" });
    expect(mailConfiguration({ OTID_SMTP_URL: "  ", OTID_MAIL_FROM: "noreply@klubb.se" })).toEqual({ status: "off" });
    expect(mailConfiguration({ OTID_SMTP_URL: "smtp://user:pass@smtp.klubb.se:587", OTID_MAIL_FROM: "O-Tid <noreply@klubb.se>" }))
      .toEqual({ status: "on", smtpUrl: "smtp://user:pass@smtp.klubb.se:587", from: "O-Tid <noreply@klubb.se>" });
    expect(mailConfiguration({ OTID_SMTP_URL: "smtps://smtp.klubb.se:465", OTID_MAIL_FROM: "noreply@klubb.se" }).status).toBe("on");
  });

  it("räknar felaktiga inställningar som avstängda och loggar bara vilken variabel det gäller", () => {
    expect(mailConfiguration({ OTID_SMTP_URL: "http://smtp.klubb.se", OTID_MAIL_FROM: "noreply@klubb.se" }))
      .toEqual({ status: "invalid", problem: "SMTP_URL" });
    expect(mailConfiguration({ OTID_SMTP_URL: "inte en adress", OTID_MAIL_FROM: "noreply@klubb.se" }))
      .toEqual({ status: "invalid", problem: "SMTP_URL" });
    expect(mailConfiguration({ OTID_SMTP_URL: "smtp://smtp.klubb.se" })).toEqual({ status: "invalid", problem: "MAIL_FROM" });
    expect(mailConfiguration({ OTID_SMTP_URL: "smtp://smtp.klubb.se", OTID_MAIL_FROM: "a@b.se\r\nBcc: x@y.se" }))
      .toEqual({ status: "invalid", problem: "MAIL_FROM" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(mailEnabled({ OTID_SMTP_URL: "smtp://hemlig:lösen@smtp.klubb.se" })).toBeUndefined();
    expect(log.mock.calls.join(" ")).toContain("OTID_MAIL_FROM");
    expect(log.mock.calls.join(" ")).not.toContain("lösen");
    log.mockRestore();
  });

  it("skickar länken till mottagaren via SMTP-adressen, med svensk text och utan lösenord", async () => {
    const sendMail = vi.fn(async () => ({}));
    const createTransport = vi.fn(() => ({ sendMail }));
    const configuration = { status: "on" as const, smtpUrl: "smtp://127.0.0.1:4325", from: "O-Tid <noreply@klubb.se>" };
    await sendPasswordResetMail(configuration, { to: "anna@klubb.se", displayName: "Anna", link: "https://tid.klubb.se/recover#token=abc",
      expiresAt: new Date("2026-10-05T16:30:00Z") }, createTransport);
    expect(createTransport).toHaveBeenCalledWith("smtp://127.0.0.1:4325");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "O-Tid <noreply@klubb.se>", to: "anna@klubb.se",
      subject: "Återställ lösenordet till O-Tid" }));
    const { text } = passwordResetMessage({ to: "anna@klubb.se", displayName: "Anna", link: "https://x/recover#token=abc",
      expiresAt: new Date("2026-10-05T16:30:00Z") });
    expect(text).toContain("https://x/recover#token=abc");
    expect(text).toContain("kl. 18:30");
  });

  it("sammanfattar SMTP-fel utan meddelandet, som kan innehålla adressen", () => {
    expect(mailErrorSummary(Object.assign(new Error("550 <anna@klubb.se> rejected"), { code: "EENVELOPE", responseCode: 550 })))
      .toBe("EENVELOPE 550");
    expect(mailErrorSummary("x")).toBe("okänt fel");
  });
});
