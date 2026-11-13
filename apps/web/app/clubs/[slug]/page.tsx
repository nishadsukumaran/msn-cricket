import Link from "next/link";
import { notFound } from "next/navigation";
export default async function Club({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) notFound();
  const response = await fetch(
    `${process.env.API_URL ?? "http://127.0.0.1:4018"}/api/clubs/${slug}/public`,
    { cache: "no-store" },
  );
  if (!response.ok) notFound();
  const club = await response.json();
  return (
    <main className="landing">
      <header className="landing-head">
        <Link href="/">MSN Cricket</Link>
        <a href="/api/auth/start">Sign in · പ്രവേശിക്കുക</a>
      </header>
      <section className="club-public">
        <p className="eyebrow">KERALA / CLUB CRICKET</p>
        {club.logoAuctionId && (
          <img
            className="public-club-logo"
            alt=""
            src={`/api/auctions/${club.logoAuctionId}/asset`}
          />
        )}
        <h1>{club.name}</h1>
        {club.auctions.map((a: any) => (
          <article className="card" key={a.id}>
            <h2>{a.name}</h2>
            <p className="muted">
              {a.scheduledAt
                ? new Date(a.scheduledAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  }) + " IST"
                : ""}
            </p>
            <div className="action-grid">
              <Link className="btn" href={`/auctions/${a.id}/register`}>
                Register as player · കളിക്കാരനായി രജിസ്റ്റർ ചെയ്യുക
              </Link>
              <Link
                className="btn secondary"
                href={`/auctions/${a.id}/join-team`}
              >
                Apply as manager · മാനേജരായി അപേക്ഷിക്കുക
              </Link>
              <Link className="btn secondary" href={`/display/${a.id}`}>
                Live display · തത്സമയ പ്രദർശനം
              </Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
