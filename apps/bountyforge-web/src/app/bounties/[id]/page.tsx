import BountyForgeApp from "@/components/BountyForgeApp";

export default async function BountyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BountyForgeApp view="bounty" bountyId={id} />;
}
