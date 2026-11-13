import type { Texts } from "../lib/language";
import type { mapWmsSv } from "./map-wms-sv";

export const mapWmsEn: Texts<typeof mapWmsSv> = {
  heading: "Orthophoto from WMS",
  help: "Fetch an aerial photo from an open WMS service, e.g. your municipality's orthophoto. Check that the service's terms allow the image to be used as a base layer for map drawing.",
  responsibility: "You are responsible for checking that the service's terms allow the use.",
  presetAttribution: "Göteborgs Stad (CC0)",
  preset: "Service",
  custom: "Own address",
  presets: { goteborg: "City of Gothenburg (CC0)" },
  url: "Address of the WMS service (https)",
  readLayers: "Read the layers",
  reading: "Reading the layers …",
  layer: "Layer",
  noSweref: "No layer in the service can be fetched in SWEREF 99 TM or the map's coordinate system.",
  resolution: "Resolution",
  resolutions: { "0.25": "0.25 m per pixel (finest)", "0.5": "0.5 m per pixel", "1": "1 m per pixel", "2": "2 m per pixel (coarsest)" },
  where: "Area",
  whole: "Whole map",
  fetch: "Fetch",
  fetching: (done: number, total: number) => total > 1 ? `Fetching image ${done} of ${total} …` : "Fetching the aerial photo …",
  name: (layer: string, area: string | undefined, tile: string | undefined, attribution: string) => {
    const tail = ` · ${attribution}`.slice(0, 50);
    return `${[layer, area, tile].filter(Boolean).join(" ")}`.slice(0, 80 - tail.length) + tail;
  },
  attribution: (title: string) => `© ${title}`,
  added: (count: number) => count === 1 ? "The aerial photo is added as a base layer. It can be interpreted under “Interpret aerial photo”." : `${count} image tiles are added as base layers. They can be interpreted under “Interpret aerial photo”.`,
  failedAfter: (added: number) => `${added} image tiles were added before something went wrong. Fetch again for the rest, or use a coarser resolution.`,
  problems: {
    WMS_NOT_HTTPS: "The address must start with https://.",
    WMS_BAD_URL: "The address cannot be used. It must be an ordinary https address without a port and without a user name.",
    WMS_PRIVATE_ADDRESS: "The address points to an internal network and cannot be fetched. Enter a public address.",
    WMS_UNREACHABLE: "The service is not responding right now. Try again in a while.",
    WMS_NOT_WMS: "The address does not answer as a WMS service. Check the address.",
    WMS_NO_LAYER: "The layer no longer exists in the service. Read the layers again.",
    WMS_NO_SWEREF: "No layer in the service can be fetched in SWEREF 99 TM (EPSG:3006) or the map's coordinate system.",
    WMS_IMAGE_TOO_LARGE: "The image is too large. Choose a coarser resolution or a stage.",
    WMS_TOO_MANY_TILES: "The area becomes too many image tiles (at most 16). Choose a coarser resolution or a stage.",
    WMS_NO_FORMAT: "The service cannot deliver JPEG or PNG.",
    WMS_NOT_IMAGE: "The service did not answer with an image for the area. Check that the layer covers the map, or choose a coarser resolution.",
    SOURCE_THROTTLED: "Too many fetches in the last hour. Try again later.",
    generic: (status: number | string) => `That did not work (${status}).`
  }
};
