import { describe, expect, it } from "vitest";
import { activeAppTab, appTabParent, appTabsHidden, APP_TAB_LINKS, appTopTitle } from "./app-tabs";

const RACE = "/admin/1b0c5e2a-0000-4000-8000-000000000000";

describe("flikraden (förslag B)", () => {
  it("markerar fliken som hör till sidan", () => {
    expect(activeAppTab("/organizer")).toBe("home");
    expect(activeAppTab("/organizer/")).toBe("home");
    expect(activeAppTab("/organizer", "#lagg-banor")).toBe("courses");
    expect(activeAppTab("/organizer", "#dina-tavlingar")).toBe("events");
    expect(activeAppTab("/organizer", "#mina-klubbar")).toBe("club");
    expect(activeAppTab("/organizer#dina-tavlingar")).toBe("events");
    expect(activeAppTab("/organizer/map-projects")).toBe("maps");
    expect(activeAppTab("/organizer/map-projects/abc")).toBe("maps");
    expect(activeAppTab("/organizer/clubs/abc")).toBe("club");
    expect(activeAppTab("/organizer/clubs/abc/arkiv/def")).toBe("club");
    expect(activeAppTab("/organizer/groups/abc")).toBe("club");
    expect(activeAppTab(`${RACE}/manage`)).toBe("events");
    expect(activeAppTab(`${RACE}/bingo`)).toBe("events");
    expect(activeAppTab(`${RACE}/course-setting/print`)).toBe("courses");
    expect(activeAppTab("/konto")).toBeNull();
    expect(activeAppTab("/superadmin")).toBeNull();
  });

  it("visas inte i helskärmslägen och kioskvyer", () => {
    expect(appTabsHidden("/organizer/map-projects/abc/map")).toBe(true);
    expect(appTabsHidden("/organizer/clubs/abc/planering/utskrift")).toBe(true);
    for (const page of ["course-setting", "course-setting/layout", "course-setting/print", "course-setting/descriptions",
      "course-setting/map-errors", "speaker", "stations", "readout"]) expect(appTabsHidden(`${RACE}/${page}`), page).toBe(true);
    for (const path of ["/organizer", "/organizer/map-projects", "/organizer/map-projects/abc", "/organizer/clubs/abc", "/konto",
      "/superadmin", `${RACE}/manage`, `${RACE}/maps`, `${RACE}/imports`, `${RACE}/bingo`]) expect(appTabsHidden(path), path).toBe(false);
  });

  it("har fem flikar i skissens ordning, alla till befintliga sidor", () => {
    expect(APP_TAB_LINKS.map(link => link.tab)).toEqual(["home", "maps", "courses", "events", "club"]);
    expect(APP_TAB_LINKS.every(link => link.href.startsWith("/organizer"))).toBe(true);
  });

  it("ger sidans förälder för bakåtlänken i telefonens sidhuvud (steg F1)", () => {
    expect(appTabParent("/organizer")).toBeNull();
    expect(appTabParent("/organizer/")).toBeNull();
    expect(appTabParent("/organizer#mina-klubbar")).toBeNull();
    expect(appTabParent("/organizer/map-projects")).toBeNull();
    expect(appTabParent("/organizer/map-projects/abc")).toBe("/organizer/map-projects");
    expect(appTabParent("/organizer/clubs/abc")).toBe("/organizer");
    expect(appTabParent("/organizer/clubs/abc/arkiv/def")).toBe("/organizer/clubs/abc");
    expect(appTabParent("/organizer/clubs/abc/arkiv/def?x=1")).toBe("/organizer/clubs/abc");
    expect(appTabParent("/organizer/groups/abc")).toBe("/organizer");
    expect(appTabParent("/konto")).toBe("/organizer");
    expect(appTabParent("/konto/flytta-google")).toBe("/konto");
    expect(appTabParent("/superadmin")).toBe("/organizer");
  });

  it("ger rubriken i telefonens sidhuvud", () => {
    expect(appTopTitle("/organizer")).toBe("hub");
    expect(appTopTitle("/organizer#mina-klubbar")).toBe("hub");
    expect(appTopTitle("/organizer/map-projects")).toBe("maps");
    expect(appTopTitle("/organizer/map-projects/abc")).toBe("maps");
    expect(appTopTitle("/organizer/clubs/abc/arkiv/def")).toBe("club");
    expect(appTopTitle("/organizer/groups/abc")).toBe("club");
    expect(appTopTitle("/konto")).toBe("account");
    expect(appTopTitle("/konto/flytta-google")).toBe("account");
    expect(appTopTitle("/superadmin")).toBe("superadmin");
  });
});
