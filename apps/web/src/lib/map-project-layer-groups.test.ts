import { describe, expect, it } from "vitest";
import { groupLayers } from "./map-project-layer-groups";

const layer = (name: string) => ({ name });

describe("underlagen grupperade per etapp", () => {
  it("slår ihop samma bild från en körning som delats i etapper, i listans ordning", () => {
    const groups = groupLayers([
      layer("Ortofoto 2023"),
      layer("Karttapullautin hela kartan – etapp 3 av 3 – relief"),
      layer("Karttapullautin hela kartan – etapp 3 av 3 – fuktdjup"),
      layer("Karttapullautin hela kartan – etapp 1 av 3 – relief"),
      layer("Karttapullautin hela kartan – etapp 2 av 3 – relief"),
      layer("Karttapullautin hela kartan – etapp 2 av 3 – fuktdjup")
    ]);
    expect(groups.map(group => [group.name, group.members.length])).toEqual([
      ["Ortofoto 2023", 1],
      ["Karttapullautin hela kartan – relief", 3],
      ["Karttapullautin hela kartan – fuktdjup", 2]
    ]);
    // Etapp 1 först inom gruppen.
    expect(groups[1]!.members.map(member => member.name)).toEqual([
      "Karttapullautin hela kartan – etapp 1 av 3 – relief",
      "Karttapullautin hela kartan – etapp 2 av 3 – relief",
      "Karttapullautin hela kartan – etapp 3 av 3 – relief"
    ]);
  });

  it("lämnar ensamma etapper och underlag utan etapp som de är", () => {
    const groups = groupLayers([layer("Körning – etapp 1 av 2 – relief"), layer("Relief"), layer("Relief")]);
    expect(groups.map(group => [group.name, group.members.length])).toEqual([
      ["Körning – etapp 1 av 2 – relief", 1], ["Relief", 1], ["Relief", 1]
    ]);
    expect(groupLayers([])).toEqual([]);
  });
});
