"use client";
import { useEffect, useState } from "react";
import { api, imageUpload } from "./client-api";
import { messages } from "../../../packages/i18n/messages";
type Props = {
  auction: any;
  lang: "en" | "ml";
  refresh: () => Promise<unknown>;
  section: string;
};
export default function Management({
  auction: a,
  lang,
  refresh,
  section,
}: Props) {
  const tr = (en: string, ml: string) => (lang === "en" ? en : ml);
  const [staff, setStaff] = useState<any[]>([]),
    [metrics, setMetrics] = useState<any>(null),
    [display, setDisplay] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const text = (code: string) =>
    (messages[lang] as any)[code] ??
    tr(
      "The action could not be completed. Check the details and try again.",
      "പ്രവർത്തനം പൂർത്തിയാക്കാനായില്ല. വിവരങ്ങൾ പരിശോധിച്ച് വീണ്ടും ശ്രമിക്കുക.",
    );
  useEffect(() => {
    api(`/auctions/${a.id}/staff`)
      .then(setStaff)
      .catch(() => {});
    if (section === "operations")
      api(`/auctions/${a.id}/metrics`)
        .then(setMetrics)
        .catch((e) => setError(text(e.message)));
  }, [a.id, section, lang]);
  async function submit(path: string, body: any) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(path, body);
      await refresh();
      setNotice(tr("Saved.", "സൂക്ഷിച്ചു."));
      if (section === "staff") setStaff(await api(`/auctions/${a.id}/staff`));
      return result;
    } catch (e: any) {
      setError(text(e.message));
    } finally {
      setBusy(false);
    }
  }
  const reason = () =>
    prompt(tr("Reason for this change", "ഈ മാറ്റത്തിന്റെ കാരണം"));
  const owner = a.roles.includes("OWNER");
  return (
    <section className="card management-card">
      <h2>
        {tr(
          (
            {
              staff: "Staff and bidding operators",
              display: "Auditorium access",
              branding: "Club and team identity",
              operations: "Event health",
            } as any
          )[section] ?? "Club management",
          (
            {
              staff: "സ്റ്റാഫും ലേല ഓപ്പറേറ്റർമാരും",
              display: "പ്രദർശനത്തിനുള്ള പ്രവേശനം",
              branding: "ക്ലബ്ബിന്റെയും ടീമിന്റെയും തിരിച്ചറിയൽ",
              operations: "ലേലത്തിന്റെ പ്രവർത്തനനില",
            } as any
          )[section] ?? "ക്ലബ് നിയന്ത്രണം",
        )}
      </h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="success" role="status" hidden={!notice}>
        {notice}
      </p>
      {section === "staff" && (
        <div className="stack">
          {staff.map((s: any) => (
            <div className="team-row" key={s.user_id + s.role}>
              <div className="grow">
                <strong>{s.email}</strong>
                <span className="muted">
                  {tr(
                    (
                      {
                        OWNER: "Owner",
                        ADMIN: "Administrator",
                        AUCTIONEER: "Auctioneer",
                        MEMBER: "Member",
                      } as any
                    )[s.role],
                    (
                      {
                        OWNER: "ഉടമ",
                        ADMIN: "അഡ്മിൻ",
                        AUCTIONEER: "ലേല നിയന്ത്രകൻ",
                        MEMBER: "അംഗം",
                      } as any
                    )[s.role],
                  )}
                </span>
              </div>
              {owner && s.role !== "OWNER" && (
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => {
                    const why = reason();
                    if (
                      why &&
                      confirm(tr("Remove this permission?", "ഈ അനുമതി നീക്കണോ?"))
                    )
                      submit(`/auctions/${a.id}/staff`, {
                        userId: s.user_id,
                        role: s.role,
                        revoke: true,
                        reason: why,
                      });
                  }}
                >
                  {tr("Revoke", "പിൻവലിക്കുക")}
                </button>
              )}
            </div>
          ))}
          {owner && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await submit(`/auctions/${a.id}/staff`, {
                  email: f.get("email"),
                  role: f.get("role"),
                  reason: f.get("reason"),
                });
              }}
            >
              <h3>
                {tr("Add a verified account", "സ്ഥിരീകരിച്ച അക്കൗണ്ട് ചേർക്കുക")}
              </h3>
              <label>
                {tr("Email", "ഇമെയിൽ")}
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                {tr("Permission", "അനുമതി")}
                <select name="role">
                  <option value="ADMIN">{tr("Administrator", "അഡ്മിൻ")}</option>
                  <option value="AUCTIONEER">
                    {tr("Auctioneer", "ലേല നിയന്ത്രകൻ")}
                  </option>
                  <option value="MEMBER">{tr("Member", "അംഗം")}</option>
                </select>
              </label>
              <label>
                {tr("Reason", "കാരണം")}
                <input name="reason" required minLength={3} />
              </label>
              <button className="btn" disabled={busy}>
                {tr("Grant permission", "അനുമതി നൽകുക")}
              </button>
            </form>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                confirm(
                  tr(
                    "Transfer bidding control to this approved manager?",
                    "അംഗീകരിച്ച ഈ മാനേജർക്ക് വിളിക്കാനുള്ള നിയന്ത്രണം കൈമാറണോ?",
                  ),
                )
              )
                await submit(`/auctions/${a.id}/handover`, {
                  teamId: f.get("team"),
                  userId: f.get("user"),
                  reason: f.get("reason"),
                });
            }}
          >
            <h3>
              {tr("Hand over bidding control", "വിളിക്കാനുള്ള നിയന്ത്രണം കൈമാറുക")}
            </h3>
            <p className="muted">
              {tr(
                "Pause a live auction before handing over. The previous operator loses bidding access.",
                "കൈമാറ്റത്തിന് മുമ്പ് തത്സമയ ലേലം നിർത്തിവയ്ക്കുക. പഴയ ഓപ്പറേറ്റർക്ക് തുടർന്ന് വിളിക്കാൻ കഴിയില്ല.",
              )}
            </p>
            <label>
              {tr("Team", "ടീം")}
              <select name="team">
                {a.teams.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("Approved manager", "അംഗീകരിച്ച മാനേജർ")}
              <select name="user" required>
                {a.applications
                  .filter((m: any) => m.status === "APPROVED")
                  .map((m: any) => (
                    <option key={m.id} value={m.userId}>
                      {staff.find((s) => s.user_id === m.userId)?.email ??
                        tr("Approved manager", "അംഗീകരിച്ച മാനേജർ")}{" "}
                      · {a.teams.find((t: any) => t.id === m.teamId)?.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {tr("Reason", "കാരണം")}
              <input name="reason" required minLength={3} />
            </label>
            <button
              className="btn secondary"
              disabled={busy || a.status === "LIVE"}
            >
              {tr("Confirm handover", "കൈമാറ്റം സ്ഥിരീകരിക്കുക")}
            </button>
          </form>
        </div>
      )}
      {section === "staff" && owner && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              confirm(
                tr(
                  "Transfer club ownership? You will remain an administrator.",
                  "ക്ലബ് ഉടമസ്ഥത കൈമാറണോ? നിങ്ങൾ അഡ്മിനായി തുടരും.",
                ),
              )
            )
              await submit(`/auctions/${a.id}/ownership`, {
                userId: f.get("owner"),
                reason: f.get("reason"),
              });
          }}
        >
          <h3>{tr("Transfer club ownership", "ക്ലബ് ഉടമസ്ഥത കൈമാറുക")}</h3>
          <label>
            {tr("New owner", "പുതിയ ഉടമ")}
            <select name="owner" required>
              <option value="">
                {tr(
                  "Choose an existing club member",
                  "നിലവിലെ ക്ലബ് അംഗത്തെ തിരഞ്ഞെടുക്കുക",
                )}
              </option>
              {Array.from(
                new Map(staff.map((s) => [s.user_id, s])).values(),
              ).map((s: any) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("Reason", "കാരണം")}
            <input name="reason" required minLength={3} />
          </label>
          <button className="btn danger" disabled={busy}>
            {tr("Confirm ownership transfer", "ഉടമസ്ഥത കൈമാറ്റം സ്ഥിരീകരിക്കുക")}
          </button>
        </form>
      )}
      {section === "display" && (
        <div className="stack">
          <p className="muted">
            {tr(
              "A private display link is read-only, works for unpublished auctions, and expires after 24 hours. Rotating or revoking it immediately removes access.",
              "സ്വകാര്യ പ്രദർശന ലിങ്കിൽ കാണാൻ മാത്രമേ കഴിയൂ. പ്രസിദ്ധീകരിക്കാത്ത ലേലങ്ങൾക്കും ഇത് ഉപയോഗിക്കാം. 24 മണിക്കൂറിന് ശേഷം കാലാവധി അവസാനിക്കും. ലിങ്ക് മാറ്റുകയോ പിൻവലിക്കുകയോ ചെയ്താൽ പ്രവേശനം അവസാനിക്കും.",
            )}
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              const result = await submit(`/auctions/${a.id}/display`, {});
              if (result)
                setDisplay(`${location.origin}/display/${result.token}`);
            }}
          >
            {tr(
              "Create or rotate display link",
              "പ്രദർശന ലിങ്ക് സൃഷ്ടിക്കുക അല്ലെങ്കിൽ മാറ്റുക",
            )}
          </button>
          {display && (
            <a
              className="display-secret"
              href={display}
              target="_blank"
              rel="noreferrer"
            >
              {tr("Open private display", "സ്വകാര്യ പ്രദർശനം തുറക്കുക")} ↗
            </a>
          )}
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              if (
                confirm(
                  tr(
                    "Revoke all private display links?",
                    "എല്ലാ സ്വകാര്യ പ്രദർശന ലിങ്കുകളും പിൻവലിക്കണോ?",
                  ),
                )
              ) {
                await submit(`/auctions/${a.id}/display/revoke`, {});
                setDisplay("");
              }
            }}
          >
            {tr("Revoke display access", "പ്രദർശന പ്രവേശനം പിൻവലിക്കുക")}
          </button>
        </div>
      )}
      {section === "branding" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const body: any = {};
              if (f.get("team")) body.teamId = f.get("team");
              if (f.get("name")) body.name = f.get("name");
              if (f.get("code") && body.teamId) body.code = f.get("code");
              body.color = f.get("color");
              const photo = f.get("logo") as File;
              if (photo?.size) {
                setBusy(true);
                body.logoKey = (await imageUpload(photo)).key;
                setBusy(false);
              }
              await submit(`/auctions/${a.id}/branding`, body);
            } catch (e: any) {
              setBusy(false);
              setError(text(e.message));
            }
          }}
        >
          <label>
            {tr("Club or team", "ക്ലബ് അല്ലെങ്കിൽ ടീം")}
            <select name="team">
              <option value="">{a.clubName}</option>
              {a.teams.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("New name (optional)", "പുതിയ പേര് (നിർബന്ധമില്ല)")}
            <input name="name" maxLength={200} />
          </label>
          <label>
            {tr("Team short code (optional)", "ടീമിന്റെ ചുരുക്കപ്പേര് (നിർബന്ധമില്ല)")}
            <input name="code" pattern="[A-Z0-9]{2,5}" maxLength={5} />
          </label>
          <label>
            {tr("Colour", "നിറം")}
            <input name="color" type="color" defaultValue="#0759d3" />
          </label>
          <label>
            {tr("Logo · up to 5 MB", "ലോഗോ · 5 MB വരെ")}
            <input
              name="logo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />
          </label>
          <button
            className="btn"
            disabled={
              busy ||
              !["DRAFT", "REGISTRATION_OPEN", "READY"].includes(a.status)
            }
          >
            {tr("Save identity", "തിരിച്ചറിയൽ സൂക്ഷിക്കുക")}
          </button>
        </form>
      )}
      {section === "operations" && (
        <div className="stack">
          {metrics && (
            <>
              <dl className="rule-list">
                <div>
                  <dt>{tr("Accepted bids", "അംഗീകരിച്ച വിളികൾ")}</dt>
                  <dd>{metrics.acceptedBids}</dd>
                </div>
                <div>
                  <dt>
                    {tr("Updates waiting for delivery", "അയയ്ക്കാനുള്ള അപ്ഡേറ്റുകൾ")}
                  </dt>
                  <dd>{metrics.pendingOutbox}</dd>
                </div>
                <div>
                  <dt>
                    {tr(
                      "Oldest pending update (seconds)",
                      "പഴയ അപ്ഡേറ്റിന്റെ കാത്തിരിപ്പ് (സെക്കൻഡ്)",
                    )}
                  </dt>
                  <dd>{Math.round(metrics.oldestOutboxSeconds)}</dd>
                </div>
              </dl>
              {metrics.alerts.map((alert: any, i: number) => (
                <p className="error" role="alert" key={i}>
                  {tr(
                    "An event update is delayed. Refresh the room and check server connectivity.",
                    "ലേലത്തിന്റെ അപ്ഡേറ്റ് വൈകുന്നു. മുറി പുതുക്കി സെർവറിന്റെ ബന്ധം പരിശോധിക്കുക.",
                  )}
                </p>
              ))}
            </>
          )}
          <button
            className="btn secondary"
            disabled={busy}
            onClick={async () => {
              setMetrics(await api(`/auctions/${a.id}/metrics`));
            }}
          >
            {tr("Refresh health", "പ്രവർത്തനനില പുതുക്കുക")}
          </button>
        </div>
      )}
    </section>
  );
}
