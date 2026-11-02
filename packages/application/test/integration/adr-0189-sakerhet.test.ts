import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addGroupMember, createTrainingGroup, listMyGroups, readGroupAsLeader } from "../../src/training-groups";
import { GROUP_CODE_MISSES_PER_HOUR, readGroupPublicView } from "../../src/training-group-public";
import { loginUserAccount } from "../../src/user-account";
import { db, useRaceDatabase } from "./race-fixtures";
import { registerTestAccount, TEST_PASSWORD } from "./accounts";

/**
 * ADR-0189 beslut 8–9: gruppkoden har en slumpad del och gissningar begränsas per IP-adress; att lägga till en ledare eller
 * medlem svarar likadant med och utan konto, och personen blir medlem när den loggar in med adressen.
 */
useRaceDatabase();

async function group() {
  const leader = await registerTestAccount(db);
  const requestId = randomUUID();
  const request = { formatVersion: 1, requestId, name: "Klubbens träning", code: "klubben" };
  const created = await createTrainingGroup(db, { ...leader.proof, request });
  if (created.status !== "created") throw new Error(`Gruppen skapades inte: ${created.status}`);
  return { leader, created, request };
}

describe("ADR-0189: träningsgrupper", () => {
  it("koden får en slumpad del som inte går att gissa; samma begäran ger samma kod", async () => {
    const { leader, created, request } = await group();
    expect(created.group.code).toMatch(/^klubben-[a-km-z2-9]{8}$/);
    const replay = await createTrainingGroup(db, { ...leader.proof, request });
    expect(replay).toMatchObject({ status: "created", replayed: true, group: { code: created.group.code } });
    const other = await createTrainingGroup(db, { ...leader.proof, request: { ...request, requestId: randomUUID() } });
    expect(other.status === "created" && other.group.code).not.toBe(created.group.code);
  });

  it("för många missade koder från samma IP-adress ger 'för många försök', också för en riktig kod; andra adresser påverkas inte", async () => {
    const { created } = await group();
    const clientKey = `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID().slice(0, 4)}`;
    expect((await readGroupPublicView(db, { code: created.group.code, sessionToken: null, clientKey })).status).toBe("ok");
    for (let index = 0; index < GROUP_CODE_MISSES_PER_HOUR; index += 1) {
      expect((await readGroupPublicView(db, { code: `gissning-${index}-abcdefgh`, sessionToken: null, clientKey })).status).toBe("not-found");
    }
    expect((await readGroupPublicView(db, { code: created.group.code, sessionToken: null, clientKey })).status).toBe("rate-limited");
    expect((await readGroupPublicView(db, { code: "gissning-x", sessionToken: null, clientKey })).status).toBe("rate-limited");
    expect((await readGroupPublicView(db, { code: created.group.code, sessionToken: null, clientKey: `${clientKey}-annan` })).status).toBe("ok");
    // En timme senare går det igen.
    expect((await readGroupPublicView(db, { code: created.group.code, sessionToken: null, clientKey },
      new Date(Date.now() + 61 * 60_000))).status).toBe("ok");
  });

  it("att lägga till en person svarar likadant med och utan konto; personen blir medlem när den loggar in", async () => {
    const { leader, created } = await group();
    const groupId = created.group.groupId;
    const member = await registerTestAccount(db);
    const unknown = `ingen.${randomUUID().slice(0, 8)}@test.o-tid.se`;
    const add = (email: string) => addGroupMember(db, { ...leader.proof, groupId, request: { formatVersion: 1, requestId: randomUUID(), email,
      role: "MEMBER" } });
    const withAccount = await add(member.email), withoutAccount = await add(unknown);
    if (withAccount.status !== "added" || withoutAccount.status !== "added") throw new Error("Personerna lades inte till");
    const shape = (value: typeof withAccount.member) => ({ ...value, memberId: "id", email: "e-post", addedAt: "tid" });
    expect(shape(withAccount.member)).toEqual(shape(withoutAccount.member));
    expect(withAccount.member).toMatchObject({ pending: true, accountId: null, displayName: null });
    // Samma adress igen: redan i listan.
    expect((await add(unknown)).status).toBe("conflict");

    // Personen loggar in: blir medlem; den andra väntar.
    expect((await loginUserAccount(db, { formatVersion: 1, email: member.email, password: TEST_PASSWORD })).status).toBe("authenticated");
    const view = await readGroupAsLeader(db, { ...leader.proof, groupId });
    if (view.status !== "ok") throw new Error("Vyn lästes inte");
    expect(view.view.members.map(row => [row.email, row.pending])).toEqual(expect.arrayContaining([[member.email, false], [unknown, true]]));
    const mine = await listMyGroups(db, member.proof);
    expect(mine.status === "ok" && mine.groups.map(row => row.groupId)).toContain(groupId);
  });
});
