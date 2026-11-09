import { EVENTOR_KEY_PLACE_EN } from "./club-space-en";
import type { HelpArticle } from "./help-sv";

/** Engelska artiklar för klubbtillhörigheten (help-club-sv) och klubbarkivet (help-archive-route-sv), med samma id. */
export const clubHelpArticlesEn: readonly HelpArticle[] = [
  {
    id: "mina-klubbar",
    title: "My clubs",
    views: ["EVENTS"],
    body: [
      "When you have created an account, O-Tid asks which club you belong to. It is optional: choose ”Skip” if you do not want to answer now.",
      [
        "Search for the club's name or abbreviation, for example älvsjö or okäö, and choose the club in the list. You can choose several.",
        "If the club is not in the list: write the name under ”Other club”.",
        "Save with ”Save the clubs”. You change it later under ”My account” → ”My clubs”."
      ],
      "Choosing a club gives you nothing in O-Tid until the club has confirmed you. If the club has linked its club space to Eventor and your email address is in the club's member list there, you are confirmed at once.",
      "If nobody from the club has started a club space yet, ”Start the club space” is shown. It is meant for an administrator in Eventor: see [Link the club space to Eventor](#klubben-i-eventor)."
    ]
  },
  {
    id: "klubben-i-eventor",
    title: "Link the club space to Eventor",
    views: ["ARCHIVE_CLUB"],
    body: [
      "The club space shows ”Not linked to Eventor” until the club's own API key from Eventor has been added. Only an administrator of the club in Eventor can create the key, so the link shows that the club space belongs to the club.",
      { steps: [
        `Get the club's API key. It is in Eventor under ${EVENTOR_KEY_PLACE_EN}. If you do not have it: see [Get started with the club space](#klubbytan-kom-igang).`,
        "Open the club space and the tab ”The club”.",
        "Paste the key under ”The club's API key” and choose ”Link to Eventor”.",
        "O-Tid asks Eventor which club the key belongs to and fetches the member list. Members with the same address in O-Tid are confirmed.",
        "The list is fetched again once a day. To fetch it at once: ”Fetch members now”. See also [Confirm members](#bekrafta-medlemmar)."
      ] },
      "The key is stored encrypted and never shown again, only the last four characters. Of the member list only Eventor's person id and an unreadable fingerprint of the email address are stored, no names or other details. With ”Change key” you add a new key, and ”Remove the link” removes the key and the list.",
      "A club in Eventor can only be linked to one club space. If it is already linked: contact the owner of that club space."
    ]
  },
  {
    id: "klubbytan-kom-igang",
    title: "Get started with the club space",
    views: ["ARCHIVE_TRAININGS", "ARCHIVE_CLUB"],
    body: [
      "Owners and administrators see ”Get started” at the top of the club space until it is linked to Eventor and has at least one map. You can also choose ”Hide”.",
      [
        "Link the club to Eventor with the club's API key. It is the next step in a new club space.",
        "Invite more leaders and administrators under ”Members”.",
        "Upload maps under ”Maps” or import the archive under ”Import”.",
        "Choose under ”Who sees what”. The default is ”All members”."
      ],
      "If you do not have the key: choose ”Ask the club's Eventor administrator to link”. You get a ready text to copy or open in email. It says what O-Tid is, where the key is in Eventor and where it is pasted.",
      "Invite the person as ”Administrator” under ”Members”, and they paste the key themselves. The text has no key, and the key should never be sent by email."
    ]
  },
  {
    id: "klubbens-enheter",
    title: "Reading out and setting up units, and the club's unit register",
    views: ["ARCHIVE_DEVICES", "READOUT_PAGE"],
    body: [
      "Under readout there is ”Read out units”: put a SPORTident unit in the master station and O-Tid reads the system data, the clock and the backup memory with the runners.",
      [
        "”Set up the unit” sets the clock from the computer, the code and the mode. The unit is read again and the page shows before and after.",
        "Choose a club on the page, and every unit read out or set up is saved in the club's register.",
        "The tab ”Units” in the club space shows the units with serial number, code, mode, battery age, clock error and a note."
      ],
      "Setting up has only been tried against a fake unit. Try it on a few units first and save the raw log from the page if something looks wrong."
    ]
  },
  {
    id: "bekrafta-medlemmar",
    title: "Confirm members and Who sees what",
    views: ["ARCHIVE_CLUB", "ARCHIVE_MEMBERS"],
    body: [
      "Under the tab ”The club” owners and administrators see who is waiting for confirmation. These are the people who chose the club but whose address was not in Eventor, and those who wrote a similar name under ”Other club”.",
      [
        "”Confirm”: the person becomes a member of the club space. Only confirm someone you know is in the club.",
        "”Decline”: the person gets nothing, and sees that the club has not confirmed them.",
        "”Remove” next to a confirmed member removes what the person sees in the club space.",
        "If someone leaves the club in Eventor, what Eventor gave disappears at the next fetch. Confirmations made by hand remain."
      ],
      "The roles are ”Member”, ”Leader”, ”Administrator” and ”Owner”. An administrator sets leaders in the list under ”Members” or when inviting.",
      "Under ”Who sees what” the club chooses who sees the training archive and who may use the map bank (map files, Use again, download). The default for both is ”All members”; choose ”Leaders and admins” if the maps should not be shared with all members. Owners and administrators always see and use everything. For members and leaders the map's own rights also apply; the strictest wins."
    ]
  },
  {
    id: "bjud-in-fran-klubben",
    title: "Invite from the club",
    views: ["SETTINGS", "ARCHIVE_MEMBERS"],
    body: [
      "Where you can add people, under ”People with access” in an event, in the club space and in a training group, there is ”From the club”. It lists the confirmed members of your clubs who have O-Tid.",
      [
        "Search for the name and tick one or more.",
        "Choose a role and invite. The invitation goes to the person's address, which you never see.",
        "The person accepts the invitation as usual, through the email or when they sign in."
      ],
      "You can still write an email address as before. Anyone who is not a confirmed member of one of your clubs is not shown in the list."
    ]
  },
  {
    id: "tavling-i-klubbarkivet",
    title: "Put an event in the club archive",
    views: ["SETTINGS", "RESULTS", "ARCHIVE_TRAININGS"],
    body: [
      "Under ”Settings” → ”The club and the club archive” you choose the event's ”Organising club”. The default is your confirmed club. Before the event nothing about it is shown to the club, only to those with access to the event.",
      "When the event is over, the workspace shows a reminder. ”Put in the club archive” makes a training in the club's archive with the map file, the course setting (.ppen), the courses (IOF XML) and a link to the event. Start lists, results and participants are never included.",
      [
        "You need to be an administrator both in the event and in the club space.",
        "Before the day of the event, or while the courses are secret, O-Tid first asks about course secrecy.",
        "”Take out of the club archive” removes the training from the archive. The event is not changed."
      ]
    ]
  },
  {
    id: "klubbarkiv",
    title: "The club archive",
    views: ["ARCHIVE_TRAININGS", "ARCHIVE_ENTRY", "EVENTS"],
    body: [
      "The club archive keeps the club's maps and courses from earlier trainings, so they can be used again. It is never public; only those invited see it.",
      "Create it at the top of ”My events” → ”My clubs” → ”New club space”. Whoever creates the club becomes its owner.",
      [
        "”Trainings”: search for place, exercise or course and filter by year, map, tag and leader.",
        "”Maps”: the maps with all versions. See [Maps, versions and rights](#arkiv-kartor).",
        "”Members”: who sees and changes the archive. See [Members](#arkiv-medlemmar).",
        "”Import”: read in the club's old trainings from your computer. See [Import to the archive](#arkiv-import)."
      ],
      "The archive shows the training as it was held. To change the courses: [Use a training again](#anvand-igen)."
    ]
  },
  {
    id: "anvand-igen",
    title: "Use a training again",
    views: ["ARCHIVE_ENTRY", "ARCHIVE_TRAININGS"],
    body: [
      "Open a training in the archive and press ”Use again”. The archive never changes; you get a new training with the map and the courses.",
      [
        "”Name” and ”Date” for the new training.",
        "”Where”: ”New training (My events)” or in a training group.",
        "”Course file” if the training has several, and ”Map version” (the latest version is preselected).",
        "Press ”Create the training”. Course setting opens with a copy to change."
      ],
      "If the map is newer than the one the courses were set on, O-Tid moves the courses by the maps' georeference. If it is missing: move the course with the arrows and press ”The courses are in the right place”.",
      "A map file over 75 MB cannot be the training's map yet, but the courses are included."
    ]
  },
  {
    id: "arkiv-kartor",
    title: "Maps, versions and rights",
    views: ["ARCHIVE_MAPS", "ARCHIVE_ENTRY"],
    body: [
      "A map is an area with versions. Old trainings show the version they were set on; ”Use again” chooses the latest.",
      [
        "”New map” and ”Upload new version”: OCAD (.ocd) or Mapper (.omap, .xmap), at most 75 MB.",
        "”Merge marked” or ”Possible duplicates” makes several maps into one. ”Move the version to …” moves one version.",
        "”Change rights”: the club's own or an external map, owner, agreement, training only, fee per print and public display.",
        "The rights apply to all versions and follow the map when it is used in a group or an event.",
        "”Put in the group's map library” puts the latest version in a training group."
      ],
      "The images and the check of the maps: [Images and check of the maps](#arkiv-bilder). Duplicates: [Duplicates and versions of maps](#arkiv-dubbletter)."
    ]
  },
  {
    id: "arkiv-dubbletter",
    title: "Duplicates and versions of maps",
    views: ["ARCHIVE_MAPS", "CS_START", "EVENTS"],
    body: [
      "The same map often exists under several file names. ”Possible duplicates” at the top of the tab ”Maps” shows maps that are probably the same, with image, year and the reasons:",
      [
        "”Probably the same map” or ”Maybe the same”. The reasons are for example the same area with the overlap, ”Similar name” and ”Same symbols”.",
        "Choose under ”Keep the name and details from” which map keeps the name and the rights. The default is the one used most.",
        "”Merge into one map” moves the versions of the others there. ”Not the same map” removes the suggestion for good.",
        "Your own choice: tick the maps and press ”Merge marked”."
      ],
      "The map files and the trainings never change: every training still shows the version it was set on.",
      [
        "Every version has a year, guessed from the file name, the folder or the upload. ”Change year and details” corrects it.",
        "The versions are listed newest first, and the card says for example 5 versions, 2014–2023.",
        "”Copy to all versions” puts one version's mapper or note on the others; you first see what changes. ”From the map” takes the map's mapper.",
        "”History” → ”Undo merge” splits the maps again, as long as nothing else has changed in the map."
      ],
      "When you create a training or open course setting without a map, ”Choose map from the club archive” picks a map from your clubs; the latest version is preselected."
    ]
  },
  {
    id: "arkiv-bilder",
    title: "Images and check of the maps",
    views: ["ARCHIVE_MAPS", "ARCHIVE_TRAININGS"],
    body: [
      "Every map version and training gets a small image. The images are drawn in the browser while an owner or administrator has the archive open, a few maps per visit.",
      "Next to every version is ”Works” with the OCAD version, or the reason it could not be drawn. OCAD 7 and older do not work: save the map in a newer OCAD or in Mapper.",
      "”Check all maps again” reads every map version again, draws all images and recalculates the summaries of the course files. It takes a while; keep the page open."
    ]
  },
  {
    id: "arkiv-medlemmar",
    title: "Members of the club archive",
    views: ["ARCHIVE_MEMBERS"],
    body: [
      "Invite with the email address under ”Members” → ”Invite”; several addresses work at once. The person gets an email with a link and becomes a member when they sign in with the address and have confirmed it. ”Send again” (or ”Copy the link” without email on the server) is next to every invitation; see [Invitations by email](#inbjudningar).",
      [
        "”Owner”: everything, also changing the owners. The club always has at least one owner.",
        "”Administrator”: changes the archive, invites, confirms and imports. Owners and administrators always see everything.",
        "”Leader”: sees the training archive and uses the map bank (map files, Use again).",
        "”Member”: sees what the club chooses under [Who sees what](#bekrafta-medlemmar).",
        "”Change role” and ”Remove” are next to every person."
      ]
    ]
  },
  {
    id: "arkiv-import",
    title: "Import to the club archive from your computer",
    views: ["ARCHIVE_IMPORT"],
    body: [
      "If the club has old trainings in folders or zip files on a computer, you read them in here; only owners and administrators import.",
      { steps: [
        "Open the tab ”Import” and press ”Choose folder”. Choose the folder with the year folders (2018, 2019 …) or a single year folder.",
        "Zip files from Google Drive you choose with ”Choose files”. You can also drag folders and zip files to the box.",
        "If the leaders' names should not be included: tick ”Do not include the leader's name from [square brackets]”.",
        "Press ”Preview”. You see the trainings, the maps, what is new and which files are not sent. Nothing has been sent yet.",
        "Press ”Import”. The maps are sent first, then the trainings. ”Cancel” stops at any time.",
        "If the import was stopped or the tab was closed: choose the same files and import again. What already exists is skipped."
      ] },
      "The files are read on your computer. Only map files and course files (.ocd, .omap, .xmap, .ppen, CourseData) are sent; PDF, Word, Excel, images, start lists and results never leave the computer.",
      "A map file over 75 MB is not sent, and the preview says which one. ”Download the report” saves the preview as a text file.",
      [
        "If you know Git: open ”For those who know Git: the command line”, press ”Create import key” and run the command shown there.",
        "The key is valid for 12 hours and ”Revoke” stops it. The flag --utan-ledare does the same as the checkbox."
      ]
    ]
  }
];
