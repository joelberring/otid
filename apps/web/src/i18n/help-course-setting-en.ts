import type { HelpArticle } from "./help-sv";

/**
 * Engelska del 32: hjälpen för banläggningen (Kom igång, editorn, kontroller och banor, beskrivningar, varningar, notiser,
 * samarbetet och nivåstödet). Samma id, vyer och form som `help-course-setting-sv.ts`.
 */
export const gettingStartedHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "kom-igang-traning",
    title: "Get started: set a training in 10 minutes",
    views: ["CS_START", "EVENTS", "COURSE_SETTING", "COURSES"],
    body: [
      "From an empty event to printed maps and readout. The club spaces and training groups are at the top of ”My events” (”My clubs”, ”My groups”) and in the menu with your name.",
      { steps: [
        "Write the name and date on ”My events”, choose ”Training” and press ”Create event”. See [Create an event](#skapa-tavling).",
        "Open ”Course setting” and upload the map file, or take it with ”Choose map from the club archive”. See [Course setting and the map file](#banlaggning-start).",
        "Press ”Start with an empty course setting” (or ”Import .ppen” if the course is in Purple Pen).",
        "Press ”New course” and choose ”Scale for the course” in the course's properties. Click out the controls, start and finish. See [Controls and courses](#kontroller-banor).",
        "Corridor, contours or another form: the tab ”Training”. See [Training forms](#traning).",
        "”File” → ”Print courses …” → ”Print on a printer”. See [Print and preview](#utskrift).",
        "Write the class in the course's field ”Classes (as in Purple Pen, e.g. M21, W21)”.",
        "”File” → ”Transfer to the event …”. Then you can read out. See [Transfer the courses](#overfor) and [Readout](#avlasning)."
      ] }
    ]
  },
  {
    id: "kom-igang-purple-pen",
    title: "Get started: from Purple Pen to an event",
    views: ["CS_START", "EVENTS", "COURSE_SETTING"],
    body: [
      "The courses are set in Purple Pen and are to become an event with maps from the printer:",
      { steps: [
        "Create an event of the type ”Event” on ”My events”.",
        "Open ”Course setting” and upload the same map file as in Purple Pen. See [Course setting and the map file](#banlaggning-start).",
        "Press ”Import .ppen”. Only IOF XML: ”Courses” → ”Import course file”. See [Purple Pen, OCAD and IOF XML](#purple-pen).",
        "Go through the tab ”Warnings” and the tab ”Description”. See [Warnings](#varningar).",
        "”File” → ”Print courses …”: ”Colours for print”, a template for all courses and ”Create PDF for the printer”. See [PDF for print](#pdf-tryck).",
        "”File” → ”Transfer to the event …”: the courses and variants become the event's. See [Transfer the courses](#overfor).",
        "Continue with classes, entries and the draw in the workspace. See [Start and draw](#start).",
        "If the courses are to go back to Purple Pen: ”File and versions …” → ”Download .ppen”."
      ] }
    ]
  }
];

export const courseSettingHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "banlaggning-start",
    title: "Course setting: open it and load the map",
    views: ["CS_START", "COURSE_SETTING", "COURSES"],
    body: [
      "Course setting opens with ”Course setting” in the workspace's side panel, under ”Menu” on a phone or with the button ”Course setting” on ”My events”.",
      "Someone who only sets courses is added under ”Settings” → ”People with access” with one of the roles:",
      [
        "”Course setting: edit”: changes the courses directly.",
        "”Course setting: suggest”: the changes become a suggestion that someone approves.",
        "”Course setting: read and comment”: sees the courses and writes notes."
      ],
      "The courses are drawn on the map file. Upload it with ”Upload map file (OCAD or Mapper)”:",
      [
        "OCAD 8 to OCAD 2018 (.ocd) and Mapper (.omap, .xmap), at most 75 MB.",
        "OCAD 7 and older do not work: open the map and save it in a newer OCAD or in Mapper.",
        "The map file is the same as under ”Map and route choice” in the workspace.",
        "If the map has no georeference, set three points under ”Map and route choice”. The position in field mode needs it.",
        "If the map is in the club's archive: ”Choose map from the club archive” → ”Use the map”. See [Duplicates and versions of maps](#arkiv-dubbletter)."
      ],
      "Then: ”Import .ppen” from Purple Pen or ”Start with an empty course setting”."
    ]
  },
  {
    id: "purple-pen",
    title: "Purple Pen, OCAD and IOF XML",
    views: ["CS_START", "COURSE_SETTING"],
    body: [
      "O-Tid reads and writes Purple Pen's file (.ppen). Everything is under ”File” → ”File and versions …”:",
      [
        "”Import .ppen”: replaces the course setting. The current one is saved as an earlier version.",
        "What O-Tid does not interpret is kept untouched and written back, so the file can go back and forth.",
        "”Download .ppen”: courses, controls, descriptions, special objects and print area, to open in Purple Pen.",
        "The imported file is kept untouched and can be downloaded again.",
        "”Download IOF XML (courses)”: the course file for MeOS, OLA and OCAD. A forked course becomes one course per variant."
      ],
      "Good to know about back and forth:",
      [
        "When a new file is imported, the event's print profiles, layout templates, circle cut-outs and paper are kept, and the training if the file has none.",
        "The paper's texts and images become Purple Pen's text and image objects, and the description's place follows along. See [The paper](#papperet).",
        "The training forms follow along in .ppen but disappear if the file is saved in Purple Pen."
      ],
      "OCAD: O-Tid writes no OCAD format. Import the courses in OCAD from IOF XML; the controls end up right, but descriptions and special objects do not come along.",
      "A course file in IOF XML (3.0 or older 2.0.3 from OCAD and Condes) without .ppen can also become a course setting:",
      [
        "”Courses” → ”Import course file”: if the event has a map file, ”Put the courses in course setting” is offered.",
        "If there are courses already: ”Replace the course setting's courses …” and ”Yes, replace”. The old one is saved as an earlier version.",
        "”Use again” in the club archive on a training with only a course file opens course setting with the courses directly.",
        "The controls end up in the same place on the map file as in the program that wrote the file. Start, finish, crossings, score courses and classes come along.",
        "Variants become forks or loops when it fits exactly; otherwise each variant becomes its own course and the message says so.",
        "The course file has no control descriptions. Fill them in under the tab ”Description”."
      ]
    ]
  },
  {
    id: "kontroller-banor",
    title: "Controls and courses: the tools",
    views: ["CS_COURSES", "CS_SELECTED", "COURSE_SETTING"],
    body: [
      "The tools are above the map. Each tool has a key:",
      [
        "”Select” (V): click to select; drag a control, a number or a bend point to move it. On a phone: tap first, then drag.",
        "”Control” (K), ”Start” (S) and ”Finish” (M): click on the map. In a course the control is inserted after the selected control.",
        "”Insert” (L): click an existing control to add it to the course. A click in a faint circle does the same.",
        "”Bend” (B): select a leg and click where the line should bend. ”Straight leg” removes the bend points.",
        "Delete removes, Escape cancels, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. The arrows move the map."
      ],
      "The courses and the controls:",
      [
        "The tab ”Courses”: ”New course”, ”Rename”, ”Duplicate” and ”Remove the course”. Drag the courses to change the order.",
        "The tab ”Selected”: the selected control with ”Code”, ”Remove from the course” and ”Delete the control”.",
        "A control that is moved is moved in all courses that have it.",
        "If you drag such a control more than 50 m in a course, O-Tid asks: ”Move in all courses”, ”New control only in” the course or ”Cancel”.",
        "A new control gets the next free code; the other courses keep the old one. ”Move here” in field mode asks the same way.",
        "”Remember for this session” skips the question. The limit and ”Ask again” are under ”Move shared controls” in ”Settings”."
      ],
      "More: [Fork and loop](#gaffling), [Crossing points and special objects](#objekt), [Notes](#notiser) and [All controls](#alla-kontroller)."
    ]
  },
  {
    id: "alla-kontroller",
    title: "All controls and unused controls",
    views: ["CS_COURSES"],
    body: [
      "Choose ”All controls” at the top to see every control with its code, whatever the course.",
      "In a course, controls that are not part of it show faintly. Click in the circle with ”Control” or ”Insert” to add it.",
      [
        "”Show” on the map: ”Show other courses faintly” and mark unused controls.",
        "Under ”Show” you can also turn off ”Checked controls” (the green box), ”Notes” and ”Mark warnings”, per browser.",
        "”Only unused” in the list shows controls that are on no course.",
        "”Remove all unused” clears them away after a question."
      ]
    ]
  },
  {
    id: "gaffling",
    title: "Fork and loop",
    views: ["CS_COURSES", "CS_SELECTED"],
    body: [
      "A fork splits the course into branches that join again. A loop goes out and back to the same control. Each runner gets a variant.",
      [
        "Select the control where the course splits and press ”Fork” (G). Choose the number of branches or ”Loop”.",
        "New controls are put in the selected branch. ”Next branch” changes branch and ”Done” finishes.",
        "The tab ”Selected” also has ”Number of branches”, ”Fork”, ”Loop” and ”Remove the fork”.",
        "The list in the tab ”Courses” shows the branches. Press a branch's letter to work in it.",
        "”Variants” in the list and the chooser at the top show each variant with the number of controls and the length."
      ],
      "The variants follow along when the courses are transferred to the event. A score course cannot be forked.",
      "Too many variants, or some too long? See [Fewer variants](#varianter)."
    ]
  },
  {
    id: "varianter",
    title: "Fewer variants",
    views: ["CS_COURSES"],
    body: [
      "Many forks in a row give many variants, and some get longer. The panel ”Variants” in the tab ”Courses” shows the variants of a forked course.",
      [
        "The table has the straight line, the length along route choices, the number of controls and the difference from the shortest in metres and percent.",
        "”Calculate along route choices” calculates all variants' legs on the map. Then the length along route choices is compared too.",
        "Untick ”Used” to leave out a variant by hand. The row at the top says how many are used."
      ],
      "”Limit variants” suggests which to remove. Choose a method:",
      [
        "”Remove the longest” (default): the 3 longest of those in use are removed. Variants already left out stay left out.",
        "Only variants that are longer in every respect than one that remains can be removed. The order is along route choices once calculated.",
        "”Longest in every respect (all)” removes all such; with only the straight line, few remain.",
        "”Cap: percent or number” with ”At most % longer than the shortest” and ”At most number of variants” keeps the shortest.",
        "”Preview” shows what is removed and why. ”Cancel” leaves everything as it is.",
        "The only variant with a particular control or leg remains. ”Use all variants” brings them all back."
      ],
      "Variants left out are not transferred to the event, not allocated in the draw, not written to IOF XML and not printed, not even as spares. " +
        "If the course is changed in the event's course editor they do not come back, and a choice that no longer fits is pointed out there. " +
        "The readout warns if a runner still ran a variant that was left out. Use it for unequal forking; a balanced fork or relay needs all variants."
    ]
  },
  {
    id: "objekt",
    title: "Mandatory crossing point and special objects",
    views: ["CS_OBJECTS", "CS_SELECTED"],
    body: [
      "”Mand. crossing” (P) places a mandatory crossing point. It is part of the course, is not numbered and turns along the leg.",
      "”Objects” (O) opens the palette with everything else:",
      [
        "Crossing points: ”Optional crossing point” (e.g. a gate) and ”Map exchange”.",
        "Barriers: ”Out-of-bounds area”, ”Forbidden route”, ”Boundary”, ”Dangerous area” and ”Temporary construction”.",
        "Services: ”Water” and ”First aid”.",
        "Text and graphics: ”Text”, ”Image”, ”Line”, ”Rectangle”, ”Ellipse”, ”White background” and ”Registration mark”."
      ],
      "Good to know:",
      [
        "An area or line: click the corners and finish with Enter, ”Done” or a click on the first point.",
        "The tab ”Objects” lists the objects. Under ”Shown on” you choose all courses or only some.",
        "The barriers count in the route choices and the warnings: a control that can be reached around a forbidden area gets no warning; see [Warnings](#varningar)."
      ]
    ]
  },
  {
    id: "banans-egenskaper",
    title: "The course's properties: climb, length and score course",
    views: ["CS_COURSES"],
    body: [
      "Select a course. Its properties are below the list in the tab ”Courses”:",
      [
        "”Climb (m)”: shown in the description and on the map. Empty = no climb.",
        "”Fixed length (m)”: replaces the calculated length in the description, on the map and in the event.",
        "”Kind of course”: ”Normal course” or ”Score course”. A score course is taken in any order and cannot be forked.",
        "”Points” per control on a score course. A score course has no calculated length.",
        "Press ”Save the properties”."
      ],
      "”At the control” chooses what is shown by the circle: number, code or points.",
      "The course's length is the straight line. ”Calculate along route choices” also gives the length along the best route choices; see [Route choice in course setting](#vagval-strackan)."
    ]
  },
  {
    id: "kontrollbeskrivning",
    title: "Control description (clue sheet)",
    views: ["CS_DESCRIPTION", "CS_SELECTED", "CS_DESCRIPTIONS_PAGE"],
    body: [
      "The tab ”Description” shows the selected course's control description. Click a box (C–H) to choose a symbol, or a row to select the control.",
      [
        "Search the symbol by name, or write a dimension directly, e.g. 2m or 4x4. The arrows and Enter choose.",
        "”Recently used” is at the top. ”None (clear the box)” clears the box.",
        "”Text lines”: ”Text before the control” and ”Text after the control”, e.g. follow the streamers.",
        "”Settings for the description”: ”Standard” (IOF 2004 or 2018), ”Language” and ”Show”: symbols, text or both.",
        "The symbols belong to the control and show in all courses that have it."
      ],
      "Printing and more:",
      [
        "”Print descriptions”, or ”File” → ”Control descriptions …”: the descriptions packed on A4 to cut out. Print at 100 % scale.",
        "The description on the map is placed in the preview: [The control description on the map](#beskrivning-pa-kartan).",
        "Suggestions from the map file: [Control description suggestions](#beskrivningsforslag)."
      ]
    ]
  },
  {
    id: "beskrivningsforslag",
    title: "Control description suggestions from the map",
    views: ["CS_DESCRIPTION", "CS_FIELD"],
    body: [
      "O-Tid reads the map file in the circle and suggests the feature (column D) and more. The suggestion is below the description when a control is selected.",
      [
        "The certainty is shown as certain, likely or uncertain with a percentage.",
        "”Accept” writes in the suggestion. ”Other interpretations” shows more suggestions.",
        "Accept all empty takes the best suggestion for each control in the view that has no feature.",
        "Point at a suggestion and the feature is marked on the map.",
        "Controls with suggestions not yet accepted are drawn lighter in the description."
      ],
      "The suggestions need the map file. If no clear feature is in the circle: choose the symbols yourself. In field mode the suggestion is in the row at the bottom."
    ]
  },
  {
    id: "varningar",
    title: "Warnings",
    views: ["CS_CHECKS"],
    body: [
      "The tab ”Warnings” is recalculated after every change. This is checked:",
      [
        "Controls too close to each other. If the feature (column D) is filled in, it decides whether the features are alike or different.",
        "The same code on several controls, and codes that can be read upside down.",
        "The same control twice in a row, and a leg through another control's circle.",
        "A control in an out-of-bounds or dangerous area or a temporary construction is an error.",
        "If the straight line crosses a barrier, the route around is calculated. A way around gives no warning; ”Selected” shows the detour.",
        "If there is no legal way around the barrier, it is an error.",
        "A course without start or finish, a control without a code and controls not used on any course."
      ],
      "How to read the list:",
      [
        "Errors first, then warnings and notes, in groups per kind with a count.",
        "The number on the tab counts errors and warnings that are not accepted.",
        "The same leg on several courses or variants is on one row with the courses' names first.",
        "A click on a row shows it on the map; a leg is selected on the course."
      ],
      "Is it intended? Press ”Accept”.",
      [
        "The row moves to the accepted ones at the bottom. ”Undo” brings it back.",
        "The group's button accepts all of the same kind.",
        "It is saved in the course setting with undo and versions, and follows along when a new .ppen is imported.",
        "It applies until the control or the area is replaced or moved more than 25 m.",
        "The same code, a missing code and a course without start or finish cannot be accepted."
      ],
      "The warnings stop nothing.",
      "The circles' and lines' dimensions against the standard are under ”Settings” → ”Appearance”; see [The course's appearance](#utseende)."
    ]
  },
  {
    id: "notiser",
    title: "Notes and map errors",
    views: ["CS_NOTES", "CS_FIELD"],
    body: [
      "A note is a comment on the map, a control, a leg or a course. Choose the tool ”Note” (N) and click where it should go.",
      [
        "Write text and add a photo if you like. Press ”Save the note”.",
        "In the tab ”Notes”: ”Reply”, ”Done” and ”Reopen”. The filter shows ”Open”, ”Done” or ”All”.",
        "”Draw in a note”: draw lines or areas on the map, e.g. where the streamers should go.",
        "”Draw map error”: a map error sits on a point or a drawing, never on a control, so that it can be given to the mapper.",
        "”Map errors to the mapper …”: the map errors without courses and controls, to print or download as GeoJSON.",
        "There is also ”Share with the mapper”: a link that opens without an account. See [Share the map errors with the mapper](#kartritarens-lank).",
        "”Edit” on your own note or reply changes the text. It is then shown as edited, with the time.",
        "”Delete” removes the note with replies and photo. This cannot be undone."
      ],
      "On a phone, ”Note here” puts the note on the selected control or where you stand. See [Field mode on the phone](#faltlaget)."
    ]
  },
  {
    id: "kartritarens-lank",
    title: "Share the map errors with the mapper",
    views: ["CS_NOTES", "CS_FIELD"],
    body: [
      "The mapper can see the map errors with a link, without an account and without access to the event. Someone allowed to edit the course setting creates the link.",
      { steps: [
        "Open ”Map errors to the mapper …” in the tab ”Notes”.",
        "Press ”Share with the mapper”. Choose ”Limit the time” if the link should stop working on a certain date.",
        "Choose ”Show the event's name” if the mapper should see it. Otherwise the page only says ”Map errors”.",
        "Press ”Create the link” and then ”Copy the link”. The link is only shown that once."
      ] },
      "The mapper sees the map, the map errors and the threads, but no courses, controls, photos or participants.",
      "The mapper can reply and press ”Fixed in the map” or ”Not fixed”. The replies show at once in Map errors and in course setting.",
      [
        "”Last opened” shows when the link was last used.",
        "”Turn off the link” applies at once. ”Create new link” gives a new link and turns off the old one.",
        "A map error close to a control can reveal the control. Write the text so that it does not."
      ]
    ]
  },
  {
    id: "samarbete",
    title: "Several course setters at once",
    views: ["CS_SETTINGS", "CS_SUGGESTIONS", "COURSE_SETTING"],
    body: [
      "Several people can have the course setting open at once. The top shows who is here now, and other people's changes show at once.",
      "”Settings” → ”Way of working” → ”How you work” (only administrators change it):",
      [
        "”Lead course setter”: those with ”Course setting: edit” change directly; those with ”Course setting: suggest” send suggestions.",
        "”Shared”: everyone allowed to edit does so directly, and the notes are used for discussion."
      ],
      "If two people change the same thing, the one who saved first wins. What could not be saved is listed in a message over the map.",
      "See also [Suggestions from other course setters](#forslag) and [Saving, versions and undo](#sparande)."
    ]
  },
  {
    id: "sparande",
    title: "Saving, versions and undo",
    views: ["COURSE_SETTING", "CS_SETTINGS"],
    body: [
      "Everything is saved by itself. The status at the top shows ”Saved”, ”Changed – saving shortly” or ”Not saved – trying again”.",
      [
        "”Undo” and ”Redo” apply to your own changes, also after the page is reloaded if nobody else changed the same thing.",
        "”File” → ”File and versions …” → ”Show earlier versions”: each saved version with time, name and number of courses.",
        "”Restore” brings back a version. The current one is first saved as an earlier version, so nothing is lost.",
        "The version before importing a .ppen is always saved.",
        "”Not saving – sign in again”: sign in in a new tab. The changes wait meanwhile."
      ],
      "Saving outside the map, for example when the course file's courses are put in course setting:",
      [
        "If someone else saved first, O-Tid tries once more on the new version, without a message.",
        "If it still fails, ”The change was not saved – try again.” is shown by what was not saved, with ”Try again”."
      ],
      "Party and rogaining also have ”Course setting”:",
      [
        "Rogaining: new courses become score courses. An empty points field = the control code's first digit, and the points go to the event. See [Rogaining](#rogaining).",
        "Party: the course setting gives maps to print. ”Transfer to the event …” is not available, the party has no courses."
      ],
      "See also [Several course setters at once](#samarbete)."
    ]
  },
  {
    id: "forslag",
    title: "Suggestions from other course setters",
    views: ["CS_SUGGESTIONS"],
    body: [
      "With the role ”Course setting: suggest”, your changes become a suggestion. Only you see them until you send the suggestion.",
      [
        "Send: the tab ”Suggestions”, write a comment and press ”Send the suggestion”. ”Discard the suggestion” removes it.",
        "Review: press ”Review”. The suggestion is drawn dashed on top of the course, with arrows for moved controls.",
        "Approve: ”Approve all”, or untick changes and approve only the chosen ones. ”Decline” can be commented.",
        "Changes that no longer work, because someone else changed the same thing, are listed under ”No longer possible:”."
      ],
      "Someone allowed to edit the courses approves. ”Earlier suggestions” shows the decisions."
    ]
  },
  {
    id: "utseende",
    title: "The course's appearance and circle cut-outs",
    views: ["CS_SETTINGS"],
    body: [
      "”Settings” → ”Appearance” applies to all courses, on the map and in print. The dimensions follow along to Purple Pen.",
      [
        "”Quick choices”: standard dimensions, enlarged at 1:10 000 (youth and veterans), larger circles or smaller numbers.",
        "”Circle size”, ”Line width” and ”Number size” as a ratio to the standard. ”Scaling” decides whether they follow the scale.",
        "”Outside the standard” warns when a dimension differs from ISOM or ISSprOM.",
        "”Circle cut-outs”: cut circles where they overlap and over important details such as paths and cliffs.",
        "”Make the cut-outs fixed (for Purple Pen)” saves the cut-outs over details in the controls, so that they come along in .ppen."
      ]
    ]
  },
  {
    id: "overfor",
    title: "Transfer the courses to the event",
    views: ["COURSE_SETTING", "COURSES"],
    body: [
      "The course setting and the event's courses are two things. The readout and the results use the event's courses.",
      "”File” → ”Transfer to the event …” → ”Transfer to the event”: the courses, controls and variants become the event's. You see the differences first.",
      [
        "Each course needs a start and a finish, and the controls codes 1–999 999.",
        "The classes in the course's field ”Classes (as in Purple Pen, e.g. M21, W21)” are created with free start if they do not exist.",
        "If you change the courses afterwards: transfer again and look at the differences.",
        "Only administrators transfer."
      ]
    ]
  }
];

const SOURCE = "Source: Swedish Orienteering (SOFT): classes, levels, winning times and course lengths (2022), and SOFT's course setters' meeting 2025.";
const SEE = "See [Level support – green, white, yellow …](#nivastod). Source: SOFT 2022 and SOFT's course setters' meeting 2025.";

export const levelHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "nivastod",
    title: "Level support – green, white, yellow …",
    views: ["CS_COURSES", "COURSE_SETTING"],
    body: [
      "The Swedish Orienteering Federation divides courses into seven colour levels, from easiest to hardest: Green, White, Yellow, Orange, Violet, Blue and Black.",
      [
        "Green and White follow paths and other clear handrails. Yellow may cut across and the control is a bit away from the path.",
        "Orange and Violet need more map reading, but there should be something clear to relocate on.",
        "Blue and Black are for the most skilled. Contours and details decide; Black may be physically harder.",
        "The classes: M/W10 White, 12 Yellow, 14 Orange, 16 Violet, 18–65 Black, 70 and older Blue. Beginner Green, Very easy White, Easy Yellow, Medium Orange."
      ],
      "How to use the level support:",
      [
        "Choose the course's level in the field ”Level” in the course's properties. If the course has classes, the level is suggested from them.",
        "Press ”Assess the level” (or ”Assess all courses”). Nothing is calculated until you ask.",
        "Each control and leg gets a level with a reason and a tip. ”Show on the map” selects it; ”Show suggestion on the map” shows e.g. the nearest junction.",
        "If you change the course it says ”Out of date – assess again”.",
        "With ”Show deviations from the level in Warnings” the deviations come as notes that can be accepted. ”Level marks” under ”Show” hides the marks."
      ],
      "How the tool measures, only from the map's symbols and the route choices:",
      [
        "The control: how far it is to the nearest path or handrail, how large the feature is and whether there is an attack point close by.",
        "The leg: how much of the route follows handrails, how far it goes without, whether cutting across pays and whether contour reading is needed."
      ],
      "It is a support, not a verdict: you as course setter decide.",
      [
        "The tool does not see visibility, runnability or how clear a detail is in reality.",
        "The limits are tuned against real courses with known levels. In forest with many paths and ditches, hard courses are often rated a little lower.",
        "Sprint has no colour scale, so the level support does not apply to sprint maps.",
        SOURCE
      ],
      "Guides per level: [green](#niva-gron), [white](#niva-vit), [yellow](#niva-gul), [orange](#niva-orange), [violet](#niva-violett) and [blue or black](#niva-bla-svart)."
    ]
  },
  {
    id: "niva-gron",
    title: "How to set a green course",
    views: ["CS_COURSES"],
    body: [
      "Green is for the very youngest and beginners (about 2 km). The runner should be able to follow the path all the way.",
      [
        "The controls are on or right next to the path, the road, the fence or the open land, clearly visible.",
        "The leg follows a clear handrail all the way. A change at the control is fine; not too many changes out on the leg.",
        "No route choices: cutting through the forest should not pay.",
        "Put a control at path junctions where it is otherwise easy to go wrong.",
        "Common pitfall: a control only 30 m into the forest. That is White or harder."
      ],
      SEE
    ]
  },
  {
    id: "niva-vit",
    title: "How to set a white course",
    views: ["CS_COURSES"],
    body: [
      "White is for M/W10 and Very easy (about 2 km for M/W10 at middle distance, 2.5 km at long; Very easy 2 or 4 km).",
      [
        "The control may be beside the path, at most about 50 m, at an easy and clear feature: a boulder or a clear hill.",
        "There should be a clear stop on the path just before the control, and the flag should be visible from there.",
        "The legs follow handrails; they may be less clear than on Green, e.g. ditches, streams, stone walls and vegetation boundaries.",
        "Cutting across open land towards a safe catching feature is fine, at most about 200 m.",
        "Common pitfall: a small pit or a small knoll as the feature. Choose something larger."
      ],
      SEE
    ]
  },
  {
    id: "niva-gul",
    title: "How to set a yellow course",
    views: ["CS_COURSES"],
    body: [
      "Yellow is for M/W12 and Easy (about 2.5 km for M/W12 at middle distance, 3 km at long; Easy 2.5 or 5 km).",
      [
        "The control can be a bit from the path. The features may be larger depressions, clear spurs, hills and cliffs.",
        "Cutting between two paths should pay, at most about 150 m through the forest, towards a safe catching feature. The way round by path should exist too.",
        "A safe relocation point at most about 200 m before the control, and a clear catching feature behind.",
        "Easily runnable terrain: avoid dense forest, steep and stony ground and hard-to-run clear-cuts.",
        "Common pitfall: legs where the path goes straight to the control, so cutting across never pays. Then it is a white course."
      ],
      SEE
    ]
  },
  {
    id: "niva-orange",
    title: "How to set an orange course",
    views: ["CS_COURSES"],
    body: [
      "Orange is for M/W14 and Medium (about 3 km for M/W14 at middle distance, 4 km at long; Medium 3 or 5 km).",
      [
        "The terrain should still be easily runnable. Marshes, hill edges, spurs and depressions should be possible to follow.",
        "The control is harder than on Yellow, but there should always be clear features nearby to relocate on.",
        "The legs may go where handrails are not enough: rough orienteering over clear points and in simple contours.",
        "No catching feature is needed behind the control, but the runner should be able to relocate at a reasonable distance.",
        "Common pitfall: a small detail far from everything else. Put it near something clear."
      ],
      SEE
    ]
  },
  {
    id: "niva-violett",
    title: "How to set a violet course",
    views: ["CS_COURSES"],
    body: [
      "Violet is for M/W16 (about 3.5 km at middle distance, 5–5.5 km at long).",
      [
        "Any kind of terrain is fine, but avoid very physically demanding terrain and hard-to-read map areas.",
        "The legs are as hard as on Orange; it is the controls that may be harder.",
        "It should be possible to simplify: take the control from a side with something large and clear (an attack point).",
        "Controls without a clear catching feature and in terrain with few details belong here.",
        "Common pitfall: long legs with contour reading in detailed terrain. That is Blue or Black."
      ],
      SEE
    ]
  },
  {
    id: "niva-bla-svart",
    title: "How to set a blue or black course",
    views: ["CS_COURSES"],
    body: [
      "Blue and Black are for the most skilled: Blue for 70 and older and Hard 3 km, Black for 18–65 and Hard 5 or 7 km.",
      [
        "Reading contours and details is a big advantage: rough orienteering in hard contours and fine orienteering in detailed terrain.",
        "The route choices may be hard to assess, with several decisions per route choice and varying runnability.",
        "Black may go in any kind of terrain; on Blue the most physically demanding is avoided.",
        "Vary: mix long route choice legs with short legs of fine orienteering.",
        "Common pitfall: all controls at large features near paths. Then the course is too easy."
      ],
      SEE
    ]
  }
];
