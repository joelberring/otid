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

