import { describe, expect, it } from "vitest";
import type { PlanTaskMail } from "@o-tid/application";
import { planTaskMessage } from "./club-planning-route-handlers";

const mail = (patch: Partial<PlanTaskMail> = {}): PlanTaskMail => ({ to: "a@example.se", inviterName: "Anna", clubName: "OK Test", kind: "TASK",
  taskTitle: "Sätta ut kontroller", sessionTitle: "Nattträning", sessionDate: "2027-01-05", startTime: "18:00", place: "Skogen", repeats: null,
  account: "MEMBER", ...patch });

describe("användartestet 2026-11-12 (D): mejlet om uppgiften", () => {
  it("säger till en adress utan konto att kontot ska skapas, och länkar dit", () => {
    const none = planTaskMessage(mail({ account: "NONE" }), "https://o-tid.se");
    expect(none.text).toContain("Du behöver ett konto i O-Tid med just den här adressen.");
    expect(none.text).toContain("https://o-tid.se/organizer?konto=skapa");
    const member = planTaskMessage(mail(), "https://o-tid.se");
    expect(member.text).toContain("Mina uppgifter");
    expect(member.text).toContain("https://o-tid.se/organizer\n");
    expect(member.subject).toBe("Uppgift i O-Tid: Sätta ut kontroller tisdag 5 januari");
  });

  it("ansvarig för en träning varje vecka blir ett mejl med veckorna", () => {
    const message = planTaskMessage(mail({ kind: "RESPONSIBLE", taskTitle: "", repeats: { count: 8, lastDate: "2027-02-23" } }), "https://o-tid.se");
    expect(message.subject).toBe("Ansvarig i O-Tid: Nattträning tisdag 5 januari");
    expect(message.text).toContain("Anna i OK Test har gjort dig ansvarig för en träning.");
    expect(message.text).toContain("Samma träning varje vecka, 8 gånger till och med tisdag 23 februari.");
  });
});
