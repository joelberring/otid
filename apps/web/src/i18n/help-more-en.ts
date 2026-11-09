import type { HelpArticle } from "./help-sv";

/** Engelska del 27: hjälpen om kontot och om kontrollkartan och vägvalsanalysen (samma id som de svenska). */
export const accountHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "konto",
    title: "Create an account and confirm the email address",
    views: ["EVENTS"],
    body: [
      "An account is needed to create events and get access. It is created with the email address, which you confirm with a link.",
      [
        "Choose ”No account? Create one” at sign-in and write your name and email address.",
        "Write the password in both ”Password” and ”Repeat the password”. If they differ, the page says so at once.",
        "The eye by the field (”Show the password”) shows what you have typed.",
        "Press ”Create account”. The link in the email works in any browser, for example on your phone.",
        "Behind the link you choose the password (the same or a new one) and press ”Confirm and sign in”."
      ],
      "If the link has expired, or you cannot get in: see [Forgot password](#glomt-losenord). That also confirms the address."
    ]
  },
  {
    id: "glomt-losenord",
    title: "Forgot password",
    views: ["EVENTS"],
    body: [
      "Choose ”Forgot password?” at sign-in, write the email address and press ”Send link”. The link is valid for an hour and can be used once.",
      "Open the link, write the new password twice and press ”Save and sign in”. You are signed in at once, and other devices are signed out.",
      [
        "It also works if you never confirmed the address: the link confirms it.",
        "If you typed the wrong password too many times, the new password lifts the block, so you do not need to wait.",
        "If you then open the old confirmation email, the page says the address is already confirmed."
      ],
      "When signed in you change the password under ”My account” → ”Change password”."
    ]
  },
  {
    id: "google",
    title: "Sign in with Google",
    views: ["EVENTS"],
    body: [
      "If the button ”Sign in with Google” is on the sign-in page, you can use your Google account instead of a password.",
      "If O-Tid has an account with the same email address, Google is linked to it and the address counts as confirmed; otherwise a new account is created.",
      "Google must have confirmed the email address. To also be able to sign in with a password: choose one with [Forgot password](#glomt-losenord).",
      "A blocked account cannot get in with Google either.",
      "Does your Google account have another address? Sign in as usual and link Google under My account ([Link Google account](#google-koppla))."
    ]
  },
  {
    id: "google-koppla",
    title: "Link Google account",
    views: ["EVENTS"],
    body: [
      "Does your Google account have another address? Sign in as usual and link Google under My account.",
      { steps: [
        "Sign in with the email address and password and open ”My account” in the menu with your name.",
        "Press ”Link Google account” under ”Sign in with Google” and choose the Google account at Google.",
        "Back in O-Tid it says the Google account is linked. After that ”Sign in with Google” is enough."
      ] },
      "The account's email address does not change; Google's address is only shown with the link.",
      [
        "”Remove the link” removes it again, but not if the account has no password of its own.",
        "If Google earlier created an empty account for you, the link moves here when you confirm with the password.",
        "Confirm with ”Move the link and remove the duplicate”; the empty account is deleted.",
        "If the other account is in use (events, access, clubs): sign in there and remove the link first."
      ]
    ]
  },
  {
    id: "logga-ut",
    title: "Sign out and borrowed computers",
    views: ["EVENTS", "COURSE_SETTING", "CS_PRINT_PAGE"],
    body: [
      "The menu with your name (the initials on a phone) is at the top of every page when you are signed in.",
      [
        "It has ”My events”, ”My clubs”, ”My groups”, ”My account” and ”Sign out”.",
        "”Sign out” also removes what the browser has saved about events and people, such as the field mode's copy.",
        "If changes are waiting for the network, the menu asks first. Readouts that have not been sent stay until they arrive.",
        "”Remember me on this computer” lasts 30 days. Without it the sign-in lasts twelve hours.",
        "Forgot to sign out somewhere: ”My account” → ”Sign out from all devices”."
      ],
      "Do not use ”Remember me on this computer” on a borrowed computer."
    ]
  }
];

export const routeChoiceHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "vagval-strackan",
    title: "Route choice in course setting",
    views: ["CS_SELECTED", "CS_COURSES"],
    body: [
      "Choose a course at the top and click a leg. The tab ”Selected” shows ”Selected leg” with the route choices, calculated from the map file.",
      [
        "Straight line: a straight line between the controls.",
        "Best route: the fastest route with length, climb and approximate time. It is drawn as a blue line.",
        "Options: other route choices, dashed and numbered. +12 % means 12 % longer time than the best route.",
        "Only route choices at most 25 % worse are shown. The shaded corridor is routes at most 5 % worse.",
        "Choose a row in the list and that route is marked on the map."
      ],
      "The route choices are recalculated when you move a control. ”Calculate along route choices” in the tab ”Courses” gives the whole course's length along the best route choices.",
      "How the time is calculated: [The route choice analysis](#vagval)."
    ]
  },
  {
    id: "kontrollkarta",
    title: "The control map",
    views: ["CONTROL_MAP", "COURSES"],
    body: [
      "”Control map” under ”Courses” in the workspace shows the event's controls on the map. Choose a mode at the top:",
      [
        "”Load”: a larger and darker circle = more runners, by ”Planned runners” or ”Punches”.",
        "”Course”: a course or variant with lines, and the fork diagram for forked courses.",
        "”Route choice”: the route choice analysis per leg. See [The route choice analysis](#vagval)."
      ],
      "The map under the controls is the map file or map image from ”Map and route choice”. If the course file has no positions, only the table is shown."
    ]
  },
  {
    id: "vagval",
    title: "The route choice analysis: how it is calculated",
    views: ["ROUTE_CHOICE", "CONTROL_MAP"],
    body: [
      "Choose a course or variant. All legs are calculated in the browser from the map file and the course setting's barriers.",
      "The map's symbols become terrain types: fast (road, path, open land), ordinary forest, slow, very slow, almost stop and impassable. The time is calculated from the speed in ordinary forest and the climb.",
      [
        "”Straight line” and ”Best route”: the length straight and along the fastest route.",
        "”Climb”: metres uphill along the best route. 1 m of climb counts as 8 m of flat road unless set otherwise.",
        "”Estimated time”: the time for the best route at the speed in ordinary forest (6:00 min/km unless set otherwise).",
        "”Route choices”: how many route choices are at most 25 % slower than the best.",
        "”Assessment”: ”Route choice leg”, ”No route choice” or ”The route choices are about equally good”.",
        "About equally good means the best route choice changes if the speeds change 15 % up or down.",
        "”To check”: the best route passes through another control's circle, a control is in impassable terrain or no route exists."
      ],
      "The times are for comparing route choices, not for predicting the runners' times. See also [Settings and barriers](#vagval-installningar)."
    ]
  },
  {
    id: "vagval-installningar",
    title: "The route choices' settings and barriers",
    views: ["ROUTE_CHOICE"],
    body: [
      "”Settings for the route choices” is under the table. Changes are recalculated at once and saved for the event:",
      [
        "”Contour interval (m)”: the distance between the contours on the map (5 m by default).",
        "”1 m of climb counts as (m of flat road)”: how expensive climbing is (8 by default).",
        "”Speed in ordinary forest (min/km)”: the base speed the other terrain types are calculated from.",
        "”Symbols not in the table” count as ordinary forest until you choose something else."
      ],
      "The barriers from course setting are included. Forbidden and dangerous areas, temporary constructions, boundaries and forbidden routes cannot be crossed.",
      "An optional crossing point opens a barrier where it stands, like a gate."
    ]
  },
  {
    id: "vagval-kalibrering",
    title: "Adjust the speeds to the runners' GPS routes",
    views: ["ROUTE_CHOICE"],
    body: [
      "Once the runners have run the course, the speeds can be compared with their routes. First upload the GPS routes (GPX) under ”Map and route choice”.",
      [
        "Open ”The speeds against the runners' routes” under the table and press ”Adjust the speeds to these routes”.",
        "The routes are processed in the browser and are not sent anywhere.",
        "The table shows each terrain type's speed against ordinary forest, ”Before” and ”After”.",
        "Under the table it says how much data it is based on. With little data: treat the suggestion as a rough guide.",
        "”Save” makes the new speeds the event's, and the route choices are recalculated."
      ],
      "Only runners with results on the course count."
    ]
  },
  {
    id: "vagval-publicera",
    title: "Show best route choices publicly",
    views: ["ROUTE_CHOICE"],
    body: [
      "”Show best route choices publicly” shows the best route per leg in the public split analysis, next to the runners' routes.",
      "It only shows once the courses are public, and all legs must be calculated. ”Hide best route choices publicly” removes it.",
      "If the map file is changed, the route choices are no longer shown; open ”Route choice” and publish again. The map's rights can stop public display."
    ]
  }
];
