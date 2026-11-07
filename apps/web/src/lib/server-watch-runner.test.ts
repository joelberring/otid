import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ db: {} }));
const { serverMailer, serverName } = await import("./server-watch-runner");

/** ADR-0216: larmen och veckorapporten mejlas till varje superadmin för sig via samma e-post som övrigt (mail.ts). */
const environment = { OTID_SMTP_URL: "smtp://127.0.0.1:4325", OTID_MAIL_FROM: "O-Tid <noreply@klubb.se>" };
const message = { subject: "O-Tid x: larm – disken", text: "Disken är 85 % full" };

describe("serverbevakningens mejl", () => {
  it("ett mejl per mottagare, adresserna syns inte för varandra", async () => {
    const sendMail = vi.fn(async () => ({}));
    const sent = await serverMailer(environment, undefined, () => ({ sendMail }))(message, ["a@klubb.se", "b@klubb.se"]);
    expect(sent).toBe(2);
    expect(sendMail.mock.calls.map(call => (call as unknown as [{ to: string }])[0].to)).toEqual(["a@klubb.se", "b@klubb.se"]);
  });

  it("kastar bara när inget mejl gick iväg (då görs varvet om), och skriver i loggen utan e-post", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const flaky = () => ({ sendMail: async () => { calls += 1; if (calls === 1) throw Object.assign(new Error("<a@klubb.se>"), { code: "EENVELOPE" }); } });
    expect(await serverMailer(environment, undefined, flaky)(message, ["a@klubb.se", "b@klubb.se"])).toBe(1);
    await expect(serverMailer(environment, undefined, () => ({ sendMail: async () => { throw new Error("nere"); } }))(message, ["a@klubb.se"]))
      .rejects.toThrow("nere");
    expect(log.mock.calls.join(" ")).not.toContain("@");
    log.mockRestore();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(await serverMailer({})(message, ["a@klubb.se"])).toBe(0);
    expect(info.mock.calls.join(" ")).toContain("e-post avstängd");
    info.mockRestore();
  });

  it("servern heter som den publika adressen", () => {
    expect(serverName({ O_TID_PUBLIC_ORIGIN: "https://otid.exempel.se" })).toBe("otid.exempel.se");
    expect(serverName({})).toBe("servern");
  });
});
