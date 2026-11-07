import { describe, expect, it, vi } from "vitest";
import type * as Application from "@o-tid/application";
import { printJobRequestSchema } from "@o-tid/contracts";
import { BUILT_IN_PRINT_PROFILES, BUILT_IN_TEMPLATES, type LayoutTemplate } from "@o-tid/course-setting";
import type { MapColor } from "@o-tid/map-file";
import { pdfAllowed, pdfPreflight, printJobRequest } from "./course-setting-print-jobs";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { courseSettingRequirementFor } from "./race-roles";
import { db, dependencies, environment, id, request, token } from "./race-administrator-route-test-helpers";

const selection = { items: [{ course: "1" }, { course: "2", variant: "AB" }], template: undefined, templateIsDraft: false, savedTemplateIds: [],
  header: true, fill: "FILL" as const, perRunner: false, duplex: false };
const color = (id: number, name: string, cmyk: MapColor["cmyk"]): MapColor => ({ id, name, rank: id, cmyk, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 });

describe("PDF för tryck: förfrågan och förhandskontrollen (steg 65)", () => {
  it("beskriver samma ark som förhandsvisningen: banor per sida, färdig mall som id, osparad mall hel, löpare med baksidor", () => {
    const pages = printJobRequest(selection, "PRESS", "as-file", { warnings: false, rules: [] }, "11111111-1111-4111-8111-111111111111");
    expect(printJobRequestSchema.parse(pages)).toMatchObject({ kind: "PRESS", layout: { kind: "PAGES", header: true }, items: [{ course: "1" }, { course: "2", variant: "AB" }] });
    const template = BUILT_IN_TEMPLATES.find(item => item.id === "a4-four")!;
    expect(printJobRequest({ ...selection, template }, "OFFICE", "office", { warnings: true, rules: [] }).layout).toEqual({ kind: "TEMPLATE", template: "a4-four", fill: "FILL" });
    const draft: LayoutTemplate = { ...template, id: "egen", name: "Egen" };
    expect(printJobRequest({ ...selection, template: draft, templateIsDraft: true }, "PRESS", "as-file", { warnings: false, rules: [] }).layout)
      .toMatchObject({ kind: "TEMPLATE", template: { id: "egen" } });
    const runners = printJobRequest({ ...selection, template, perRunner: true, duplex: true, items: [{ course: "1",
      runner: { kind: "RUNNER", name: "Anna", className: "D21", startTime: "18:02", startNumber: 4 } }] }, "PRESS", "as-file", { warnings: true, rules: ["black"] });
    expect(printJobRequestSchema.parse(runners)).toMatchObject({ perRunner: true, duplex: true, items: [{ runner: { name: "Anna", club: null } }],
      warningsConfirmed: true, confirmedRules: ["black"] });
  });

  it("kartbyten (ADR-0203): delen följer med och dubbelsidigt gäller delarna utan löpare", () => {
    const parts = printJobRequest({ ...selection, header: false, duplex: true, items: [{ course: "1", part: 0 }, { course: "1", part: 1 }] }, "PRESS", "as-file",
      { warnings: true, rules: [] });
    expect(printJobRequestSchema.parse(parts)).toMatchObject({ perRunner: false, duplex: true, items: [{ course: "1", part: 0 }, { course: "1", part: 1 }] });
    // Utan dubbelsidigt valt blir det inte dubbelsidigt.
    expect(printJobRequest({ ...selection, items: [{ course: "1", part: 1 }] }, "PRESS", "as-file", { warnings: true, rules: [] }).duplex).toBe(false);
  });

  it("förhandskontrollen mot PDF:en: övertryck går, PDF/X stoppar, varningar måste bekräftas", () => {
    const bl = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-08-27")!;
    const colors = [color(1, "Svart", { c: 0, m: 0, y: 0, k: 0.9 })];
    const report = pdfPreflight(bl, colors, new Set());
    expect(report.findings.some(finding => /äkta övertryck/.test(finding.text))).toBe(false);
    expect(report.canPrint).toBe(true);
    expect(pdfAllowed(report, false)).toBe(false);
    expect(pdfAllowed(report, true)).toBe(true);
    const pdfX = pdfPreflight({ ...bl, requirements: { pdfX: true, icc: false, trueOverprint: true } }, colors, new Set());
    expect(pdfX.canPrint).toBe(false);
    expect(pdfAllowed(pdfX, true)).toBe(false);
  });
});

describe("administratörsroutes: PDF-jobben", () => {
  const get = (path = "https://otid.example/api/admin") => new Request(path, { headers: { cookie: `__Host-otid-organizer-session=${token}` } });

  it("bara admin: banläggningens ADMIN för alla fyra åtgärderna", () => {
    expect(courseSettingRequirementFor("course-setting-print-jobs", "GET")).toBe("ADMIN");
    expect(courseSettingRequirementFor("course-setting-print-jobs", "POST")).toBe("ADMIN");
    expect(courseSettingRequirementFor("course-setting-print-job", "DELETE")).toBe("ADMIN");
    expect(courseSettingRequirementFor("course-setting-print-job-pdf", "GET")).toBe("ADMIN");
  });

  it("skapar (201, 422 med besked), ger PDF:en som privat bilaga och tar bort; fel id och metod avvisas", async () => {
    const job = { id, kind: "PRESS" as const, status: "QUEUED" as const, label: "Tryckeri", documentVersion: 3, createdAt: "2026-11-02T10:00:00.000Z",
      startedAt: null, finishedAt: null, pages: null, byteLength: null, error: null, plates: [], overprint: false, notes: [], position: 1 };
    const printJobCreate = vi.fn<typeof Application.createPrintJobAsAdmin>().mockResolvedValue({ status: "ok", job, created: true });
    const printJobPdf = vi.fn<typeof Application.readPrintJobPdfAsAdmin>().mockResolvedValue({ status: "ok", pdf: new TextEncoder().encode("%PDF-1.7"),
      fileName: "banor-tryck-20261102-1000.pdf" });
    const printJobDelete = vi.fn<typeof Application.deletePrintJobAsAdmin>().mockResolvedValue({ status: "ok" });
    const services = { ...dependencies(), printJobCreate, printJobPdf, printJobDelete };
    const body = JSON.stringify(printJobRequest(selection, "PRESS", "as-file", { warnings: false, rules: [] }));
    const created = await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting-print-jobs" }, services, environment);
    expect(created.status).toBe(201);
    expect(services.authenticateCourseSetting.mock.calls.at(-1)![1]).toMatchObject({ required: "ADMIN", requireCsrf: true });
    printJobCreate.mockResolvedValueOnce({ status: "problem", problem: { formatVersion: 1, problem: "TOO_MANY_JOBS", message: "Högst 3" } });
    const problem = await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting-print-jobs" }, services, environment);
    expect(problem.status).toBe(422);
    const pdf = await raceAdministratorRoute(db, get(), id, { kind: "course-setting-print-job-pdf", jobId: id }, services, environment);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("cache-control")).toBe("private, no-store");
    expect(pdf.headers.get("content-disposition")).toBe('attachment; filename="banor-tryck-20261102-1000.pdf"');
    expect(new TextDecoder().decode(await pdf.arrayBuffer())).toBe("%PDF-1.7");
    expect((await raceAdministratorRoute(db, request("DELETE", ""), id, { kind: "course-setting-print-job", jobId: id }, services, environment)).status).toBe(204);
    expect((await raceAdministratorRoute(db, get(), id, { kind: "course-setting-print-job-pdf", jobId: "../x" }, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("PUT", body), id, { kind: "course-setting-print-jobs" }, services, environment)).status).toBe(405);
    services.authenticateCourseSetting.mockResolvedValue({ status: "forbidden" });
    expect((await raceAdministratorRoute(db, get(), id, { kind: "course-setting-print-job-pdf", jobId: id }, services, environment)).status).toBe(403);
    expect(printJobPdf).toHaveBeenCalledTimes(1);
  });
});
