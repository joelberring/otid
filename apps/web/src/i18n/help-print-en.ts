import type { HelpArticle } from "./help-sv";

/** Engelska del 32: hjälpen för fältläget, utskriften, papperet, färgerna, PDF:en och kartbytena (samma id som `help-print-sv.ts`). */
export const fieldPrintHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "faltlaget",
    title: "Field mode on the phone (hanging controls)",
    views: ["CS_FIELD", "CS_INSPECTIONS"],
    body: [
      "On a phone, course setting shows the map with a row at the bottom. On a computer ”My position” is above the map, and the field buttons appear when it is on.",
      [
        "”My position”: one tap shows the position, another follows it, a third turns it off. The map needs a georeference.",
        "”Move here”: measures for a few seconds and moves the selected control to where you stand. The accuracy is shown in the row.",
        "The arrows move the selected control 1 m at a time.",
        "”Details”: height (column F) and position (column G) for the selected control.",
        "”Checked” and ”Note here”: see the links below.",
        "”More” (⋯): ”Draw map error”, ”List” (the tab Checked) and ”Offline”."
      ],
      "The position is uncertain if it is worse than 15 m. Wait a while or go out into the open, and always compare with the map.",
      "More: [Checked](#kollat), [Notes and map errors](#notiser) and [Without network in the forest](#utan-nat)."
    ]
  },
  {
    id: "kollat",
    title: "Checked: controls verified on site",
    views: ["CS_INSPECTIONS", "CS_FIELD"],
    body: [
      "Standing at the control in the forest: select it and press ”Checked”. The check mark is saved with your name and the time.",
      "The tab ”Checked” shows ”Not checked” or ”All” and how many are checked. Tap a control to show it on the map.",
      "If the control is moved after the check, it says it has moved. Without network the check mark is saved on the phone and sent later."
    ]
  },
  {
    id: "utan-nat",
    title: "Without network in the forest (offline)",
    views: ["CS_FIELD", "CS_SETTINGS"],
    body: [
      "Save the map on the phone before you go out: ”Offline” in the phone's row (under ”More”) or ”Settings” → ”Without network”. Press Save the map for offline.",
      [
        "Changes, notes and check marks are always saved on the phone until the server has received them.",
        "The status at the top says there is no network and how many changes are waiting.",
        "When the network is back, everything is sent by itself. ”Send now” tries at once.",
        "”Save again” when the map file on the server is new. ”Remove from the phone” frees the space.",
        "If the phone says it cannot save: do not reload the page, connect to the network first."
      ],
      "If the sign-in has expired, the changes stay on the phone and are sent when you have signed in again."
    ]
  },
  {
    id: "utskrift",
    title: "Print and preview",
    views: ["CS_PRINT", "CS_PRINT_PAGE"],
    body: [
      "The scale belongs to the course: ”Scale for the course” under the tab ”Courses” in the course's properties. Choose it early; circle size and numbers follow it. The tab ”Print” shows it and has ”Change in the course's properties”.",
      "The tab ”Print” in course setting has ”Preview and print”, which opens the print page, and ”The paper in Layout”. The print page only has what is printed, how many, the colours and PDF or printer, from the top:",
      [
        "”Colours for print”: a row about the colours with ”Show”, and ”The map's own colours” or ”Printing at BL”. See [Colours for print](#bl-farger).",
        "”Print”: choose ”Courses”, ”One map per runner (in the same order as Maps for the start)”, ”Classes” or ”Proof sheets (one of each)”, and which courses.",
        "”Print on a printer”: a quick draft on your own printer; the colours are not print quality.",
        "”Create PDF for the printer”, beside it: the PDF with spot colours and overprint.",
        "Below them are the sheets as they are printed. They cannot be changed here."
      ],
      "The paper is edited in the tab ”Layout”, where a cell in ”Overview” opens the sheets for the course in that layout:",
      [
        "The overview: a card per sheet with scale, paper, template and warnings. Click a card to edit the sheet.",
        "Mark cards for ”Print marked” or to give them a ”Paper template”.",
        "The sheets first and the fields beside them, on a phone below the sheets.",
        "The fields: ”Paper and map frame”, ”Maps per sheet”, the paper's texts and images and ”Control description on the map”."
      ],
      "More:",
      [
        "Paper, orientation, margin and the map frame: [Paper and map frame](#arket).",
        "Several maps on a sheet or a strip for a rolled map: [Maps per sheet](#kartor-per-ark).",
        "For the printer: [PDF for print](#pdf-tryck).",
        "Text, logo, scale bar and north arrow: [The paper](#papperet).",
        "The description on the sheet: [The control description on the map](#beskrivning-pa-kartan)."
      ]
    ]
  },
  {
    id: "arket",
    title: "Paper and map frame",
    views: ["CS_PRINT_PAGE"],
    body: [
      "”Paper and map frame” in the tab ”Layout” applies to the open sheet (click a card in the overview). Everything is saved in the course's print area and written to .ppen as Purple Pen's print area.",
      [
        "”Paper” (A3, A4, A5), ”Orientation” and ”Margin (mm)”.",
        "”Print area”: ”Automatic (like Purple Pen)” puts the course in the middle of the paper. ”Fixed frame” locks the frame where it is.",
        "”Move the frame on the sheet”: drag inside the frame to move it over the map, and the bottom right handle to make it smaller. The frame stays centred.",
        "”Automatic again” removes the course's own print area. For a part of a course with a map exchange: ”As the course's again”.",
        "Map exchanges: each part has its own card. ”Show overlap” chooses how much of the previous part shows.",
        "A fixed frame can also be dragged on the map in course setting, with the tab ”Print” open."
      ],
      "In a layout other than the main layout it shows the layout's scale, with ”Change in the layout”.",
      "If the print uses ”Maps per sheet”, Maps per sheet decides the paper instead."
    ]
  },
  {
    id: "kartor-per-ark",
    title: "Maps per sheet",
    views: ["CS_PRINT_PAGE"],
    body: [
      "”Maps per sheet” puts several courses on the same sheet, or one map with a strip for a rolled map. The default is ”One course per sheet (the print area as in Purple Pen)”.",
      [
        "Choose a ready one, e.g. A4 with four maps or A4 with one map and a strip.",
        "”Copy to your own” and then ”Change the sheet (frames, texts, logo, strip)”: paper, rows and columns of frames, texts, logo and crop marks.",
        "The texts can have {tävling} {bana} {variant} {längd} {stigning} {skala} {datum} {klasser} {löpare} {klubb} {klass} {starttid} {startnummer}.",
        "”The courses in the frames”: fill the sheet in order, or the same course in all frames.",
        "The control description is set per course under ”Control description on the map”."
      ],
      "This is not the same as ”Paper template”, which carries a course's texts, images, cropping and paper. See [Paper template](#papperets-mallar)."
    ]
  },
  {
    id: "beskrivning-pa-kartan",
    title: "The control description on the map",
    views: ["CS_PRINT_PAGE", "CS_PRINT", "CS_DESCRIPTION"],
    body: [
      "The description belongs to the paper, not the map. It shows in the preview and the print, not in course setting.",
      [
        "It is on for every course and is put automatically in a corner where it does not cover the course.",
        "Drag the box on the sheet to move it. Drag the bottom right corner to change the size.",
        "Select the box and move it with the arrow keys, 1 mm per press.",
        "”Columns” and ”Box size” are under ”Control description on the map”. ”Automatic again” chooses a free corner.",
        "If it covers controls or legs, a warning is shown: drag it to a free place."
      ],
      "The place applies to the course in all prints. It is written to .ppen as Purple Pen's description, also when placed automatically, and comes back when the file is imported."
    ]
  },
  {
    id: "papperet",
    title: "The paper: texts, images, scale bar and north arrow",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "The paper is edited in the tab ”Layout”, with a click on a card in the overview. What is on the paper does not show in course setting.",
      [
        "”+ Text”, ”+ Image …”, ”+ Scale bar”, ”+ North arrow”, ”+ Frame” and ”+ Line” add elements.",
        "Double-click a text to type in it on the sheet. ”Insert variable” inserts e.g. {bana} or {datum}.",
        "Drag the element, drag the bottom right corner for the size. The arrows move 1 mm (Shift 5 mm), Delete removes.",
        "”Snap to edges and centre lines”: the elements snap to the frame, the margin and each other. Hold Alt to drag freely.",
        "Shift-click or a box on empty paper selects several. ”Align selected” lines them up.",
        "The layers: ”Up” and ”Down” change the order, ”Lock” and ”Hide” protect or hide an element.",
        "Images: PNG, JPG or SVG, at most 2 MB (SVG is converted to PNG).",
        "The variables {bana} {klass} {längd} {stigning} {tävling} {datum} {skala} {ekvidistans} {variant} are filled in per course.",
        "”Undo” and ”Redo”, or Ctrl+Z and Ctrl+Y.",
        "”Values for the texts” (collapsed): the date and contour interval to show in {datum} and {ekvidistans}."
      ],
      "”Cropping the map”, ”White on the print”, ”Values for the texts” and ”My library (all my events)” are collapsed: click the heading.",
      "In .ppen the texts become Purple Pen's text objects and the images image objects. Frames, lines, scale bar, north arrow and white areas stay in O-Tid. Templates: [Paper template and cropping the map](#papperets-mallar)."
    ]
  },
  {
    id: "papperets-mallar",
    title: "Paper template and cropping the map",
    views: ["CS_PRINT_PAGE"],
    body: [
      "A template is the paper, orientation and margin, the elements, the cropping, the white areas and the description's place under one name. The courses inherit the template.",
      [
        "”Save the course's paper as a template” and choose it under ”Paper template” on the other courses.",
        "The overview has the same ”Paper template”: mark the cards and use the template on them, or ”Use on all courses”.",
        "”Update the template with the course's paper” when you have changed the course the template is based on.",
        "If you change an element on a course, it only applies to that course (”Changed for the course”). ”As in the template again” undoes it.",
        "”Save the template in my library”: the template is then under ”My library (all my events)”. ”Fetch” brings it into another event."
      ],
      "”Cropping the map” limits how much of the map is printed, without changing the map. Choose ”Rectangle” or ”Polygon” and drag the corners on the sheet.",
      "”Outside” shows ”White” or ”Faded map” around the cropping. ”White on the print” makes your own areas white, e.g. what is to be cut away; drag the corners. The map file does not change.",
      [
        "The course is always whole, also outside the cropping: controls, start, finish, legs and numbers.",
        "Markings (out-of-bounds areas, boundaries, water and other small symbols) are only shown inside.",
        "An out-of-bounds area partly inside is drawn up to the edge.",
        "”Show markings outside the extent” shows all markings as usual."
      ]
    ]
  },
  {
    id: "bl-farger",
    title: "Colours for print",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "Under ”Colours for print” on the print page you decide how the map's and the course's colours are printed. The map file never changes.",
      "The row at the top says which colours apply. ”Show” shows the norm, the course's colour and which of the map's colours lie above and below the course.",
      [
        "”The map's own colours” is the default: the map file's colours in the norm's colour order. Nothing to set.",
        "”Printing at BL”: BL's colour table gives CMYK. Only the doubtful colours are shown.",
        "Doubtful: no certain row in the table, or uncertain whether the colour lies above or below the course.",
        "”Accept all certain” approves the rest at once.",
        "If the event has its own settings, the row says Own settings; they apply until you choose one of the modes."
      ],
      "Under ”Advanced” is everything else: ”Colour profile”, ”New profile” (your own copy) and:",
      [
        "”The course's colour”: CMYK, ”Spot colour” and ”Overprint”.",
        "”Put the course in the norm's colour order”: circles and lines below black and 100 % colours, above asphalt, building areas and screens.",
        "The norm only decides whether a map colour ends up above or below the course. On each side the colours keep the map file's order.",
        "So a white below a tree or below the railway's black lines stays below them.",
        "White lies above the course only if the map file draws it above all black, e.g. out-of-bounds white. Cultivated land's black lies below.",
        "”Norm”: forest (ISOM) or sprint (ISSprOM), by default from the map.",
        "In forest the numbers lie below contours, black and blue as in the norm, so they look slightly transparent.",
        "”Control numbers and texts on top” puts them above the map's colours. In sprint they are always on top.",
        "With BL forest or BL sprint, BL's full list is shown: each colour gets a card with ”Certain”, ”Confirm” or ”Ambiguous”.",
        "”Accept”, ”Keep the file's” or ”Choose BL row …”. ”Accept all certain” takes all certain ones at once.",
        "”Adjust colours by hand”: the same values per colour in a table. A change there shows on the card as ”Changed by hand”.",
        "”More”: download or import the profile as JSON and the table's source."
      ],
      "The choices are saved in the event's colour profile and apply to the print and the PDF."
    ]
  },
  {
    id: "pdf-tryck",
    title: "PDF for print and mirrored map",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "”Create PDF for the printer” under ”Print” on the print page creates the PDF on the server. It has the map as vectors and the course in its own spot colour with overprint.",
      [
        "”Create PDF for print”: for the printer. ”The map's colours in the PDF for print”: spot colours as in the map file or CMYK.",
        "”Create PDF for office printer”: CMYK without spot colours, with the same colour order as the print.",
        "In it the map's colours above the course are multiplied, so it looks like the print in all programs.",
        "The PDF for print has real overprint. It shows in Acrobat with Simulate overprint; Preview on Mac shows purple solid.",
        "”Preflight for the PDF” shows what stops it or should be checked. Read the warnings first.",
        "The job is put in a queue. The PDF is in the list when it is ready: ”Download”.",
        "Finished PDFs are kept a few days and are only visible to the event's administrators."
      ],
      "Always make a test print at the printer before the PDF is used for real.",
      "Mirrored map: the tab ”Training” → ”Mirror” → ”Mirror the map and the course in print”. The print and the PDF are flipped, but not the map in course setting."
    ]
  },
  {
    id: "lopar-kartor",
    title: "One map per runner: variables, back and check",
    views: ["CS_PRINT_PAGE"],
    body: [
      "”One map per runner (in the same order as Maps for the start)” under ”Print” gives a map for each runner, vacant time and spare.",
      [
        "Texts on the paper can have the runner's variables: {namn} {startnummer} {klubb} {klass} {starttid} {variant}, and for relay {lag} {lagnummer} {sträcka}.",
        "Example for the front: Team {lagnummer} · Leg {sträcka} · {variant}. In the course print the variables show as placeholders.",
        "”Back with the runner's details”: double-sided in the same PDF, or a separate run under Maps for the start → Backs.",
        "The back is edited in the tab ”Layout”: tick ”The back (per runner)” among the courses. The default is the same as Maps for the start's back.",
        "”Who is printed”: everyone, chosen classes, chosen runners (search by name or number) or chosen teams with all legs or one leg.",
        "”Check the matching” shows the PDF page, the runner, class, team, course, variant and start time. Click a row to see the sheet.",
        "The warnings: no variant, variant left out, the number does not match Maps for the start, the same bib twice. ”Save as CSV” saves the table."
      ],
      "The templates, ”My library (all my events)” and the club archive only save the variables, never the runners."
    ]
  },
  {
    id: "kartbyten",
    title: "Map exchanges: parts, double-sided and overlap",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "A course with a map exchange is split into parts as in Purple Pen. Part 2 starts at the map exchange, which is drawn as a start, and the numbers continue.",
      [
        "”Part” under ”Map exchanges” in the tab ”Print”: ”The whole course” or one of the parts (Part 1, Part 2 …). The map in course setting shows that part.",
        "Each part gets its own print area when you change its sheet under ”Paper and map frame” in the tab ”Layout”. ”As the course's again” removes it.",
        "”Show overlap” under ”Paper and map frame”: ”None”, ”The last leg” or ”The whole previous part”, faded and without numbers.",
        "In the preview each part is on its own sheet with the part's control description.",
        "”Double-sided: part 2 on the back of part 1 (map exchange)”: the order the printer needs, with an empty back for an odd number.",
        "On the paper, an element with ”All pages” is on every part. Otherwise it is only on part 1."
      ],
      "If the map is flipped at the map exchange (map flip in Purple Pen), double-sided is the default. The parts' print areas are written to .ppen as in Purple Pen."
    ]
  }
];
