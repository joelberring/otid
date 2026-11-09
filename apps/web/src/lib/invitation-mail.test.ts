import { describe, expect, it, vi } from "vitest";
import type { InvitationMail } from "@o-tid/application";
import { invitationLink, invitationMailer, invitationMessage } from "./invitation-mail";

const token = "A".repeat(43);
const base = { to: "ny.person@exempel.se", token, expiresAt: new Date("2026-11-17T10:00:00Z"), inviterName: "Anna Arrangör" };
const link = invitationLink("https://tid.klubb.se", token);

describe("ADR-0206: inbjudningsmejlet", () => {
  it("säger vem, till vilken klubb, rollen i ord och har en enda länk", () => {
    const { subject, text } = invitationMessage({ ...base, role: "ADMIN", target: { kind: "CLUB", clubId: "c", name: "OK Påhitt" } }, link);
    expect(subject).toBe("Inbjudan till klubben OK Påhitt i O-Tid");
    expect(text).toContain("Anna Arrangör har bjudit in dig till klubben OK Påhitt i O-Tid som administratör.");
    expect(text).toContain("Länken gäller till 17 november 2026.");
    expect(text.match(/https?:\/\/\S+/g)).toEqual(["https://tid.klubb.se/inbjudan#token=" + token]);
  });

  it("tävlingen med namn och datum och banläggarens roll", () => {
    const { subject, text } = invitationMessage({ ...base, role: "COURSE_EDIT",
      target: { kind: "RACE", raceId: "r", name: "Natt-KM · Etapp 1", raceDate: "2027-10-07" } }, link);
    expect(subject).toBe("Inbjudan till tävlingen Natt-KM · Etapp 1 den 7 oktober 2027 i O-Tid");
    expect(text).toContain("som banläggare – kan ändra.");
    expect(invitationMessage({ ...base, role: "FUNCTIONARY", target: { kind: "RACE", raceId: "r", name: "KM", raceDate: "2027-10-07" } }, link)
      .text).toContain("som funktionär.");
  });

  it("klubbens roller i ord (ADR-0209: Medlem och Ledare)", () => {
    const club = { kind: "CLUB", clubId: "c", name: "OK Påhitt" } as const;
    expect(invitationMessage({ ...base, role: "READER", target: club }, link).text).toContain("som medlem.");
    expect(invitationMessage({ ...base, role: "LEADER", target: club }, link).text).toContain("som ledare.");
  });

  it("på engelska när den som bjuder in använder engelska", () => {
    const { subject, text } = invitationMessage({ ...base, role: "COURSE_EDIT",
      target: { kind: "RACE", raceId: "r", name: "Night champs", raceDate: "2027-10-07" } }, link, "en");
    expect(subject).toBe("Invitation to the event Night champs on 7 October 2027 in O-Tid");
    expect(text).toMatch(/^Hello!/);
    expect(text).toContain("Anna Arrangör has invited you to the event Night champs on 7 October 2027 in O-Tid as course setter – can edit.");
    expect(text).toContain("The link is valid until 17 November 2026.");
    expect(text).not.toMatch(/Hej|Länken|Inbjudan/);
  });

  it("träningsgruppen och medlem", () => {
    expect(invitationMessage({ ...base, role: "MEMBER", target: { kind: "GROUP", groupId: "g", name: "Torsdagsgänget" } }, link).text)
      .toContain("till träningsgruppen Torsdagsgänget i O-Tid som medlem.");
  });

  it("har ingen mottagaradress i texten och inga radbrytningar från namn i ämnesraden", () => {
    const mail: InvitationMail = { ...base, role: "READER", inviterName: "Eva\r\nBcc: x@y.se",
      target: { kind: "CLUB", clubId: "c", name: "Klubb\nBcc: spam@exempel.se" } };
    const { subject, text } = invitationMessage(mail, link);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(text).not.toContain("ny.person@exempel.se");
    expect(text.split("\n").some(line => line.startsWith("Bcc"))).toBe(false);
  });

  it("utan e-post på servern finns ingen mejlare; med e-post skickas till mottagaren", async () => {
    expect(invitationMailer({}, "https://tid.klubb.se")).toBeUndefined();
    const sendMail = vi.fn(async () => ({}));
    const mailer = invitationMailer({ OTID_SMTP_URL: "smtp://127.0.0.1:2525", OTID_MAIL_FROM: "O-Tid <noreply@klubb.se>" }, "https://tid.klubb.se",
      undefined, () => ({ sendMail }));
    await mailer!({ ...base, role: "LEADER", target: { kind: "GROUP", groupId: "g", name: "Gruppen" } });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ny.person@exempel.se", from: "O-Tid <noreply@klubb.se>",
      text: expect.stringContaining(link) as unknown }));
  });

  it("ett SMTP-fel loggas utan adress och kastas vidare", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mailer = invitationMailer({ OTID_SMTP_URL: "smtp://127.0.0.1:2525", OTID_MAIL_FROM: "noreply@klubb.se" }, "https://x", undefined,
      () => ({ sendMail: async () => { throw Object.assign(new Error("550 <ny.person@exempel.se>"), { responseCode: 550 }); } }));
    await expect(mailer!({ ...base, role: "READER", target: { kind: "CLUB", clubId: "c", name: "K" } })).rejects.toThrow();
    expect(log.mock.calls.flat().join(" ")).not.toContain("ny.person");
    log.mockRestore();
  });
});
