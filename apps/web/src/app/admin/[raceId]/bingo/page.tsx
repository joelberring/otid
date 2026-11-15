import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BingoLeader } from "../../../../components/bingo/bingo-leader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bingo – O-Tid", robots: { index: false, follow: false } };

/** Bingo med telefonen (ADR-0225): ledarens tabell och spår. Kräver inloggning som administratör (servern kontrollerar). */
export default async function Page({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(raceId)) notFound();
  return <BingoLeader raceId={raceId} />;
}
