import AuctionApp from "../../../room";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; view: string }>;
}) {
  const { id, view } = await params;
  return <AuctionApp auctionId={id} initialView={view} />;
}
