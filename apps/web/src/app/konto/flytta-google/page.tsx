import type { Metadata } from "next";
import { GoogleMovePage } from "../../../components/google-move-page";

export const metadata: Metadata = { title: "Flytta Google-kopplingen – O-Tid", robots: { index: false } };

/** ADR-0205 tillägg: bekräftelsen när Google-kontot är kopplat till ett annat, tomt konto (dubbletten). */
export default function MoveGooglePage() {
  return <GoogleMovePage />;
}
