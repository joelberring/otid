import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaderOff } from "./leader-frame";
import { courseSettingTrainingPath, linkedCourseSettingTab } from "../../lib/course-setting-tab";

// Komponenterna använder JSX utan att importera React (Next); testet ger dem React (vitest kompilerar klassiskt).
(globalThis as { React?: typeof React }).React = React;
const raceId = "00000000-0000-4000-8000-000000000001";

describe("ledarsidan utan påslagen övning (översynen 2026-11-17)", () => {
  it("lugnt besked, var övningen slås på, knapp till fliken Träning och vägen tillbaka till tävlingen", () => {
    const html = renderToStaticMarkup(<LeaderOff raceId={raceId} />);
    expect(html).toContain("Ingen övning i mobilen är påslagen");
    expect(html).toContain("fliken Träningsformer");
    expect(html).toContain(`href="/admin/${raceId}/course-setting?flik=traning"`);
    expect(html).toContain(`href="/admin/${raceId}/manage"`);
    expect(html).not.toContain("data-tone=\"error\"");
  });
  it("banläggningens `?flik=` öppnar bara kända flikar", () => {
    expect(courseSettingTrainingPath(raceId)).toBe(`/admin/${raceId}/course-setting?flik=traning`);
    expect(linkedCourseSettingTab("?flik=traning")).toBe("training");
    expect(linkedCourseSettingTab("?flik=Träning")).toBe("training");
    expect(linkedCourseSettingTab("?flik=toString")).toBeUndefined();
    expect(linkedCourseSettingTab("")).toBeUndefined();
  });
});
