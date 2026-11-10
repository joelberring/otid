import type { Texts } from "../lib/language";
import type { accountSv } from "./account-sv";

/**
 * Personuppgifter i O-Tid på engelska (översynen 2026-11-10, E). Samma form och samma innehåll som `accountSv.privacy`;
 * ändras den svenska texten ska den här ändras med den.
 */
export const privacyEn: Texts<typeof accountSv.privacy> = {
  title: "Personal data in O-Tid",
  intro: "O-Tid only stores what is needed to organise races and show results.",
  whatTitle: "What is stored",
  accounts: "Accounts: email address, name and the password in encrypted form (it cannot be read back), when the account was created and last signed in, and when the email address was confirmed. Confirmation and reset links are only stored as a hash and are valid for one day and one hour respectively.",
  races: "Races: the runners' names, clubs, classes, card numbers, start times, punches and results, raw readouts from the stations, radio punches from ROC or OResults and, if the organiser uploads them, the map and GPS tracks.",
  runners: "The runner database (if an organiser fetches it from Eventor): the club's runners, and those of added clubs or of the whole country if the organiser chooses so, with the Eventor id, name, year of birth (not the full date of birth), sex, club and SPORTident cards, and Eventor's list of clubs. It is stored once per club and shared by the club's races.",
  clubs: "Clubs (ADR-0209): the clubs you have chosen, whether and when the club confirmed you and by whom. The club list is Eventor's federations, districts and clubs. For a club space linked to Eventor, the club's API key is stored encrypted and, from the club's member list, only the Eventor person id and a hash of each email address (no names or other data); the list is replaced at every fetch. Confirmed members see each other's names, never addresses, when they invite. Your clubs are removed with the account.",
  groups: "Training groups: the group's name and settings, leaders and members (their accounts, added by a leader with an email address) and the group's sessions. Attendance and points are calculated from the sessions' published results and are not stored separately.",
  mapLink: "The link to the map drawer: only a hash of the link's key, when it was created, until when it is valid and when it was last opened. No IP address or browser is stored with the link; the IP address only counts as a hash in the limit on too many attempts (cleared after two days). The map drawer's answers are stored with the name they write themselves, otherwise as “Map drawer”.",
  courseSetting: "Course setting: the courses, the controls and the changes with who made them, notes and map errors with text, drawing, replies and photo (the photo is reprocessed in the browser before it is sent, so that the camera's data such as place and time do not follow along), who has checked a control and the print jobs. The phone's position in field mode is not stored as such; it is only used when you yourself move a control or leave a note where you stand.",
  printJobs: "Printouts: a print PDF is stored for 7 days (at most ten per race) and the row about the job (who, when, what) for 30 days. The PDFs are not included in the backup.",
  backup: "Backups: the whole database is copied every hour. On the server the hourly copies are kept for two days and one copy per day for 14 days. If whoever runs the installation has switched it on, the copies are also sent encrypted to a storage service outside the server and kept there for up to a year (one per hour for two days, one per day for 30 days, one per month for 12 months).",
  party: "Parties: the guest's name, club and display name linked to the card, the purchases (item and time, calculated from the card's punches), when the guest checked in and out at the bar, undone purchases and who at the bar did what.",
  selfRegistration: "Self-registration on race day: name, club, class (or display name at a party) and card number, marked as self-registered. The IP address is only stored as a hash with a secret key, for the limit on too many registrations, and is removed after two days.",
  logs: "Logs: who changed what in a race and what the superadmin has done (hidden or removed races, blocked or removed accounts). The number of attempts to sign in, create an account, reset a password and self-register is counted per address, which is only stored as a hash with a secret key.",
  whyTitle: "Why",
  why: "So that organisers can run the race or the party, calculate results and purchases and publish start lists and results, and to protect the accounts against intrusion and misuse. The runner database is used to suggest name, club and class when an unknown card is read out or a new participant is entered, even without a network.",
  howLongTitle: "How long",
  howLong: "Until the race (the party) or the account is removed. Then everything that belongs to it is removed, including raw readouts, purchases and logs. The organiser removes their race under Settings and you remove your account under My account. Withdrawn participants stay in the race but are not shown publicly. The counters for the limits are removed after two days. The runner database is replaced completely every time it is updated from Eventor and stays until it is updated or deleted (Settings → Eventor → Delete the runner database). What has been removed stays in the backups until they are overwritten: after 14 days on the server and, if the copy outside the server is switched on, after up to 12 months there.",
  oneRunnerTitle: "Remove or anonymise a runner",
  oneRunner: "If you do not want to be included in a race: contact the organiser. The organiser can remove a participant who has not read out, and "
    + "anonymise anyone on the participant card (Entries → the participant → Anonymise). Then name, club, card number, year of birth and "
    + "Eventor id are removed from the race: from the entry, the journal, the start lists and results and the imported files, and the GPS track is removed. "
    + "The result and the split times stay as “Anonymous participant”, so that the others' places are correct. The card's number remains in "
    + "the readout of the card (it is never changed), but is no longer linked to a name.",
  retention: (mode, months) => mode === "off"
    ? "This server does not clear out races automatically; they stay until the organiser or whoever runs the server removes them."
    : mode === "anonymize"
      ? `This server automatically anonymises races older than ${months} months: all participants become “Anonymous participant” and the results stay.`
      : `This server automatically removes races older than ${months} months, with everything that belongs to them.`,
  publicTitle: "What is public",
  public: "Once the organiser has published the race, anyone can read start lists and results with name, club and times without signing in. The pages with runners (the race page, start lists and results, parties and training groups) are closed to search engines and AI services.",
  publicItems: [
    "The start list does not show card numbers in new races. The organiser can switch it on under Settings → Information to the runners → “Show card numbers in the public start list” (races created before November 2026 keep their choice).",
    "The variant letter in a forked course and the map are shown publicly only after the start, unless the organiser has chosen otherwise under Publish.",
    "The results have split times. Live shows the latest finisher, the leader per class and the radio controls' times. Which runners you follow is only stored in your browser.",
    "Self-registered runners appear in the start list marked “self-reg.”.",
    "The party page shows the number of purchases, items and times, never amounts, card numbers or full names. The display names are only shown if the organiser switches on “Show names on the public page” (off by default). The party page is closed to search engines.",
    "The speaker page, Still in the forest, the readout, the bar and the CSV files are only for the organiser's administrators and officials, who see the full name."
  ],
  runnersPublic: "The runner database is never public: only the race's administrators and officials see it (as suggestions), and it comes along in the readout page's package to work without a network.",
  organizerCopyTitle: "The organiser's own copies",
  organizerCopy: "An administrator can download a backup of their race (Settings → Backup) and read it in as a new race, also on another server. The file contains the race's personal data: names, clubs, card numbers, start times, results and the email of those with permission, but no passwords or accounts. A copy on the organiser's computer or in the organiser's storage is the organiser's responsibility: keep it where only the organisers can reach it and remove it when it is no longer needed. Removing the race in O-Tid does not remove such copies.",
  responsibleTitle: "Who is responsible",
  responsible: "The server and the accounts are run by whoever operates this O-Tid installation (contact below). Which runners and data are entered in a race, training group or party is decided by the organiser, that is, whoever created it and those they have given permission.",
  contactTitle: "Contact",
  contact: "Send questions about your data, or if you want something removed, to whoever operates this O-Tid installation:"
};
