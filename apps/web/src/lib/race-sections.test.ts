import { describe, expect, it } from "vitest";
import { raceTypes, type RaceType } from "@o-tid/contracts";
import { raceTypeSv } from "../i18n/race-type-sv";
import { activeSection, raceTypeProfile, sectionForPanel, visibleSections } from "./race-sections";

const names = (type: RaceType) => visibleSections(raceTypeProfile(type)).map(section => raceTypeSv.sections[section.label]);

describe("tävlingstypen styr arbetsytans delar (ADR-0170 beslut 1)", () => {
  it("visar rätt delar per typ, med Inställningar sist", () => {
    expect(names("TRAINING")).toEqual(["Banor & klasser", "Deltagare", "Publicera", "Avläsning", "Resultat", "Inställningar"]);
    expect(names("SMALL")).toEqual(["Banor", "Klasser", "Anmälda", "Start", "Publicera", "Avläsning", "Resultat", "Inställningar"]);
    expect(names("STANDARD")).toEqual(["Banor", "Klasser", "Anmälda", "Start", "Publicera", "Avläsning", "Resultat", "Inställningar"]);
    expect(names("FORKED")).toEqual(["Banor", "Klasser", "Anmälda", "Start", "Publicera", "Avläsning", "Resultat", "Inställningar"]);
    expect(names("RELAY")).toEqual(["Banor", "Klasser & sträckor", "Lag", "Start", "Publicera", "Avläsning", "Resultat", "Inställningar"]);
    expect(names("ROGAINING")).toEqual(["Kontroller & poäng", "Deltagare", "Publicera", "Avläsning", "Resultat", "Inställningar"]);
  });

  it("styr funktioner och förval", () => {
    const features = (type: RaceType) => raceTypeProfile(type).features;
    expect(features("TRAINING")).toMatchObject({ draw: false, speaker: false, import: false, relay: false, variants: false, startRuleChoice: false });
    expect(features("SMALL")).toMatchObject({ draw: false, speaker: false, import: false, finalization: false, startRuleChoice: true });
    expect(features("STANDARD")).toMatchObject({ draw: true, speaker: true, import: true, finalization: true, relay: false, variants: false });
    expect(features("FORKED")).toMatchObject({ draw: true, speaker: true, import: true, variants: true, variantsProminent: true });
    expect(features("RELAY")).toMatchObject({ draw: false, speaker: true, relay: true, variants: true, variantsProminent: false });
    expect(features("ROGAINING")).toMatchObject({ draw: false, speaker: false, relay: false });
    // Stafett- och variantdelar finns bara i typerna som använder dem.
    for (const type of raceTypes) {
      expect(features(type).relay).toBe(type === "RELAY");
      expect(features(type).variants).toBe(type === "FORKED" || type === "RELAY");
      // ADR-0170 beslut 4: Eventor för tävlingarna och stafetten; banfil kan alla läsa under Banor.
      expect(features(type).eventor).toBe(type === "STANDARD" || type === "FORKED" || type === "RELAY");
      // ADR-0172 beslut 5: radiokontroller för alla typer med tävlingsmoment, inte Träning och Rogaining.
      expect(features(type).radio).toBe(type !== "TRAINING" && type !== "ROGAINING");
    }
  });

  it("samlar banor och klasser i en del för träning och rogaining", () => {
    const training = raceTypeProfile("TRAINING");
    expect(sectionForPanel(training, "CLASSES")?.id).toBe("COURSES");
    expect(sectionForPanel(training, "START")).toBeUndefined();
    expect(sectionForPanel(raceTypeProfile("ROGAINING"), "ROGAINING")?.label).toBe("CONTROLS_POINTS");
    expect(sectionForPanel(raceTypeProfile("STANDARD"), "CLASSES")?.id).toBe("CLASSES");
  });

  it("visar första delen när den valda delen saknas i typen", () => {
    expect(activeSection(raceTypeProfile("TRAINING"), "START").id).toBe("COURSES");
    expect(activeSection(raceTypeProfile("TRAINING"), "SETTINGS").id).toBe("SETTINGS");
    expect(activeSection(raceTypeProfile("RELAY"), "ENTRIES").label).toBe("TEAMS");
  });
});
