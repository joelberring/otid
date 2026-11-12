import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { createOrganizerEvent } from "../../src/organizer-events";
import { grantRacePersonAsAdmin } from "../../src/race-people";
import { readInvitationLink, type InvitationMail } from "../../src/invitation-links";
import { completePasswordReset, requestPasswordReset } from "../../src/password-reset";
import { requireRaceRole } from "../../src/race-session";
import { db, useRaceDatabase } from "./race-fixtures";
import { registerTestAccount } from "./accounts";

useRaceDatabase();

/**
 * Användartestet 2026-11-12: en inbjuden funktionär har ett konto med obekräftad adress. Inbjudningslänken bekräftar inte
 * adressen (ADR-0206 beslut 4, tillägget 2026-11-12); bekräftelsemejlet som inbjudningssidan och tävlingssidan erbjuder
 * (återställningslänken) gör det, och då gäller behörigheten direkt.
 */
describe("inbjuden med obekräftad adress (användartestet 2026-11-12)", () => {
  const now = new Date("2026-11-12T10:00:00Z");

  it("länken ger ingenting; bekräftelsemejlet bekräftar adressen och behörigheten gäller", async () => {
    const owner = await registerTestAccount(db, undefined, now);
    const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Natt-KM", raceName: "", raceDate: "2026-11-12", timeZone: "Europe/Stockholm" }) }, now);
    if (created.status !== "created") throw new Error(created.status);
    const raceId = created.response.raceId;
    const invited = await registerTestAccount(db, undefined, now, { verified: false });
    const mails: InvitationMail[] = [];
    const requestId = randomUUID();
    await expect(grantRacePersonAsAdmin(db, { ...owner.proof, raceId, idempotencyKey: `race-person-grant:${requestId}`,
      readBody: async () => ({ formatVersion: 1, requestId, email: invited.email, role: "FUNCTIONARY" }) }, now,
    async mail => { mails.push(mail); })).resolves.toMatchObject({ status: "granted" });
    expect(mails).toHaveLength(1);

    // Länken visar inbjudan men bekräftar inte adressen; den inloggade saknar behörighet.
    await expect(readInvitationLink(db, mails[0]!.token, now)).resolves.toMatchObject({ status: "valid", email: invited.email });
    await expect(requireRaceRole(db, { ...invited.proof, raceId, role: "FUNCTIONARY" }, now)).resolves.toEqual({ status: "unauthorized" });
    const [before] = await db.select({ verifiedAt: schema.userAccounts.emailVerifiedAt }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, invited.accountId));
    expect(before?.verifiedAt).toBeNull();

    // "Skicka bekräftelsemejl": återställningslänken till adressen, nytt lösenord, adressen bekräftad och behörigheten tagen.
    const reset = await requestPasswordReset(db, { formatVersion: 1, email: invited.email }, { now });
    if (reset.status !== "accepted" || !reset.delivery) throw new Error("Inget mejl");
    const login = await completePasswordReset(db, { formatVersion: 1, token: reset.delivery.token, password: "ett-nytt-lösenord" }, { now });
    if (login.status !== "authenticated") throw new Error(login.status);
    await expect(requireRaceRole(db, { sessionToken: login.sessionToken, raceId, role: "FUNCTIONARY" }, now))
      .resolves.toMatchObject({ status: "authenticated", principal: { role: "FUNCTIONARY" } });
  });
});
