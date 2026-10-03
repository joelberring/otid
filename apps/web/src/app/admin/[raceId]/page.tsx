import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** ADR-0168: all administration sker i den gemensamma arbetsytan. */
export default async function AdminPage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = await params;
  redirect(`/admin/${raceId}/manage`);
}
