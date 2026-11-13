import type { Metadata } from "next";
import { MapProjectJoinPage } from "../../components/map-project/map-project-join-page";

export const metadata: Metadata = { title: "Gå med i kartprojekt – O-Tid", robots: { index: false, follow: false } };

/** Länken «Skapa länk» i kartprojektets medlemmar (/kartlank#token=…). */
export default function MapProjectJoinRoute() {
  return <MapProjectJoinPage />;
}
