import type { Metadata } from "next";
import { SuperadminPage } from "../../components/superadmin/superadmin-page";

export const metadata: Metadata = { title: "Superadmin – O-Tid" };

export default function Superadmin() {
  return <SuperadminPage />;
}
