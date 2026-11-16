import { describe, expect, it } from "vitest";
import { demoRacePath, introFilmUrl, mapFilmUrl } from "./intro-film";

describe("introFilmUrl", () => {
  it("ger ingen adress när variabeln saknas eller är tom", () => {
    expect(introFilmUrl({})).toBeUndefined();
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: "" })).toBeUndefined();
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: "   " })).toBeUndefined();
  });

  it("godtar http(s)-adresser och sökvägar på samma värd", () => {
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: " https://video.exempel.se/o-tid " })).toBe("https://video.exempel.se/o-tid");
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: "/film/o-tid.mp4" })).toBe("/film/o-tid.mp4");
  });

  it("visar ingen länk för andra scheman eller adresser utan värd", () => {
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: "javascript:alert(1)" })).toBeUndefined();
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: "//annan.se/film" })).toBeUndefined();
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: "film.mp4" })).toBeUndefined();
  });

  it("på engelska gäller den engelska filmen när den finns, annars den svenska", () => {
    const both = { NEXT_PUBLIC_INTRO_FILM_URL: "/media/otid-intro-sv.mp4", NEXT_PUBLIC_INTRO_FILM_URL_EN: "/media/otid-intro-en.mp4" };
    expect(introFilmUrl(both, "sv")).toBe("/media/otid-intro-sv.mp4");
    expect(introFilmUrl(both, "en")).toBe("/media/otid-intro-en.mp4");
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL: "/media/otid-intro-sv.mp4" }, "en")).toBe("/media/otid-intro-sv.mp4");
    expect(introFilmUrl({ ...both, NEXT_PUBLIC_INTRO_FILM_URL_EN: "javascript:alert(1)" }, "en")).toBe("/media/otid-intro-sv.mp4");
    expect(introFilmUrl({ NEXT_PUBLIC_INTRO_FILM_URL_EN: "/media/otid-intro-en.mp4" }, "sv")).toBeUndefined();
  });

  it("filmen om kartritningen har sina egna adresser", () => {
    const map = { NEXT_PUBLIC_MAP_FILM_URL: "/media/otid-kartritning-sv.mp4", NEXT_PUBLIC_MAP_FILM_URL_EN: "/media/otid-kartritning-en.mp4" };
    expect(mapFilmUrl({})).toBeUndefined();
    expect(mapFilmUrl(map)).toBe("/media/otid-kartritning-sv.mp4");
    expect(mapFilmUrl(map, "en")).toBe("/media/otid-kartritning-en.mp4");
    expect(introFilmUrl(map)).toBeUndefined();
  });

  it("demotävlingen: bara en giltig kort kod ger en länk", () => {
    expect(demoRacePath({ OTID_DEMO_RACE: " K7M2QX " })).toBe("/t/k7m2qx");
    expect(demoRacePath({ OTID_DEMO_RACE: "k7m2q" })).toBeUndefined();
    expect(demoRacePath({ OTID_DEMO_RACE: "../adm" })).toBeUndefined();
    expect(demoRacePath({})).toBeUndefined();
  });
});

