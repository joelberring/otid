import type { Texts } from "../lib/language";
import type { mastermindBoardSv } from "./mastermind-board-sv";

/** Mastermind with controls: the public standings on the race page (ADR-0228). */
export const mastermindBoardEn: Texts<typeof mastermindBoardSv> = {
  heading: "Mastermind with controls",
  help: "The standings right now. The time runs from the team's first readout to the readout of the guess that cracked the pattern.",
  place: "Place", team: "Team", guesses: "Guesses", time: "Time", status: "Status",
  card: (end) => `Card …${end}`,
  none: "No games yet.",
  play: "Play on this computer",
  playHelp: "Opens the board. The computer needs a readout station (USB, or Reader BT in Chrome, Edge or Opera).",
  rules: [
    "Each colour is a control. The card has its own secret pattern of colours.",
    "Read out the card once: the clock starts.",
    "Punch the colour controls in the order you guess and read out. Black peg: right colour in the right place. White: right colour in the wrong place.",
    "The clock stops when you crack the pattern. Fastest wins."
  ],
  states: { playing: "playing", won: "solved", lost: "out of guesses" }
};
