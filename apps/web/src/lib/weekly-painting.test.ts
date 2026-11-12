import { describe, expect, it } from "vitest";
import { paintingOfTheWeek, paintingTechnique } from "./weekly-painting";

const title = (instant: string) => paintingOfTheWeek(new Date(instant)).title;

describe("veckans målning", () => {
  it("är densamma hela veckan, måndag 00:00 till söndag 23:59 svensk tid", () => {
    // Vecka 47 2026: måndag 16 nov 00:00 svensk tid (CET) är 15 nov 23:00 UTC.
    const week = ["2026-11-15T23:00:00Z", "2026-11-17T12:00:00Z", "2026-11-20T09:00:00Z", "2026-11-22T22:59:59Z"].map(title);
    expect(new Set(week).size).toBe(1);
  });

  it("byts vid måndag 00:00 svensk tid, inte vid midnatt UTC", () => {
    expect(title("2026-11-15T22:59:59Z")).toBe("skym");
    expect(title("2026-11-15T23:00:00Z")).toBe("nav");
    // Sommartid (CEST): måndag 29 mars 2027 00:00 svensk tid är 28 mars 22:00 UTC.
    expect(title("2027-03-28T21:59:59Z")).not.toBe(title("2027-03-28T22:00:00Z"));
    expect(title("2027-03-28T22:00:00Z")).toBe(title("2027-03-29T21:00:00Z"));
  });

  it("visar alla sju under sju veckor i följd, i listans ordning, och börjar om", () => {
    const mondays = Array.from({ length: 8 }, (_, week) => new Date(Date.UTC(2026, 10, 9 + week * 7, 12)).toISOString());
    const titles = mondays.map(title);
    expect(titles.slice(0, 7)).toEqual(["skym", "nav", "pinn", "strandad", "inspärra", "grums", "kuling"]);
    expect(titles[7]).toBe("skym");
  });

  it("går vidare över årsskiftet utan att hoppa (2026 har 53 ISO-veckor)", () => {
    // Vecka 53 2026 är 28 dec–3 jan; nyårsdagen hör till samma vecka och vecka 1 2027 ger nästa målning.
    expect(title("2026-12-28T00:00:00+01:00")).toBe("skym");
    expect(title("2027-01-01T12:00:00+01:00")).toBe("skym");
    expect(title("2027-01-03T23:59:59+01:00")).toBe("skym");
    expect(title("2027-01-04T00:00:00+01:00")).toBe("nav");
    expect(title("2027-12-31T12:00:00+01:00")).toBe(title("2028-01-02T12:00:00+01:00"));
  });

  it("klarar tid före första veckan och ger bildadress, mått och teknik på båda språken", () => {
    expect(title("2026-11-08T12:00:00Z")).toBe("kuling");
    const pinn = paintingOfTheWeek(new Date("2026-11-25T12:00:00Z"));
    expect(pinn).toMatchObject({ title: "pinn", src: "/malningar/pinn.jpg", width: 1000, height: 828, size: "38 × 46 cm", year: 2024 });
    expect(paintingTechnique(pinn, "sv")).toBe("akryl och olja på duk");
    expect(paintingTechnique(pinn, "en")).toBe("acrylic and oil on canvas");
  });
});
