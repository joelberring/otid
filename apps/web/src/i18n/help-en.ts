import type { Texts } from "../lib/language";
import type { HelpArticle, helpSv } from "./help-sv";
import { accountHelpArticlesEn, routeChoiceHelpArticlesEn } from "./help-more-en";

/**
 * Engelska del 27: hjälpen (panelen och artiklarna för arbetsytan, avläsningen, kontot, kontrollkartan och vägvalen). Samma
 * id och regler som `help-sv.ts`; `help-en.test.ts` slår upp varje ”…” i de engelska UI-texterna. Artiklarna om
 * banläggningen, utskriften, klubbarkivet och klubbytan är kvar på svenska tills de delarna är översatta.
 */
export const helpEn: Texts<typeof helpSv> = {
  button: "Help",
  title: "Help",
  close: "Close",
  search: "Search the help",
  searchPlaceholder: "For example draw, readout or print",
  here: "Help for this page",
  all: "All help articles",
  more: "More help articles",
  hits: (count: number) => count === 0 ? "No matches." : `${count} ${count === 1 ? "match" : "matches"}`,
  noHits: "Try another word. If you cannot find the answer: send an email.",
  about: "About O-Tid",
  film: "Watch the film (1 min)",
  contact: "Questions about O-Tid:",
  newTab: "opens in a new tab",
  link: (title: string) => `Help: ${title}`
};

export const helpSynonymsEn: readonly (readonly string[])[] = [
  ["control description", "description sheet", "clue sheet"],
  ["ppen", "purple pen", "purplepen"],
  ["fork", "variant", "branch", "loop", "butterfl"],
  ["print", "pdf"],
  ["offline", "without network", "no network"],
  ["route", "route choice", "calibrat"],
  ["sign in", "log in", "login"],
  ["sign out", "log out", "logout"],
  ["card", "si card", "sportident"]
];

const raceDayHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "skapa-tavling",
    title: "Create an event and choose its type",
    views: ["EVENTS", "SETTINGS"],
    body: [
      "Go to ”My events”. Write ”Event name” and ”Date” under ”Create event”. ”Stage/race (optional)” can be left empty.",
      "Choose ”Type of event”. The type decides which steps are shown in the workspace:",
      [
        "”Training”: free start, courses and classes in the same place.",
        "”Small event”: classes, entries and start times without a draw.",
        "”Event”: draw, import, speaker and official results. Forked courses give course variants.",
        "”Relay”: teams and legs.",
        "”Rogaining”: controls with points and a time limit."
      ],
      "Press ”Create event” and the workspace opens. The type can be changed under ”Settings” without anything being removed.",
      "If the club has a club archive you can take the map with ”Välj karta från klubbarkivet” before pressing ”Create event”; course setting then opens with the map."
    ]
  },
  {
    id: "publicera",
    title: "Publish the event",
    views: ["PUBLISH", "SETTINGS"],
    body: [
      "A new event is only visible to you and others with access. Go to the step ”Publish” and press ”Publish the event”.",
      "Then the event page is visible to everyone, and the event is listed on the home page. Results appear as runners read out.",
      "With ”Preview the event page” you see the page before it is published. ”Print QR code” gives a sign to put up at the start and finish.",
      "The start list is published separately under ”Start”. ”Stop publishing” hides the event again."
    ]
  },
  {
    id: "banor",
    title: "Courses",
    views: ["COURSES"],
    body: [
      "Add a course with ”New course”. Write ”Course name” and the controls in order and press ”Save course”. Fill in ”Class name (optional)” if a class should run the course straight away; the button is then called ”Save course and class”. Otherwise add the class under Classes.",
      [
        "Course file from Purple Pen, OCAD or Condes: export the courses as IOF XML 3.0 and choose ”Import course file”. You see the differences first.",
        "”Edit”: correct a course, even after runners have read out. Press ”Show what happens” and ”Save the change”. Results are recalculated.",
        "”Remove course”: possible when no class runs the course and there are no results.",
        "Course setting, File: ”Download IOF XML (courses)” gives a course file like the one from Purple Pen. MeOS and OLA read it.",
        "OCAD: O-Tid has no format of its own for it. OCAD's course setting can read the same IOF XML file. For Purple Pen: ”Download .ppen”."
      ],
      "To put the courses on the map in O-Tid: see [Course setting: open it and load the map](#banlaggning-start)."
    ]
  },
  {
    id: "klasser",
    title: "Classes",
    views: ["CLASSES", "COURSES"],
    body: [
      "A class runs a course. Create a class with ”New class”, choose ”Course” and ”Start type” and press ”Save class”.",
      "”Free start” means the runner punches start. ”Interval start” means a fixed start time, drawn or set by hand.",
      "Change the name, course, start type or maximum time with ”Edit” in the row. Results are recalculated when you save.",
      "A class can only be removed when it is empty."
    ]
  },
  {
    id: "anmalda",
    title: "Entries",
    views: ["ENTRIES", "SETTINGS"],
    body: [
      "Add one runner at a time with ”New participant”. Choose a class, write the name and preferably the card, and press ”Add”. The form stays open for the next one.",
      "Eventor is available for Event and Relay, under ”Settings” → ”Eventor”:",
      [
        "Save the club's API key and choose the event with ”Show the club's events”.",
        "”Fetch from Eventor” fetches classes and entries. You see the differences before anything is saved.",
        "”Change event” if it was the wrong event. ”Update from Eventor” when the entries change.",
        "”Update the runner database from Eventor” gives ”Suggestions from the runner database” when you type a name."
      ],
      "Click a runner in the list to open the participant card. There you change name, club and start time, and under ”Correct” everything that changes the result: status, time, controls, class, variant and card."
    ]
  },
  {
    id: "start",
    title: "Start and draw",
    views: ["START"],
    body: [
      "Under ”Draw” you choose the start type per class and tick the classes. Write ”First start (clock)” and press ”Show draw”. If it is right: ”Save the draw”.",
      [
        "”Advanced”: start order, a later start for a class, maximum starts per minute and seeding.",
        "”Free start”: the class gets no start times. The runners punch start.",
        "”Move start times” under ”The start list”: move all times in a class, for example when the start was late.",
        "”Publish the start list”: the list is visible to everyone. Publish again after changes.",
        "”Update the start list continuously”: changes show at once without publishing again.",
        "”Show card numbers in the public start list” and ”Short information about the event” are under ”Settings” → ”Information for the runners”."
      ]
    ]
  },
  {
    id: "avlasning",
    title: "Readout with a station",
    views: ["READOUT_PAGE", "READOUT"],
    body: [
      "Open the readout with ”Open readout”. Keep it in its own tab and change pages in another tab, so the station is not disconnected.",
      [
        "Computer: plug in the station and press ”Connect SPORTident station”. Use Chrome or Edge.",
        "Mac: install the CP210x VCP driver from Silicon Labs and allow it in System Settings. Otherwise no station shows.",
        "Android tablet: use Chrome and press ”Connect via USB (tablet)”. iPhone and iPad do not work.",
        "Next time the page connects to the same station by itself. ”Stop connecting automatically” turns that off.",
        "”Sound at readout”: three rising tones when approved and three falling tones on an error.",
        "Do not use a private window. Readouts can then disappear when the window is closed."
      ],
      "The readout works without a network. Readouts are saved in the browser and sent when the network is back.",
      "To try it without a station: ”Start practice station”. It writes real readouts, so do not use it during the event."
    ]
  },
  {
    id: "okand-bricka",
    title: "Unknown card, direct entry and borrowed card",
    views: ["READOUT_PAGE", "READOUT"],
    body: [
      "If the card is not entered, the readout shows ”UNKNOWN CARD”. Fill in class and name under the message and press ”Add”. It works without a network.",
      [
        "If the card is in the runner database, name and club are filled in.",
        "Already entered without a card: choose the runner under ”Is it someone who is already entered?”.",
        "Borrowed card (read out for someone else): enter the person who ran. Same runner again: ”It is the same runner – use the new readout”.",
        "In the workspace: ”Readout” → ”Unknown cards”. Link to an entered runner or choose ”New direct entry”."
      ]
    ]
  },
  {
    id: "nodlagen",
    title: "Emergencies during the event",
    views: ["READOUT", "RESULTS", "ENTRIES"],
    body: [
      "Under ”Readout” → ”More: tools for the whole event” → ”Corrections for the whole event”:",
      [
        "”Adjust time for a station”: when a unit had the wrong clock. The time changes for everyone who punched there.",
        "”Control out of order”: the control is not required on any course."
      ],
      "Press ”Show what happens” and then ”Save and recalculate”. Everything can be removed again.",
      "For one runner everything is under ”Correct” in the participant card, also via ”Correct a runner” and ”Open”:",
      [
        "”Enter time manually”: when the finish or start is missing, or the card is lost.",
        "”Approve missing controls”: when the runner was demonstrably at the control.",
        "”Change card” and ”Change class”: the readout follows to the right runner and is recalculated.",
        "”More”: correct a single punched finish or start time and remove such a correction."
      ],
      "Errors after an update of O-Tid: ”Re-read readouts from raw data” under the same ”More”."
    ]
  },
  {
    id: "status",
    title: "Did not start, did not finish, disqualified and other statuses",
    views: ["ENTRIES", "READOUT", "RESULTS"],
    body: [
      "Open the runner's participant card and go to ”Correct”. Choose under ”Change status” and press ”Confirm the change”.",
      [
        "”Did not start”: the runner did not start.",
        "”Did not finish”: the runner did not finish the race.",
        "”Disqualify”: with a reason if you like.",
        "”Out of competition”: the time is shown but the runner is not placed.",
        "”Took part without time”: for someone who ran without a card. Shown last in the class."
      ],
      "A decision is removed under ”Change status” again. After the event you can choose ”Mark everyone still out as did not start” under ”Results” → ”Follow-up”."
    ]
  },
  {
    id: "resultat",
    title: "Results and export",
    views: ["RESULTS"],
    body: [
      "Results are calculated automatically when the runners read out. The lists can be printed with ”Print” and downloaded with ”Export” (”IOF XML” or ”CSV (Excel)”).",
      [
        "”The results are ready”: when everyone has finished and everything is right. The lists then show official results. Not for Training, Small event and Rogaining.",
        "”Download IOF file for Eventor”: the file to upload to Eventor.",
        "”Make the results preliminary again”: undoes it.",
        "”Download backup” under ”Settings”: the whole event in one file. Take it after the draw, before the start and after the last finisher.",
        "”Restore event from backup” on My events: the file becomes a new event, also on another server."
      ]
    ]
  },
  {
    id: "funktionarer",
    title: "Officials",
    views: ["SETTINGS", "EVENTS"],
    body: [
      "An official reads out, makes direct entries, follows those still out, runs the start and sees the speaker page. Nothing else.",
      "The official sees the full names, clubs and cards of participants and guests and can download the party's purchases (”Download summary (CSV)”), so only give access to people you trust.",
      "Go to ”Settings” → ”People with access”.",
      "Write one or more email addresses under ”Add a person”, choose ”Official” and press ”Add”.",
      "The person gets an email with a link and lands on the event after signing in (see [Invitations by email](#inbjudningar)).",
      "”Remove” removes the access at once."
    ]
  },
  {
    id: "inbjudningar",
    title: "Invitations by email",
    views: ["SETTINGS", "EVENTS", "ARCHIVE_MEMBERS"],
    body: [
      "When you invite someone to an event, a club archive or a training group, the access is saved for the email address, and with email on the server the person gets an email saying who invited them, to what, the role and a link.",
      "The link opens a page with ”Create account” (the address filled in and locked) and ”Sign in”.",
      "The access applies once the person is signed in with exactly that address and has confirmed it, and then the person lands on the event, in the club archive or in the group.",
      "The link is valid for 14 days and gives nothing by itself, and the page looks the same whether or not the address already has an account.",
      [
        "The list shows when the invitation was sent, or ”not sent”.",
        "”Send again” sends a new email with a new link; the previous one stops working. At most a few times an hour to the same address.",
        "Without email on the server it says ”Copy the link” instead. Paste the link into your own email or text message.",
        "”Remove” removes the invitation, and the link then shows ”The invitation is no longer valid”."
      ],
      "Several addresses can be added at once, separated by commas, spaces or new lines, and everyone gets the same role and an email each.",
      "Invitations ”Från klubben” are emailed the same way, but you only see the person's name."
    ]
  },
  {
    id: "live",
    title: "Live, speaker and still out",
    views: ["READOUT", "RESULTS", "PUBLISH"],
    body: [
      "Live is on the event page when the event is published. It shows the latest finishers, leaders per class and radio controls. The audience can follow runners and clubs.",
      "The speaker page opens with ”Open speaker” in the workspace's top bar. It exists for Event and Relay and updates by itself.",
      "”Still out” under ”Readout” shows entered runners who have not read out. The full list with printing is under ”Still out – the full list, manual return and printing”.",
      "Always check with the finish before you stop looking for runners."
    ]
  },
  {
    id: "radio",
    title: "Radio controls",
    views: ["SETTINGS", "RESULTS"],
    body: [
      "Split times from radio controls in the forest come via ROC or OResults. Not available for Training and Rogaining.",
      "Go to ”Settings” → ”Radio controls”. Turn on ”Fetch radio punches”, choose ”Source” and write ”ROC id”.",
      "Tick the controls that send punches and press ”Save”. ”Fetch now” tests the connection.",
      "On the day of the event the punches are fetched by themselves. The readout at the finish still decides the result."
    ]
  },
  {
    id: "si-enheter",
    title: "SPORTident units before the event",
    views: ["READOUT_PAGE", "READOUT", "START"],
    body: [
      "Do this the day before or well before the start:",
      [
        "Set the right time and date in all units, with SPORTident Config+.",
        "Put the readout station in readout mode (Readout).",
        "Have clear and check units at the start, so that old punches do not come along.",
        "Run a test card through the start, all controls and the finish. Read it out and check that the times are right."
      ],
      "If the station's clock is wrong, the readout shows a warning. If you notice it during the event: use ”Adjust time for a station”."
    ]
  },
  {
    id: "fest-bardisk",
    title: "Party and bar counter",
    views: ["PARTY", "READOUT_PAGE", "EVENTS"],
    body: [
      "Choose the type ”Party”. Set the party's start and add the items: one control unit per price, with code, name and price in kronor.",
      "The guests punch the unit with the right price themselves and then put the card in the bar counter.",
      [
        "The first readout checks the guest in. Unknown card: the guest chooses their name or types it.",
        "Later readouts show the new purchases since last time and the evening's total.",
        "The finish unit checks the guest out when it is time to go home. The same finish punch does not check out again.",
        "”Staff” has the modes ”Check in”, ”Buy/verify” and ”Check out” for corrections. The mode applies to the next readout.",
        "The same item again is a new purchase if the punch comes at least as many seconds after as ”Double punch within (seconds)” says."
      ],
      "The purchases are saved on the card and in the tablet even without a network, and forgotten purchases come along next time.",
      "The practice station's purchases do not count in the summary.",
      "In the workspace you see the total per person, undo a purchase with a reason, choose ”Remove check-in” or ”Remove check-out” and download CSV for Excel."
    ]
  },
  {
    id: "rogaining",
    title: "Rogaining: controls with points",
    views: ["COURSES", "CS_COURSES"],
    body: [
      "In rogaining the runner punches any controls within the time limit. The result is the sum of the controls' points minus the penalty for time over the limit.",
      [
        "The points follow the first digit of the control code: 31 gives 3 points, 52 gives 5 and 102 gives 10, as IRF rule C9 prefers.",
        "Put the courses in ”Course setting”: new courses become score courses. An empty points field means the code's first digit.",
        "Write other points in the field for controls that should give more or less.",
        "”Transfer to the event …” brings the points along. Changed points are listed as separate rows before you approve.",
        "Under ”Controls & points” the points can be changed afterwards, and the classes' time limit and penalty are set there."
      ],
      "If someone has already read out, O-Tid shows which results change before the points are saved."
    ]
  },
  {
    id: "sjalvregistrering",
    title: "Self-registration on the day of the event",
    views: ["PARTY", "SETTINGS", "PUBLISH"],
    body: [
      "With ”Allow self-registration on the day of the event” anyone can link their name to their card on the public page, without signing in.",
      "For a party the choice is in the Party part, for other types under Settings. It is off by default.",
      "The form ”Register your card” only shows when the choice is on, the event is published and it is the day of the event (a party also the night after, until 06:00).",
      [
        "Party: the guest gets their name on the card, and the bar counter recognises it within a few seconds.",
        "Other types: the runner chooses a class and is entered with the card; an unknown readout of the card is assessed at once.",
        "A card that already belongs to someone is rejected, and nothing is overwritten."
      ],
      "Self-registered runners are marked ”Self-registered” in the participant list and the guest list. There you can change the name or, at a party, choose ”Unlink the card”."
    ]
  }
];

/** Engelska artiklar i stället för de svenska med samma id; resten (banläggningen, klubbarkivet) är svenska än så länge. */
export const helpArticlesEnById: ReadonlyMap<string, HelpArticle> = new Map(
  [...raceDayHelpArticlesEn, ...accountHelpArticlesEn, ...routeChoiceHelpArticlesEn].map(article => [article.id, article]));

export const helpArticlesFor = (articles: readonly HelpArticle[]): readonly HelpArticle[] =>
  articles.map(article => helpArticlesEnById.get(article.id) ?? article);
