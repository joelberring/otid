import { describe, expect, it } from "vitest";
import { introFilmUrl } from "./intro-film";

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
});
