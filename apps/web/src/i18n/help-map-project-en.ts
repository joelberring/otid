import type { HelpArticle } from "./help-sv";

/** The owner 2026-11-10: the help in the map project's drawing mode (same ids, views and shape as `help-map-project-sv.ts`). */
export const mapProjectHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "ritlaget-sa-tanker-du",
    title: "How to think in the drawing mode",
    views: ["MAP_EDITOR"],
    body: [
      "The screen has three parts. The tools are small icons on the left, the map is in the middle and a panel with tabs is on the right. The line below the map always says what the chosen tool is waiting for.",
      [
        "First choose a symbol under ”Symbols”, then draw. The tool ”Draw” is chosen by itself.",
        "Hold the mouse over a square to see the symbol's number and name. Search by number or name in the field at the top.",
        "The latest symbols are at the top of the tab. The keys 1–9 choose them.",
        "”Edit” selects, moves and bends. Esc always takes you back there.",
        "The buttons for the selected object are in the row below the map: ”Delete”, ”Simplify”, ”Make smooth” and ”Move whole”.",
        "”Map only” hides the tools and the panel. The key § does the same.",
        "The dot at the top shows saving: filled when saved, an empty ring when changes are waiting. A text warning appears only when something is wrong."
      ],
      "The tabs divide what used to be one long list. ”Layers” is everything that can be turned off and locked: read [Turn off, fade and lock layers](#ritlaget-lager). ”Review” is proposals, sub-areas, notes, field checking and the norm check, and ”Process” is generalising and correcting the whole map.",
      "The keys and the wheel are in [Points, keys and the wheel](#ritlaget-punkter-tangenter)."
    ]
  },
  {
    id: "ritlaget-lager",
    title: "Turn off, fade and lock layers",
    views: ["MAP_EDITOR"],
    body: [
      "The symbol is the layer, as in OCAD and Mapper. There are no free layers to put objects in. Every group in the norm and every symbol can be turned off, locked and faded under the tab ”Layers”.",
      [
        "Turn off: press ”Shown” at the group. The button then shows ”Off”, and the objects are hidden until you press again.",
        "Freeze: press ”Open”. The button then shows ”Locked”. The objects are visible but cannot be selected or changed.",
        "”Faded” shows a locked layer pale, so that what you work with stands out.",
        "A single symbol: open the group. Every symbol has the same three buttons.",
        "Your own groups: ”New work layer” collects symbols you choose, for example all paths. They are turned off and locked as one group.",
        "Sketches that do not belong to the map: ”New sketch layer”. They are never written to the map file.",
        "New symbols cannot be created here yet. Objects with a symbol outside the norm are moved with ”Merge symbols”."
      ],
      "The base layers (aerial photo, laser, older maps) are further down in the same tab."
    ]
  },
  {
    id: "ritlaget-punkter-tangenter",
    title: "Points, keys and the wheel",
    views: ["MAP_EDITOR"],
    body: [
      "Most things can be done in three ways: with the icon on the left, with a key or in the wheel. The key is shown in the corner of the icon.",
      [
        "The keys are under the left hand: Q chooses ”Edit”, W ”Draw”, A ”Add point” and S ”Remove point”.",
        "Shift gives the variant: Shift+E ”Circle”, Shift+A ”Make smooth” and Shift+S ”Simplify”. C changes symbol and R marks checked.",
        "New point: choose ”Add point” and click the segment. Remove: choose ”Remove point” and click the point.",
        "In ”Edit”, Cmd-click or Ctrl-click does the same: on a point it is removed, on a segment there is a new one.",
        "Draw: click for corners, press and drag for a curve. Backspace removes the last point, Enter finishes and Esc cancels.",
        "The wheel: right-click the map, hold a finger on it or press space. It has the tools and the latest symbols.",
        "Change keys with ”Keys” at the bottom of the tool column. The choice is saved in the browser.",
        "Z undoes and Shift+Z redoes. Cmd or Ctrl + Z also works."
      ],
      "Also read [How to think in the drawing mode](#ritlaget-sa-tanker-du)."
    ]
  },
  {
    id: "ritlaget-markera-flera",
    title: "Select, move and rotate several objects",
    views: ["MAP_EDITOR"],
    body: [
      "In ”Edit” you can select several objects at once and change them together, as in a drawing program.",
      [
        "Drag a box on empty map. Everything the box touches is selected. An area that only surrounds the box is not included.",
        "Shift-click adds an object to the selection, or removes it from it.",
        "Move: drag inside the selection's box. All objects follow.",
        "Rotate: drag just outside a corner, where the cursor becomes a curved arrow. Everything turns around the centre of the box.",
        "Delete removes everything selected. Undo takes back the whole move, rotation or removal in one step.",
        "Move the map: hold space and drag, or drag with two fingers on the trackpad. A short press on space opens the wheel.",
        "A click on a single object selects only that one. Then you change its points as usual."
      ],
      "Locked and hidden layers are not included in a box. Read [Turn off, fade and lock layers](#ritlaget-lager)."
    ]
  }
];
