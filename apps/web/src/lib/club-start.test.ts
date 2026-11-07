import { describe, expect, it } from "vitest";
import type { ClubView } from "@o-tid/contracts";
import { clubHelpArticles } from "../i18n/help-club-sv";
import { clubAffiliationSv, EVENTOR_KEY_PLACE } from "../i18n/club-affiliation-sv";
import { clubStartSv } from "../i18n/club-start-sv";
import { sourcesSv } from "../i18n/sources-sv";
import { clubStartStatus, mailtoHref, showClubStart } from "./club-start";

const me = "00000000-0000-4000-8000-000000000001";
function club(change: Partial<ClubView> = {}): ClubView {
  return {
    formatVersion: 1, clubId: "00000000-0000-4000-8000-0000000000c1", name: "Klubben", viewer: { accountId: me, role: "OWNER" }, eventorClub: null,
    members: [{ memberId: "m1", you: true, email: "agare@exempel.se", displayName: "Ägaren", role: "OWNER", addedAt: "2026-11-07T10:00:00Z" }],
    invitations: [], usage: { mapBytes: 0, courseFileBytes: 0, maps: 0, versions: 0, entries: 0, courseFiles: 0 }, tokens: [],
    quota: { accountLimitBytes: null, accountUsedBytes: 0 }, ...change
  };
}
const usage = (maps: number) => ({ mapBytes: 1000, courseFileBytes: 0, maps, versions: maps, entries: 0, courseFiles: 0 });

describe("Kom igång i klubbytan", () => {
  it("en ny klubbyta: inget gjort, nästa steg är kopplingen till Eventor", () => {
    const status = clubStartStatus(club());
    expect(status).toMatchObject({ fresh: true, ready: false, next: "eventor" });
    expect(status.done).toEqual({ eventor: false, people: false, maps: false, access: true });
    expect(showClubStart(club(), false)).toBe(true);
  });

  it("visas för ägare och administratörer, inte för ledare och medlemmar, och inte när kortet är dolt", () => {
    expect(showClubStart(club({ viewer: { accountId: me, role: "ADMIN" } }), false)).toBe(true);
    expect(showClubStart(club({ viewer: { accountId: me, role: "LEADER" } }), false)).toBe(false);
    expect(showClubStart(club({ viewer: { accountId: me, role: "READER" } }), false)).toBe(false);
    expect(showClubStart(club(), true)).toBe(false);
  });

  it("kopplad men inga kartor: kortet står kvar med kartorna som nästa steg; kopplad och en karta: kortet försvinner", () => {
    const linked = club({ eventorClub: "OK Exempel" });
    expect(clubStartStatus(linked)).toMatchObject({ fresh: false, ready: false, next: "people" });
    expect(showClubStart(linked, false)).toBe(true);
    const ready = club({ eventorClub: "OK Exempel", usage: usage(1) });
    expect(clubStartStatus(ready).ready).toBe(true);
    expect(showClubStart(ready, false)).toBe(false);
    // Kartor utan koppling räcker inte.
    expect(showClubStart(club({ usage: usage(3) }), false)).toBe(true);
  });

  it("den inloggade ägaren ensam räknas inte som fler ledare (raden med `you`)", () => {
    expect(clubStartStatus(club()).done.people).toBe(false);
    expect(clubStartStatus(club({ members: [{ ...club().members[0]!, you: false }] })).done.people).toBe(true);
  });

  it("fler ledare: en annan ledare eller administratör, eller en inbjudan som sådan; medlemmar räknas inte", () => {
    const other = { memberId: "m2", you: false, email: "", displayName: "Annan", addedAt: "2026-11-07T10:00:00Z" };
    expect(clubStartStatus(club({ members: [...club().members, { ...other, role: "READER" }] })).done.people).toBe(false);
    expect(clubStartStatus(club({ members: [...club().members, { ...other, role: "LEADER" }] })).done.people).toBe(true);
    const invitation = { invitationId: "i1", email: "ny@exempel.se", createdAt: "2026-11-07T10:00:00Z", sentAt: null };
    expect(clubStartStatus(club({ invitations: [{ ...invitation, role: "READER" }] })).done.people).toBe(false);
    expect(clubStartStatus(club({ invitations: [{ ...invitation, role: "ADMIN" }] })).done.people).toBe(true);
  });

  it("texten till Eventor-administratören: klubben, Eventors väg och länken, ingen nyckel; mailto utan mottagare", () => {
    const link = "https://o-tid.exempel/organizer/clubs/abc#club";
    const body = clubStartSv.ask.body("OK Exempel", link);
    expect(body).toContain("OK Exempel");
    expect(body).toContain(`gå till ${EVENTOR_KEY_PLACE}`);
    expect(body).toContain(link);
    expect(body).toContain("Skicka inte nyckeln");
    const href = mailtoHref(clubStartSv.ask.subject("OK Exempel"), body);
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(href.split("&body=")[1]!)).toBe(body);
  });
});

describe("var nyckeln finns i Eventor", () => {
  it("är Klubb → Klubbinställningar (Eventors guide: Club → Club settings) överallt där O-Tid beskriver det", () => {
    expect(EVENTOR_KEY_PLACE).toBe("Klubb → Klubbinställningar");
    const help = clubHelpArticles.find(article => article.id === "klubben-i-eventor")!;
    const texts = [clubAffiliationSv.space.eventorHelp, sourcesSv.eventor.keyHelp, clubStartSv.steps.eventor.help, JSON.stringify(help.body)];
    for (const text of texts) expect(text).toContain(`i Eventor under ${EVENTOR_KEY_PLACE}`);
    expect(texts.join(" ")).not.toMatch(/Klubbens sidor|klubbens sidor|klubbens administration/);
  });
});
