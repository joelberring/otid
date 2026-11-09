/** Demoläget del 2: gästkontot och dess övningstävling, på svenska och engelska. Bara påhittade namn. */
export const guestDemoRaceSv = {
  displayName: "Gäst",
  race: { eventName: "Övningstävling", raceName: "Kvällsträning", organisation: "Demo OK" }
};

export const guestDemoRaceEn: typeof guestDemoRaceSv = {
  displayName: "Guest",
  race: { eventName: "Practice event", raceName: "Evening training", organisation: "Demo OC" }
};

/** Knappen på startsidan och beskeden efter den. */
export const guestDemoHomeSv = {
  button: "Prova arbetsytan",
  explanation: "Utan konto: du får en egen övningstävling med påhittade löpare. Ingenting syns utåt, och allt tas bort efter ett dygn.",
  busy: "Det har skapats många övningstävlingar härifrån den senaste timmen. Försök igen om en stund, eller skapa ett eget konto.",
  failed: "Övningstävlingen kunde inte skapas. Försök igen om en stund."
};

export const guestDemoHomeEn: typeof guestDemoHomeSv = {
  button: "Try the workspace",
  explanation: "No account needed: you get your own practice event with made-up runners. Nothing is shown publicly, and everything is deleted after a day.",
  busy: "Many practice events have been created from here in the last hour. Try again in a while, or create your own account.",
  failed: "The practice event could not be created. Try again in a while."
};
