"use client";
import { useEffect, useState } from "react";
import { api, imageUpload } from "./client-api";
import { messages } from "../../../packages/i18n/messages";
export default function ProfileEditor({
  lang,
  auctionId,
  onSaved,
}: {
  lang: "en" | "ml";
  auctionId?: string;
  onSaved?: () => void;
}) {
  const tr = (en: string, ml: string) => (lang === "en" ? en : ml);
  const [profile, setProfile] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    api("/profile")
      .then(setProfile)
      .catch(() => {});
  }, []);
  return (
    <section className="card form-card">
      <h2>{tr("Your player profile", "നിങ്ങളുടെ കളിക്കാരന്റെ വിവരങ്ങൾ")}</h2>
      <p className="muted">
        {tr(
          "Reuse this profile across club auctions. Editing it does not rewrite submitted auction snapshots.",
          "ഈ വിവരങ്ങൾ മറ്റു ക്ലബ്ബുകളുടെ ലേലങ്ങളിലും ഉപയോഗിക്കാം. മാറ്റങ്ങൾ മുമ്പ് സമർപ്പിച്ച ലേലവിവരങ്ങളെ ബാധിക്കില്ല.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p role="status" className="success" hidden={!saved}>
        {tr("Profile saved.", "വിവരങ്ങൾ സൂക്ഷിച്ചു.")}
      </p>
      <form
        key={profile?.id ?? "new"}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setSaved(false);
          try {
            const f = new FormData(e.currentTarget);
            const body: any = {};
            for (const k of [
              "name",
              "birthDate",
              "phone",
              "location",
              "role",
              "battingStyle",
              "bowlingStyle",
            ])
              body[k] = f.get(k);
            const photo = f.get("photo") as File;
            if (photo?.size) body.photoKey = (await imageUpload(photo)).key;
            else if (profile?.photoKey) body.photoKey = profile.photoKey;
            await api("/profile", body);
            setProfile(await api("/profile"));
            setSaved(true);
            onSaved?.();
          } catch (e: any) {
            setError(
              (messages[lang] as any)[e.message] ??
                tr(
                  "Check the profile details and try again.",
                  "വിവരങ്ങൾ പരിശോധിച്ച് വീണ്ടും ശ്രമിക്കുക.",
                ),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {[
            "name",
            "birthDate",
            "phone",
            "location",
            "battingStyle",
            "bowlingStyle",
          ].map((k) => (
            <label key={k}>
              {(messages[lang] as any)[k]}
              <input
                name={k}
                defaultValue={profile?.[k] ?? ""}
                type={
                  k === "birthDate" ? "date" : k === "phone" ? "tel" : "text"
                }
                autoComplete={
                  k === "name"
                    ? "name"
                    : k === "phone"
                      ? "tel"
                      : k === "birthDate"
                        ? "bday"
                        : "off"
                }
                required
                maxLength={200}
              />
            </label>
          ))}
          <label>
            {messages[lang].role}
            <select name="role" defaultValue={profile?.role ?? "BATTER"}>
              {["BATTER", "BOWLER", "ALL_ROUNDER", "KEEPER"].map((r) => (
                <option key={r} value={r}>
                  {(messages[lang] as any)[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("Player photo", "കളിക്കാരന്റെ ചിത്രം")}
            <input
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />
          </label>
        </div>
        {profile?.photoKey && (
          <img
            src="/api/profile/photo"
            alt={tr("Your saved player photo", "നിങ്ങളുടെ ചിത്രം")}
            className="profile-preview"
          />
        )}
        <button className="btn" disabled={busy}>
          {busy
            ? messages[lang].confirming
            : tr("Save reusable profile", "വിവരങ്ങൾ സൂക്ഷിക്കുക")}
        </button>
      </form>
      {auctionId && (
        <button
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            if (
              confirm(
                tr(
                  "Withdraw your registration from this auction?",
                  "ഈ ലേലത്തിൽ നിന്ന് രജിസ്ട്രേഷൻ പിൻവലിക്കണോ?",
                ),
              )
            ) {
              setBusy(true);
              try {
                await api(`/auctions/${auctionId}/withdraw`, {});
                setSaved(true);
                onSaved?.();
              } catch (e: any) {
                setError(
                  (messages[lang] as any)[e.message] ??
                    tr(
                      "Withdrawal is unavailable after bidding has opened.",
                      "വിളി ആരംഭിച്ചശേഷം പിൻവലിക്കാൻ കഴിയില്ല.",
                    ),
                );
              } finally {
                setBusy(false);
              }
            }
          }}
        >
          {tr("Withdraw from this auction", "ഈ ലേലത്തിൽ നിന്ന് പിൻവലിക്കുക")}
        </button>
      )}
      <button
        className="btn danger"
        disabled={busy}
        onClick={async () => {
          if (
            confirm(
              tr(
                "Anonymize your player records and close this account? Accounting records are retained.",
                "കളിക്കാരന്റെ വിവരങ്ങൾ അജ്ഞാതമാക്കി അക്കൗണ്ട് അടയ്ക്കണോ? കണക്കുകൾ സൂക്ഷിക്കും.",
              ),
            )
          ) {
            setBusy(true);
            try {
              await api("/profile/erase", { confirm: true });
              location.href = "/";
            } catch (e: any) {
              setError(
                (messages[lang] as any)[e.message] ??
                  tr(
                    "Finish active events or transfer club ownership before deleting your account.",
                    "അക്കൗണ്ട് നീക്കുന്നതിനുമുമ്പ് സജീവ ലേലങ്ങൾ പൂർത്തിയാക്കുക അല്ലെങ്കിൽ ക്ലബ് ഉടമസ്ഥത കൈമാറുക.",
                  ),
              );
            } finally {
              setBusy(false);
            }
          }
        }}
      >
        {tr("Delete my account", "എന്റെ അക്കൗണ്ട് നീക്കുക")}
      </button>
    </section>
  );
}
