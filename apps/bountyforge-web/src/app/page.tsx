import { redirect } from "next/navigation";
import LandingPage from "@/components/LandingPage";

export default async function Page({ searchParams }: { searchParams: Promise<{ bounty?: string | string[] }> }) {
  const query = await searchParams;
  const bounty = Array.isArray(query.bounty) ? query.bounty[0] : query.bounty;
  if (bounty && /^bf-[1-9]\d{0,19}$/.test(bounty)) redirect("/bounties/" + bounty);
  return <LandingPage />;
}
