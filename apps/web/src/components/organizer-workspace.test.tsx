import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK151 event admin panel", () => {
  it("shows the grant manager only for owner events and includes reviewed identity and retry states", () => {
    const component = source("./organizer-workspace.tsx");
    expect(component).toContain('event.role === "OWNER" && <EventAdministratorsDisclosure');
    expect(component).toContain("{hasExpanded && <div id={panelId} hidden={!expanded}>");
    expect(component).toContain("aria-expanded={expanded}");
    expect(component).toContain("copy.adminReview(loginName.trim().toLowerCase())");
    expect(component).toContain("saveOrganizerAdminAttempt(current)");
    expect(component).toContain("onClick={() => void submit(attempt)}");
    expect(component).toContain("copy.adminAbandonAttempt");
    expect(component).toContain('role="alert"');
  });

  it("keeps Swedish labels and touch-sized controls in the compact layout", () => {
    const copy = source("../i18n/organizer-sv.ts");
    const styles = source("./organizer-workspace.module.css");
    expect(copy).toContain('adminPanel: "Medadministratörer"');
    expect(copy).toContain('adminGrant: "Ge eventåtkomst"');
    expect(copy).toContain('adminShow: "Visa medadministratörer"');
    expect(copy).toContain('openRace: "Öppna arbetsytan"');
    expect(styles).toContain(".adminPanel");
    expect(styles).toMatch(/\.adminDisclosure > button \{[^}]*min-height: 44px;[^}]*text-align: left;/);
    expect(styles).toContain(".adminForm input, .adminForm button { width: 100%; min-height: 48px; }");
    expect(styles).toContain("@media (max-width: 700px)");
  });
});

describe("TASK160 owner account invitations", () => {
  it("keeps issuance owner-scoped, hash-only on the wire, and retryable in memory", () => {
    const component = source("./organizer-workspace.tsx");
    expect(component).toContain('event.role === "OWNER" && <EventAdministratorsDisclosure');
    expect(component).toContain("crypto.getRandomValues(new Uint8Array(32))");
    expect(component).toContain('crypto.subtle.digest("SHA-256", bytes)');
    expect(component).toContain('codeHash\n      });');
    expect(component).toContain('`organizer-account-invitation-issue:${current.request.requestId}`');
    expect(component).toContain("onClick={() => void submitIssue(issueAttempt)}");
    expect(component).toContain("code: current.code");
    expect(component).toContain("setIssued(undefined);");
    expect(component).not.toMatch(/localStorage|sessionStorage/);
    expect(component).toContain("navigator.clipboard.writeText(issued.code)");
    expect(component).toContain("copy.invitationHideCode");
  });

  it("uses scoped listing and idempotent revoke with a compact mobile layout", () => {
    const component = source("./organizer-workspace.tsx");
    const copy = source("../i18n/organizer-sv.ts");
    const styles = source("./organizer-workspace.module.css");
    expect(component).toContain("/account-invitations");
    expect(component).toContain("/account-invitations/${encodeURIComponent(current.invitationId)}/revoke");
    expect(component).toContain('`organizer-account-invitation-revoke:${current.requestId}`');
    expect(component).toContain("organizerAccountInvitationListResponseSchema.parse");
    expect(copy).toContain('invitationPanel: "Bjud in ett nytt konto"');
    expect(copy).toContain("Kontot får ingen eventåtkomst");
    expect(copy).toContain("Aktivering skapar bara ett konto.");
    expect(styles).toContain(".invitationForm input, .invitationForm button { width: 100%; min-height: 48px; }");
    expect(styles).toContain(".invitationForm { grid-template-columns: minmax(0, 1fr); }");
    expect(styles).toContain("overflow-wrap: anywhere");
  });
});
