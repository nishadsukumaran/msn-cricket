"use client";
import { useEffect, useState } from "react";
import { api } from "./client-api";
import { messages } from "../../../packages/i18n/messages";
export default function PlatformConsole({ lang }: { lang: "en" | "ml" }) {
  const tr = (en: string, ml: string) => (lang === "en" ? en : ml);
  const [visibleClubs, setVisibleClubs] = useState(20);
  const [visibleRows, setVisibleRows] = useState(20);
  const [data, setData] = useState<any>(null),
    [requests, setRequests] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(await api("/platform/overview"));
    setRequests(await api("/platform/requests"));
  }
  useEffect(() => {
    load().catch(() =>
      setError(tr("Platform access is required.", "പ്ലാറ്റ്ഫോം അനുമതി ആവശ്യമാണ്.")),
    );
  }, []);
  async function act(path: string, body: any) {
    setBusy(true);
    setError("");
    try {
      await api(path, body);
      await load();
    } catch (e: any) {
      setError(
        (messages[lang] as any)[e.message] ??
          tr(
            "Check the details and try again.",
            "വിവരങ്ങൾ പരിശോധിച്ച് വീണ്ടും ശ്രമിക്കുക.",
          ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="card">
        <h2>{tr("Platform console", "പ്ലാറ്റ്ഫോം നിയന്ത്രണം")}</h2>
        <p role="status">{error || tr("Loading…", "ലോഡ് ചെയ്യുന്നു…")}</p>
      </section>
    );
  return (
    <div className="stack">
      <section className="card">
        <h2>{tr("Platform console", "പ്ലാറ്റ്ഫോം നിയന്ത്രണം")}</h2>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p>
          {tr("Pending event deliveries", "അയയ്ക്കാനുള്ള ലേല അറിയിപ്പുകൾ")}:{" "}
          {data.pendingOutbox}
        </p>
        <dl className="rule-list">
          <div>
            <dt>
              {tr("Requests since API start", "API ആരംഭിച്ചശേഷമുള്ള അഭ്യർത്ഥനകൾ")}
            </dt>
            <dd>{data.apiMetrics?.requests ?? 0}</dd>
          </div>
          <div>
            <dt>
              {tr("Accepted / rejected bids", "അംഗീകരിച്ച / നിരസിച്ച വിളികൾ")}
            </dt>
            <dd>
              {data.apiMetrics?.acceptedBids ?? 0} /{" "}
              {data.apiMetrics?.rejectedBids ?? 0}
            </dd>
          </div>
          <div>
            <dt>
              {tr(
                "p95 response-time bucket (ms)",
                "p95 പ്രതികരണ സമയപരിധി (മില്ലിസെക്കൻഡ്)",
              )}
            </dt>
            <dd>{data.apiMetrics?.p95UpperMs ?? "—"}</dd>
          </div>
        </dl>
        <div className="action-grid">
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => act("/platform/reconcile", {})}
          >
            {tr(
              "Reconcile provider payments",
              "പണമടയ്ക്കൽ സേവനത്തിന്റെ കണക്ക് പരിശോധിക്കുക",
            )}
          </button>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => act("/platform/maintenance", {})}
          >
            {tr("Run configured maintenance", "ക്രമീകരിച്ച പരിപാലനം നടത്തുക")}
          </button>
        </div>
      </section>
      <section className="card">
        <h3>{tr("Clubs", "ക്ലബ്ബുകൾ")}</h3>
        {data.clubs.slice(0, visibleClubs).map((c: any) => (
          <div key={c.id} className="approval">
            <strong>{c.name}</strong>
            <span className="muted">
              {c.status === "ACTIVE"
                ? tr("Active", "സജീവം")
                : tr("Suspended", "താൽക്കാലികമായി നിർത്തി")}
            </span>
            <div className="action-grid">
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => {
                  const reason = prompt(
                    tr(
                      "Support access reason (15 minutes)",
                      "സഹായ പ്രവേശനത്തിന്റെ കാരണം (15 മിനിറ്റ്)",
                    ),
                  );
                  if (reason)
                    act("/platform/support", {
                      clubId: c.id,
                      reason,
                      minutes: 15,
                    });
                }}
              >
                {tr(
                  "Start audited support access",
                  "ഓഡിറ്റോടെ സഹായ പ്രവേശനം ആരംഭിക്കുക",
                )}
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  const reason = prompt(
                    tr(
                      "Reason for suspension or reactivation",
                      "നിർത്തിവയ്ക്കാനോ പുനരാരംഭിക്കാനോ ഉള്ള കാരണം",
                    ),
                  );
                  if (
                    reason &&
                    confirm(
                      tr(
                        "Change club access? Live auctions will pause when suspended.",
                        "ക്ലബ് പ്രവേശനം മാറ്റണോ? നിർത്തിവയ്ക്കുമ്പോൾ തത്സമയ ലേലങ്ങൾ നിർത്തും.",
                      ),
                    )
                  )
                    act("/platform/suspend", {
                      clubId: c.id,
                      suspended: c.status === "ACTIVE",
                      reason,
                    });
                }}
              >
                {c.status === "ACTIVE"
                  ? tr("Suspend club", "ക്ലബ് നിർത്തിവയ്ക്കുക")
                  : tr("Reactivate club", "ക്ലബ് പുനരാരംഭിക്കുക")}
              </button>
            </div>
          </div>
        ))}
      </section>
      {data.clubs.length > visibleClubs && (
        <button
          className="btn secondary"
          onClick={() => setVisibleClubs((n) => n + 20)}
        >
          {tr("Show more clubs", "കൂടുതൽ ക്ലബ്ബുകൾ കാണിക്കുക")}
        </button>
      )}
      <section className="card">
        <h3>{tr("Manual license requests", "മാനുവൽ ലൈസൻസ് അപേക്ഷകൾ")}</h3>
        {requests.slice(0, visibleRows).map((r) => (
          <div className="approval" key={r.id}>
            <strong>
              {r.clubName} · {r.units}
            </strong>
            <p className="muted">
              {r.reference} · {(messages[lang] as any)[r.status] ?? r.status}
            </p>
            {r.status === "PENDING" && (
              <div className="action-grid">
                {["APPROVED", "REJECTED"].map((status) => (
                  <button
                    className="btn secondary"
                    key={status}
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt(
                        tr(
                          "Verified purchase or review reason",
                          "സ്ഥിരീകരിച്ച വാങ്ങലിന്റെ അല്ലെങ്കിൽ പരിശോധനയുടെ കാരണം",
                        ),
                      );
                      if (reason)
                        act("/platform/credit-review", {
                          id: r.id,
                          clubId: r.clubId,
                          status,
                          reason,
                        });
                    }}
                  >
                    {status === "APPROVED"
                      ? tr(
                          "Approve and grant credits",
                          "അംഗീകരിച്ച് ക്രെഡിറ്റുകൾ നൽകുക",
                        )
                      : tr("Reject", "നിരസിക്കുക")}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
      <section className="card">
        <h3>{tr("Credit catalog", "ക്രെഡിറ്റ് പട്ടിക")}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act("/platform/products", {
              sku: f.get("sku"),
              units: Number(f.get("units")),
              amountMinor: Number(f.get("amount")),
              currency: f.get("currency"),
              validityDays: f.get("validity")
                ? Number(f.get("validity"))
                : null,
              active: f.get("active") === "on",
            });
          }}
        >
          <div className="form-grid">
            <label>
              {tr("Product code", "ഉൽപ്പന്ന കോഡ്")}
              <input name="sku" pattern="[A-Z0-9_-]{2,80}" required />
            </label>
            <label>
              {tr("Auction credits", "ലേല ക്രെഡിറ്റുകൾ")}
              <input
                name="units"
                type="number"
                min="1"
                max="1000"
                required
                inputMode="numeric"
              />
            </label>
            <label>
              {tr(
                "Price in minor currency units (paise for INR)",
                "ചെറിയ കറൻസി യൂണിറ്റിൽ വില (INR-ന് പൈസ)",
              )}
              <input
                name="amount"
                type="number"
                min="0"
                step="1"
                required
                inputMode="numeric"
              />
            </label>
            <label>
              {tr("Currency", "കറൻസി")}
              <input
                name="currency"
                pattern="[A-Z]{3}"
                defaultValue="INR"
                required
              />
            </label>
            <label>
              {tr("Validity in days (optional)", "സാധുത ദിവസങ്ങളിൽ (നിർബന്ധമില്ല)")}
              <input
                name="validity"
                type="number"
                min="1"
                inputMode="numeric"
              />
            </label>
          </div>
          <label className="check">
            <input name="active" type="checkbox" defaultChecked />
            {tr("Available for purchase", "വാങ്ങാൻ ലഭ്യമാണ്")}
          </label>
          <button className="btn" disabled={busy}>
            {tr("Save product", "ഉൽപ്പന്നം സൂക്ഷിക്കുക")}
          </button>
        </form>
      </section>
      <section className="card">
        <h3>{tr("Credit grants", "നൽകിയ ക്രെഡിറ്റുകൾ")}</h3>
        {data.grants?.slice(0, visibleRows).map((g: any) => (
          <div className="approval" key={g.id}>
            <strong>{g.clubName}</strong>
            <p>
              {g.units - g.used} / {g.units} {tr("unused", "ഉപയോഗിക്കാത്തത്")}
            </p>
            <p className="muted">{g.reason}</p>
            {!g.revoked && g.units > g.used && (
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  const reason = prompt(
                    tr(
                      "Reason for revoking unused credits",
                      "ഉപയോഗിക്കാത്ത ക്രെഡിറ്റുകൾ പിൻവലിക്കുന്നതിന്റെ കാരണം",
                    ),
                  );
                  if (
                    reason &&
                    confirm(
                      tr(
                        "Revoke unused units? Existing auction redemptions remain.",
                        "ഉപയോഗിക്കാത്ത ക്രെഡിറ്റുകൾ പിൻവലിക്കണോ? നിലവിലെ ലേലങ്ങൾക്കുള്ള ഉപയോഗം തുടരും.",
                      ),
                    )
                  )
                    act("/platform/credit-revoke", {
                      clubId: g.clubId,
                      grantId: g.id,
                      reason,
                    });
                }}
              >
                {tr("Revoke unused credits", "ഉപയോഗിക്കാത്ത ക്രെഡിറ്റുകൾ പിൻവലിക്കുക")}
              </button>
            )}
          </div>
        ))}
      </section>
      <section className="card">
        <h3>{tr("Maintenance history", "പരിപാലന ചരിത്രം")}</h3>
        {data.jobs.map((j: any) => (
          <div className="event" key={j.id}>
            <div>
              <strong>
                {j.status === "SUCCEEDED"
                  ? tr("Completed", "പൂർത്തിയായി")
                  : j.status === "FAILED"
                    ? tr("Needs attention", "പരിശോധന ആവശ്യമാണ്")
                    : tr("Running", "നടക്കുന്നു")}
              </strong>
              <p className="muted">
                {new Date(j.started_at).toLocaleString(
                  lang === "en" ? "en-IN" : "ml-IN",
                  { timeZone: "Asia/Kolkata" },
                )}{" "}
                IST
              </p>
            </div>
          </div>
        ))}
      </section>
      <section className="card">
        <h3>{tr("Payments", "പണമടയ്ക്കലുകൾ")}</h3>
        {data.orders.slice(0, visibleRows).map((o: any) => (
          <div className="event" key={o.id}>
            <div>
              <strong>
                {new Intl.NumberFormat(lang === "en" ? "en-IN" : "ml-IN", {
                  style: "currency",
                  currency: o.currency,
                }).format(o.amountMinor / 100)}
              </strong>
              <p className="muted">
                {o.reference ??
                  tr(
                    "Awaiting provider order",
                    "സേവനത്തിന്റെ ഓർഡർ കാത്തിരിക്കുന്നു",
                  )}{" "}
                · {(messages[lang] as any)[o.status] ?? o.status}
              </p>
            </div>
          </div>
        ))}
      </section>
      <section className="card">
        <h3>{tr("Operational alerts", "പ്രവർത്തന മുന്നറിയിപ്പുകൾ")}</h3>
        {!data.alerts.length && (
          <p className="success">
            {tr("No unresolved alerts.", "പരിഹരിക്കാത്ത മുന്നറിയിപ്പുകളില്ല.")}
          </p>
        )}
        {data.alerts.slice(0, visibleRows).map((a: any) => (
          <div className="approval" key={a.id}>
            <p className="error">
              {a.kind === "BILLING_EXCEPTION"
                ? tr(
                    "A refund needs review because credits were consumed or the refund was partial.",
                    "ക്രെഡിറ്റുകൾ ഉപയോഗിച്ചതിനാലോ ഭാഗിക റീഫണ്ടായതിനാലോ പരിശോധന ആവശ്യമാണ്.",
                  )
                : tr(
                    "Event delivery is delayed. Check the API and worker.",
                    "ലേല അറിയിപ്പുകൾ വൈകുന്നു. API-യും വർക്കറും പരിശോധിക്കുക.",
                  )}
            </p>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => act(`/platform/alerts/${a.id}/resolve`, {})}
            >
              {tr("Mark resolved", "പരിഹരിച്ചതായി രേഖപ്പെടുത്തുക")}
            </button>
          </div>
        ))}
      </section>
      {Math.max(
        data.orders.length,
        data.grants?.length ?? 0,
        requests.length,
        data.alerts.length,
      ) > visibleRows && (
        <button
          className="btn secondary"
          onClick={() => setVisibleRows((n) => n + 20)}
        >
          {tr("Show more records", "കൂടുതൽ രേഖകൾ കാണിക്കുക")}
        </button>
      )}
    </div>
  );
}
