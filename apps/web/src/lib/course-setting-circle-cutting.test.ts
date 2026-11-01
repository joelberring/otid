import { describe, expect, it } from "vitest";
import { applyEdit } from "@o-tid/course-setting";
import {
  bakeEdits, circleCuttingEdit, circleCuttingOf, currentDetailGaps, detailRequest
} from "./course-setting-circle-cutting";
import { MapRenderSession, type MapRenderRequest, type MapRenderResponse } from "./course-setting-map-protocol";
import { testDocument } from "./course-setting-test-document";

/** Ringklipp (ADR-0180 beslut 10): valen, beställningen till kartans Worker och vilka gap som gäller efter en flytt. */
describe("ringklipp i editorn", () => {
  it("valen är av när de saknas och ändras med SET_EVENT", () => {
    const document = testDocument();
    expect(circleCuttingOf(document)).toEqual({ overlap: false, details: false });
    const edit = circleCuttingEdit(document, { details: true });
    expect(edit).toEqual({ type: "SET_EVENT", changes: { circleCutting: { overlap: false, details: true } } });
    const next = applyEdit(document, edit).document;
    expect(circleCuttingOf(next)).toEqual({ overlap: false, details: true });
    expect(circleCuttingOf(applyEdit(next, circleCuttingEdit(next, { overlap: true })).document)).toEqual({ overlap: true, details: true });
  });

  it("beställer ringarna för kontroller och mål; nyckeln ändras när en kontroll flyttas, inte annars", () => {
    const document = testDocument();
    const request = detailRequest(document);
    expect(request.circles.map(circle => circle.id).sort()).toEqual(["a", "b", "f"]);
    expect(request.sprint).toBe(false);
    expect(detailRequest(applyEdit(document, { type: "UPDATE_COURSE", course: "k", changes: { name: "Kort" } }).document).key).toBe(request.key);
    expect(detailRequest(applyEdit(document, { type: "MOVE_CONTROL", control: "a", at: { x: 11, y: 0 } }).document).key).not.toBe(request.key);
  });

  it("en flyttad kontroll ritas hel tills gapen räknats om", () => {
    const document = testDocument();
    const request = detailRequest(document);
    const gaps = { a: [{ startDegrees: 80, endDegrees: 100 }], b: [{ startDegrees: 10, endDegrees: 20 }], f: [{ startDegrees: 0, endDegrees: 5 }] };
    expect(currentDetailGaps({ circles: request.circles, gaps }, request)).toEqual(gaps);
    // 31 flyttas: dess gap gäller inte, och inte heller 32:s (sträckan från 31 kommer in från ett annat håll). Målet står kvar.
    const moved = detailRequest(applyEdit(document, { type: "MOVE_CONTROL", control: "a", at: { x: 12, y: 0 } }).document);
    expect(currentDetailGaps({ circles: request.circles, gaps }, moved)).toEqual({ f: gaps.f });
    expect(currentDetailGaps(undefined, request)).toBeUndefined();
  });

  it("gör klippen fasta med en ändring per kontroll", () => {
    const document = testDocument();
    const { edits, controls } = bakeEdits(document, { a: [{ startDegrees: 80, endDegrees: 100 }] });
    expect(controls).toBe(1);
    expect(edits[0]).toMatchObject({ type: "SET_CIRCLE_GAPS", control: "a" });
    expect(bakeEdits(document, undefined)).toEqual({ edits: [], controls: 0 });
  });

  it("kartans Worker: bara svaret på den senaste beställningen används", () => {
    const posted: MapRenderRequest[] = [];
    const fake = { postMessage: (message: MapRenderRequest) => posted.push(message), terminate: () => undefined } as unknown as Worker;
    const session = new MapRenderSession(() => fake, () => undefined, () => undefined);
    const results: unknown[] = [];
    session.detailGaps([], false, gaps => results.push(gaps));
    session.detailGaps([], false, gaps => results.push(gaps));
    const reply = (id: number) => { fake.onmessage!({ data: { type: "detailGaps", id, gaps: { a: [{ startDegrees: id, endDegrees: id + 1 }] } } satisfies MapRenderResponse } as MessageEvent); };
    reply(1); reply(2);
    expect(posted.map(message => message.type)).toEqual(["detailGaps", "detailGaps"]);
    expect(results).toEqual([{ a: [{ startDegrees: 2, endDegrees: 3 }] }]);
  });
});
