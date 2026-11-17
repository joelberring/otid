import type { Texts } from "../lib/language";
import type { lantmaterietSv } from "./lantmateriet-sv";

/** English: the connection to Lantmäteriet (same keys as `lantmateriet-sv.ts`). Product names are Lantmäteriet's own, in Swedish. */
export const lantmaterietEn: Texts<typeof lantmaterietSv> = {
  howTo: "How to connect Lantmäteriet",
  account: "My account",
  needs: "The laser data for the base map is fetched from Lantmäteriet with your own account there.",
  status: {
    connected: "Lantmäteriet: connected. The credentials are tried the first time you fetch.",
    missing: "Lantmäteriet: not connected yet.",
    unreadable: "Lantmäteriet: the credentials need to be saved again.",
    server: "Lantmäteriet: cannot be connected on this installation."
  },
  problems: {
    missing: "Lantmäteriet is not connected yet: your O-Tid account has no credentials for Lantmäteriet. Enter them under My account, reload this page and try again.",
    unreadable: "The credentials for Lantmäteriet can no longer be used, because the server's key has changed since they were saved. Save them again under My account and try again.",
    server: "This installation of O-Tid cannot store credentials for Lantmäteriet. Contact whoever runs O-Tid. Meanwhile OpenStreetMap and your own files can be used.",
    rejected: {
      laser: "Lantmäteriet refused the fetch. Either the credentials are wrong, or Laserdata Nedladdning, skog is not ordered for your account on Geotorget; "
        + "O-Tid cannot tell which. Check both and try again.",
      ortho: "Lantmäteriet refused the fetch. Either the credentials are wrong, or the product is not ordered for your account on Geotorget: Ortofoto Nedladdning, "
        + "or for older images Ortofoto historiska Nedladdning. O-Tid cannot tell which. Check and try again."
    }
  },
  products: {
    heading: "Products to order on Geotorget",
    help: "Each product is ordered separately. Only the laser data is needed to make a first map with the guide.",
    columns: { product: "Product", use: "Used for", first: "First map" },
    needed: "Needed",
    optional: "Optional",
    rows: [
      { product: "Laserdata Nedladdning, skog", use: "The base map in the guide: contours, cliffs, marshes and green.", first: true },
      { product: "Ortofoto Nedladdning", use: "Aerial photos to draw from (Orthophoto from Lantmäteriet).", first: false },
      { product: "Ortofoto historiska Nedladdning", use: "Older aerial photos; a product of its own.", first: false },
      { product: "Marktäcke, Byggnad och Fastighetsindelning", use: "Read with the laser data when the account has them: land, houses and plots.", first: false }
    ]
  }
};
