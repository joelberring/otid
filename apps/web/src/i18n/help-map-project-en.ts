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
        "The latest symbols are at the top of the tab and in the tool wheel. The keys 1–6 show and hide the standard's groups under Layers.",
        "”Select” selects, moves and bends. Esc always takes you back there.",
        "The buttons for the selected object are in the row below the map: ”Delete”, ”Simplify”, ”Make smooth” and ”Move whole”.",
        "”Map only” hides the tools and the panel. The key § does the same.",
        "The dot at the top shows saving: filled when saved, an empty ring when changes are waiting. A text warning appears only when something is wrong."
      ],
      "The tabs divide what used to be one long list. ”Base map” is the steps for a new map: read [From laser data to a finished map](#ritlaget-arbetsgang); ”Layers” is everything that can be turned off, locked and faded. ”Review” is proposals, the norm check, notes, field checking and sub-areas, and ”Process” is generalising and correcting the whole map.",
      "The keys and the wheel are in [Points, keys and the wheel](#ritlaget-punkter-tangenter)."
    ]
  },
  {
    id: "ritlaget-arbetsgang",
    title: "From laser data to a finished map",
    views: ["MAP_EDITOR"],
    body: [
      "A new map is made in the same order every time, under the tab ”Base map”. Steps 2 and 3 are needed, step 1 is optional.",
      [
        "Before step 2: connect Lantmäteriet once. Read [How to connect Lantmäteriet](#lantmateriet-koppla).",
        "Step 1, optional: fetch orthophotos, soil moisture and the Forest Agency's maps to draw from. They are only a background.",
        "Step 2, ”Make the base map”: the guide runs the laser data and adds OpenStreetMap and clear-cuts. The result is a draft.",
        "Step 3, ”Review the draft”: the sliders change the draft at once. Add it with the row below the map.",
        "”Finish drawing”: choose a symbol under ”Symbols” and draw; change an object with ”Select”.",
        "Check under ”Review” › ”Norm check”.",
        "Export with ”To Export” last in ”Review”: a new map version or only the changes."
      ],
      "A draft is not saved in the map until you add it. Suggestions are something else: changes that an owner approves under ”Review”.",
      "A map that already has content: read [Edit a map that already exists](#ritlaget-redigera)."
    ]
  },
  {
    id: "ritlaget-redigera",
    title: "Edit a map that already exists",
    views: ["MAP_EDITOR"],
    body: [
      "A map from a map file, or a new map with the base map added, is edited with the symbols. The steps under ”Base map” are not needed then.",
      [
        "Open the map from the map project's page with ”Open the map”.",
        "”Finish drawing”: choose a symbol under ”Symbols” and draw; change an object with ”Select”.",
        "Change: click the object in ”Select” and drag the points. The buttons for the object are in the row at the object (at the bottom on a phone).",
        "Other people's changes and the AI's come as suggestions under ”Review”. An owner approves or rejects them.",
        "Check under ”Review” › ”Norm check”.",
        "Export with ”To Export” last in ”Review”. A new map version is saved in the project, and the original never changes."
      ],
      "The keys and the wheel are in [Points, keys and the wheel](#ritlaget-punkter-tangenter)."
    ]
  },
  {
    id: "lantmateriet-koppla",
    title: "How to connect Lantmäteriet",
    views: ["MAP_EDITOR"],
    body: [
      "The laser data for the base map is fetched from Lantmäteriet with your own account there. O-Tid has no account of its own at Lantmäteriet. Without the connection the guide in step 2 does not work, but other things do.",
      "This is needed:",
      [
        "An account on Lantmäteriet's Geotorget. As a private person you sign in with the Geotorget username and password.",
        "An organisation can instead use a system account in Lantmäteriet's API portal, with a key and a secret.",
        "The products below, ordered on Geotorget. Each product is ordered separately; without an order Lantmäteriet says no.",
        "Laserdata Nedladdning, skog: the base map in the guide, with contours, cliffs, marshes and green. Needed for the first map.",
        "Ortofoto Nedladdning: aerial photos to draw from, under ”Orthophoto from Lantmäteriet”. Optional.",
        "Ortofoto historiska Nedladdning: older aerial photos, a product of its own. Optional.",
        "Marktäcke, Byggnad and Fastighetsindelning: read with the laser data when the account has them. Optional; the base map is finished without them."
      ],
      "How to connect:",
      [
        "My account › Lantmäteriet: choose ”How to sign in”, fill in the credentials and press ”Save the credentials”.",
        "Reload the map's page. The first sub-step of the guide says whether Lantmäteriet is connected.",
        "Try it: open ”Laser runs (advanced)” and press ”Search laser tiles”. If a list of tiles appears, the laser data works.",
        "If O-Tid says that Lantmäteriet refused: check the credentials under My account and the order on Geotorget."
      ],
      "Without Lantmäteriet you can use OpenStreetMap under ”Load a vector file or OpenStreetMap”, ”Soil moisture (SLU)”, the Forest Agency's maps and your own images and vector files."
    ]
  },
  {
    id: "ritlaget-lager",
    title: "Turn off, fade and lock layers",
    views: ["MAP_EDITOR"],
    body: [
      "The symbol is the layer, as in OCAD and Mapper. There are no free layers to put objects in. Every group in the norm and every symbol can be turned off, locked and faded under the tab ”Layers”.",
      [
        "Turn off: press the eye at the group. The eye is crossed out, and the objects are hidden until you press again.",
        "Freeze: press the padlock. The objects are visible but cannot be selected or changed.",
        "Fade: the button next to the lock shows a locked layer pale, so that what you work with stands out.",
        "A single symbol: open the group. Every symbol has the same three buttons.",
        "Your own groups: ”New work layer” collects symbols you choose, for example all paths. They are turned off and locked as one group.",
        "Sketches that do not belong to the map: ”New sketch layer”. They are never written to the map file.",
        "Symbols hidden in the map file, for example a base map from CAD, are in ”Sketch layers from the map file”. Turn the layer on to see them.",
        "New symbols cannot be created here yet. Objects outside the norm and the sketch layers are moved with ”Merge and transfer symbols”.",
        "The suggestions there go by number, name, look and the layer in the DWG file. What is already drawn can be skipped."
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
        "The keys are under the left hand: Q chooses ”Select”, W ”Draw”, A ”Add point” and S ”Remove point”.",
        "X chooses ”Cut apart”: click a line and it is cut in two there. Both parts become selected and the new ends get pink rings.",
        "V reverses the direction of the selected line, so that the tags of a cliff change side. D takes the symbol from the selected object.",
        "Shift gives the variant: Shift+E ”Circle”, Shift+A ”Make smooth” and Shift+S ”Simplify”. C changes symbol and R marks checked.",
        "New point: choose ”Add point” and click the segment. Remove: choose ”Remove point” and click the point.",
        "In ”Select”, Cmd-click or Ctrl-click does the same: on a point it is removed, on a segment there is a new one.",
        "Draw: click for corners, press and drag for a curve. Backspace removes the last point, Enter finishes and Esc cancels.",
        "The wheel: right-click the map, hold a finger on it or press space. The tools have fixed places: Select up, Draw up to the right, Rectangle to the right.",
        "Hold the right button and drag in a direction to choose the tool there at once. The latest symbols and actions are in the list beside the ring.",
        "The line below the map says what the pointer is on in the wheel, and otherwise which tool is chosen.",
        "Change keys with ”Keys” at the bottom of the tool column. The choice is saved in the browser.",
        "Z undoes and Shift+Z redoes. Cmd or Ctrl + Z also works.",
        "The digits 1–8 choose the latest symbols in the top row. Shift+space repeats the latest action.",
        "Hold Q to select for a moment: when you let go you are back in the tool you had."
      ],
      "Also read [How to think in the drawing mode](#ritlaget-sa-tanker-du)."
    ]
  },
  {
    id: "ritlaget-markera-flera",
    title: "Select, move and rotate several objects",
    views: ["MAP_EDITOR"],
    body: [
      "In ”Select” you can select several objects at once and change them together, as in a drawing program.",
      [
        "Drag a box on empty map. Everything the box touches is selected. An area that only surrounds the box is not included.",
        "Shift-click adds an object to the selection, or removes it from it.",
        "Move: drag inside the selection's box. All objects follow.",
        "Rotate: drag just outside a corner, where the cursor becomes a curved arrow. Everything turns around the centre of the box.",
        "Join: select and press G, or ”Join lines or areas”. Lines whose ends meet become one, overlapping areas become one area.",
        "Change symbol on several: select them, choose the symbol in the panel and press C. All with the same shape get the symbol.",
        "Delete removes everything selected. Undo takes back the whole move, rotation or removal in one step.",
        "Move the map: hold space and drag, or drag with two fingers on the trackpad. A short press on space opens the wheel.",
        "A click on a single object selects only that one. Then you change its points as usual."
      ],
      "Locked and hidden layers are not included in a box. Read [Turn off, fade and lock layers](#ritlaget-lager)."
    ]
  }
];
