import type { Texts } from "../lib/language";
import type { homeSlidesSv } from "./home-slides-sv";

/** The start page slideshow for visitors who are not signed in. */
export const homeSlidesEn: Texts<typeof homeSlidesSv> = {
  label: "Pictures from O-Tid",
  previous: "Previous picture",
  next: "Next picture",
  pause: "Pause the slideshow",
  play: "Play the slideshow",
  choose: (index, title) => `Picture ${index}: ${title}`,
  position: (index, count) => `${index} of ${count}`,
  enlarge: "Open the picture in full size",
  slides: {
    grundkarta: { title: "From laser data to base map", text: "Load laser data, OpenStreetMap and orthophotos, and O-Tid makes a first draft of the map.",
      alt: "The map editor with the New base map guide at its last step: the contours from the laser run as a draft on the map, with the layers to add." },
    rita: { title: "Draw on the web and on your phone", text: "The map is drawn in the browser with the standard's symbols, and can be corrected on the phone in the forest.",
      alt: "The map editor's drawing mode with the symbols and a phone in the corner showing the same map." },
    vagval: { title: "Route choice", text: "Set the course and see the route choices leg by leg, with the best route on the map.",
      alt: "The control map in route choice mode, zoomed in on a long leg, with the best route and two other route choices drawn." },
    gps: { title: "Place controls with GPS", text: "In field mode the phone shows where you are, so the controls end up in the right place and can be ticked off.",
      alt: "Course setting with all controls on the computer and field mode on a large phone with the position on the map." },
    layout: { title: "Layout and print colours", text: "Courses and maps are printed in the right colours and in several scales and formats in the same event.",
      alt: "The layout overview with the same course on A4 and A3 in different scales, a print sheet with the map and the print colours above and below the course." },
    forbered: { title: "Prepare the event", text: "Classes, entries, the draw and the start list in one place.",
      alt: "The event workspace with the start list after the draw." },
    avlasning: { title: "Readout", text: "Read out the cards with SPORTident, even when the network goes down.",
      alt: "The readout view with the latest readout and a phone in the corner." },
    resultat: { title: "Results and live", text: "Results, split times and live results right away, on the computer and on the phone.",
      alt: "The public results page and the live results on a phone." },
    arkiv: { title: "The club archive", text: "The club's maps, courses and trainings collected and searchable.",
      alt: "The club archive with the club's maps and trainings." }
  }
};
