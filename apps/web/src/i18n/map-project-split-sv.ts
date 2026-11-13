/** Ägaren 2026-11-13: dela kartområdet eller en del med ett streck (som tårtbitar). */
export const mapProjectSplitSv = {
  button: "Dela med ett streck",
  buttonHelp: "Dra ett streck tvärs över kartområdet eller en del. Delarna får gemensam gräns, så inget hamnar dubbelt eller utanför. Är en del vald i listan delas bara den.",
  hint: "Klicka där strecket ska gå, tvärs över kartområdet eller en del. Dubbelklicka eller tryck Enter för att dela.",
  /** Namnet på en ny del är detta och ett löpnummer ("Del 3"). */
  partPrefix: "Del",
  done: (names: readonly string[]) => `Delat i ${names.join(", ")}.`,
  tooShort: "Strecket behöver minst två punkter.",
  outside: "Strecket korsar inget område. Dra det tvärs över kartområdet eller en del, från kant till kant.",
  notAcross: "Strecket går inte hela vägen över. Dra det från kant till kant (det får gärna sticka ut utanför).",
  tooComplex: "Delarna får för många punkter för att sparas. Dela med ett enklare streck.",
  noMapArea: "Kartan har inget känt område att dela än."
};
