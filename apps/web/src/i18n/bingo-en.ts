import type { Texts } from "../lib/language";
import type { bingoSv } from "./bingo-sv";

/** Bingo orienteering: the grid in course setting, the runner's page and the leader's table. */
export const bingoEn: Texts<typeof bingoSv> = {
  setup: {
    heading: "Bingo",
    help: "A grid over the forest. Each group is its own course with its own square size; print the group's map under Print as usual. The squares follow the map's paper and are named A1, B1 … from the top left corner.",
    area: "The area",
    noArea: "Draw the area first: click two corners on the map (or more points; the rectangle around them is used).",
    areaSize: (width: number, height: number) => `${width} × ${height} m`,
    draw: "Draw the area",
    redraw: "Draw the area again",
    drawing: (count: number) => count === 0 ? "Click a corner of the area on the map." : count === 1 ? "Click the opposite corner." : `${count} points. Click Done.`,
    groups: "Groups",
    noGroups: "No groups yet.",
    name: "Group name",
    cell: "Square side (m)",
    scale: "Scale",
    mapScale: (scale: string) => `The map's (${scale})`,
    cells: (count: number) => count === 1 ? "1 square" : `${count} squares`,
    tooMany: "Too many squares: choose larger squares or a smaller area.",
    add: "Add group",
    open: "Show",
    remove: "Remove",
    suggestedName: (cell: number) => `Squares ${cell} m`,
    print: "Print: choose the group at the top and go to Print (A4 or A3, the scale above). The heading has the training's name, the group and the square size."
  }
};
