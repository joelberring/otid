import { describe, expect, it } from "vitest";
import { invitationSummary } from "../i18n/invitation-sv";
import { inviteAll, parseInvitationAddresses } from "./invitation-bulk";

describe("ADR-0206: flera adresser på en gång", () => {
  it("delar på komma, semikolon, mellanslag och ny rad, tar bort dubbletter och säger vilka som är ogiltiga", () => {
    expect(parseInvitationAddresses("anna@klubb.se, Bo@Klubb.se;cia@klubb.se\nanna@klubb.se  inte-en-adress\n\n"))
      .toEqual({ addresses: ["anna@klubb.se", "bo@klubb.se", "cia@klubb.se"], invalid: ["inte-en-adress"] });
  });

  it("tar adressen ur Namn <adress> från ett e-postprogram", () => {
    expect(parseInvitationAddresses("Anna Andersson <anna@klubb.se>, Bo Berg <bo@klubb.se>").addresses).toEqual(["anna@klubb.se", "bo@klubb.se"]);
  });

  it("räknar ihop och sammanfattar", async () => {
    const outcomes = { "a@k.se": "sent", "b@k.se": "sent", "c@k.se": "existing", "d@k.se": "throttled" } as const;
    const { tally } = await inviteAll(Object.keys(outcomes), 1, async email => outcomes[email as keyof typeof outcomes]);
    expect(invitationSummary(tally)).toBe("2 inbjudningar skickade, 1 inbjudan sparad men inte skickad (för många just nu, skicka igen senare), "
      + "1 adress fanns redan i listan, 1 adress var ogiltig.");
    expect(invitationSummary({ sent: 5, saved: 0, throttled: 0, failed: 0, invalid: 1, existing: 0, other: 0 }))
      .toBe("5 inbjudningar skickade, 1 adress var ogiltig.");
  });

  it("stoppar vid ett fel som gäller alla (utloggad)", async () => {
    let calls = 0;
    const result = await inviteAll(["a@k.se", "b@k.se"], 0, async () => { calls += 1; return { fatal: 401 }; });
    expect(result.fatal).toBe(401);
    expect(calls).toBe(1);
  });
});
