"use client";
import PlatformConsole from "./platform-console";
import Management from "./management";
import ProfileEditor from "./profile-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { messages } from "../../../packages/i18n/messages";
type Lang = "en" | "ml";
type Data = any;
async function request(path: string, body?: unknown) {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.code ?? "INTERNAL_ERROR");
  return data;
}
const fmt = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN").format(n ?? 0);
function Crest({ small = false }: { small?: boolean }) {
  return (
    <span className={"crest " + (small ? "small" : "")} aria-hidden="true">
      <span>MSN</span>
      <i>✦</i>
    </span>
  );
}
function Jersey({ number = "07" }: { number?: string }) {
  return (
    <svg className="jersey" viewBox="0 0 240 240" aria-hidden="true">
      <defs>
        <linearGradient id="kit" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#1978f0" />
          <stop offset="1" stopColor="#0643a7" />
        </linearGradient>
      </defs>
      <ellipse cx="123" cy="225" rx="68" ry="8" fill="#10254b" opacity=".12" />
      <path
        d="M86 30 47 49 18 101 55 122 71 99 69 207Q120 224 171 207L169 99 185 122 222 101 193 49 154 30Q120 53 86 30Z"
        fill="url(#kit)"
      />
      <path d="m86 30 34 28 34-28-7-6h-54Z" fill="#ff8637" />
      <path d="m47 49 22 53-14 20-37-21Z" fill="#0950bd" />
      <path d="m193 49-22 53 14 20 37-21Z" fill="#0950bd" />
      <path d="M71 173h98v8H71Z" fill="#ff8637" opacity=".9" />
      <text
        x="120"
        y="90"
        textAnchor="middle"
        fill="white"
        fontFamily="sans-serif"
        fontSize="13"
        fontWeight="700"
      >
        MALABAR
      </text>
      <text
        x="120"
        y="151"
        textAnchor="middle"
        fill="white"
        fontFamily="sans-serif"
        fontSize="54"
        fontWeight="800"
      >
        {number}
      </text>
      <path
        d="m82 43-8 147M158 43l8 147"
        stroke="white"
        opacity=".14"
        fill="none"
      />
    </svg>
  );
}
function ActionButton({
  children,
  onClick,
  secondary = false,
  danger = false,
  disabled = false,
  pending = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn ${secondary ? "secondary" : ""} ${danger ? "danger" : ""}`}
      onClick={onClick}
      disabled={disabled || pending}
    >
      {children}
    </button>
  );
}
export default function AuctionApp({
  auctionId,
  initialView = "overview",
}: {
  auctionId?: string;
  initialView?: string;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const t = (key: string): string =>
    (messages[lang] as any)[key] ?? messages[lang].error;
  const [id, setId] = useState(auctionId ?? "");
  const [view, setView] = useState(initialView);
  const [data, setData] = useState<Data>(null);
  const [config, setConfig] = useState<Data>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [synced, setSynced] = useState(false);
  const [activity, setActivity] = useState<Data[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [uncertain, setUncertain] = useState<Data>(null);
  const [myStatus, setMyStatus] = useState<Data>(null);
  const [report, setReport] = useState<Data>(null);
  const [invite, setInvite] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState("");
  const [savedProfile, setSavedProfile] = useState<Data>(null),
    [billing, setBilling] = useState<Data>(null);
  const [user, setUser] = useState<Data>(null);
  const [products, setProducts] = useState<Data[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const sequence = useRef(0);
  const mutating = useRef(false);
  const currentId = useRef(id);
  currentId.current = id;
  const projection = view === "projection";
  const isAdmin = data?.roles?.some((r: string) =>
    ["OWNER", "ADMIN"].includes(r),
  );
  const isAuctioneer = isAdmin || data?.roles?.includes("AUCTIONEER");
  const load = useCallback(async (target: string, publicMode = false) => {
    let snapshot;
    try {
      snapshot = await request(
        publicMode && /^[a-f0-9]{64}$/.test(target)
          ? `/display/${target}`
          : `/auctions/${target}/${publicMode ? "public" : "snapshot"}`,
      );
    } catch (error: any) {
      if (
        !publicMode &&
        ["UNAUTHENTICATED", "FORBIDDEN"].includes(error.message)
      )
        snapshot = {
          ...(await request(`/auctions/${target}/public`)),
          roles: [],
          applications: [],
          readiness: [],
          grants: [],
          publicOnly: true,
        };
      else throw error;
    }
    if (currentId.current !== target) return;
    setData((old: Data) =>
      !old || old.id !== snapshot.id || snapshot.sequence >= old.sequence
        ? snapshot
        : old,
    );
    sequence.current = snapshot.sequence;
    if (!publicMode && !snapshot.publicOnly) {
      const events = await request(
        `/auctions/${target}/events?after=${Math.max(0, snapshot.sequence - 12)}`,
      );
      setActivity(events.slice(-8).reverse());
    }
    return snapshot;
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem("msn-language");
    if (saved === "en" || saved === "ml") setLang(saved);
    request("/auth/config")
      .then(setConfig)
      .catch(() => setError("error"));
    request("/me")
      .then(setUser)
      .catch(() => {});
    if (auctionId) return;
    request("/auctions")
      .then((list) => {
        if (list.length) setId(list[0].id);
      })
      .catch(() => {});
  }, [auctionId]);
  useEffect(() => {
    if (view === "billing")
      request("/billing/products").then(setProducts).catch(showError);
  }, [view]);
  useEffect(() => {
    if (view === "register")
      request("/profile")
        .then((p) => {
          setSavedProfile(p);
          if (p?.photoKey) setPhotoKey(p.photoKey);
        })
        .catch(() => {});
    if (view === "billing" && id)
      request(`/auctions/${id}/billing`)
        .then(setBilling)
        .catch(() => {});
  }, [view, id]);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem("msn-language", lang);
  }, [lang]);
  useEffect(() => {
    if (!id) return;
    setSynced(false);
    let active = true;
    if (projection) {
      load(id, true)
        .then(() => {
          if (active) setSynced(true);
        })
        .catch(() => setError("error"));
      const poll = setInterval(
        () =>
          load(id, true)
            .then(() => {
              if (active) setSynced(true);
            })
            .catch((e: Error) => {
              setSynced(false);
              if (e.message === "NOT_FOUND") {
                setData(null);
                setError("DISPLAY_UNAVAILABLE");
              }
            }),
        1500,
      );
      return () => {
        active = false;
        clearInterval(poll);
      };
    }
    load(id).catch((e: Error) => setError(e.message));
    const socket = io({
      path: "/socket.io",
      transports: ["polling"],
      withCredentials: true,
      reconnection: true,
    });
    socketRef.current = socket;
    const subscribe = () => {
      setSynced(false);
      socket
        .timeout(5000)
        .emit(
          "subscribe",
          { auctionId: id },
          async (err: Error, response: Data) => {
            if (err || !response?.ok) {
              setSynced(false);
              return;
            }
            try {
              await load(id);
              if (active && socket.connected && navigator.onLine)
                setSynced(true);
            } catch (e: any) {
              setError(e.message);
            }
          },
        );
    };
    socket.on("connect", subscribe);
    socket.on("disconnect", () => setSynced(false));
    socket.on("connect_error", () => setSynced(false));
    socket.on("committed", async (event: Data) => {
      if (event.sequence <= sequence.current) return;
      setSynced(false);
      try {
        await load(id);
        if (active && socket.connected) setSynced(true);
      } catch {
        setSynced(false);
      }
    });
    const offline = () => {
      setSynced(false);
      socket.disconnect();
    };
    const online = () => {
      setSynced(false);
      socket.connect();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    const visibility = () => {
      setSynced(false);
      if (document.visibilityState === "visible") {
        if (socket.connected) subscribe();
        else socket.connect();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      socket.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [id, projection, load]);
  useEffect(() => {
    if (!id || !uncertain) return;
    const timer = setInterval(async () => {
      try {
        await request("/commands/" + uncertain.commandId);
        setUncertain(null);
        setPending(false);
        mutating.current = false;
        await load(id);
      } catch {
        /* The original command may still be in flight. */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [uncertain, id, load]);
  const showError = (e: any) => {
    setError(e.message?.split(":")[0] ?? "error");
  };
  async function login(role: string) {
    setLoginBusy(true);
    setError("");
    try {
      const result = await request("/auth/rehearsal", { role });
      setUser(await request("/me"));
      if (id === result.auctionId) await load(id);
      setId(result.auctionId);
      socketRef.current?.disconnect();
      socketRef.current?.connect();
      setView("overview");
    } catch (e) {
      showError(e);
    } finally {
      setLoginBusy(false);
    }
  }
  async function send(type: string, extra: Data = {}, confirmAction = false) {
    if (mutating.current || uncertain) return;
    if (confirmAction && !window.confirm(t("confirm"))) return;
    mutating.current = true;
    setPending(true);
    setError("");
    setNotice("");
    const command = { commandId: crypto.randomUUID(), type, ...extra };
    try {
      await request(`/auctions/${id}/commands`, command);
      await load(id);
    } catch (e: any) {
      if (e instanceof TypeError) {
        setUncertain(command);
        setError("checking");
      } else {
        showError(e);
        await load(id).catch(() => {});
      }
    } finally {
      if (!uncertain) {
        mutating.current = false;
        setPending(false);
      }
    }
  }
  async function mutate(path: string, body: Data, success?: string) {
    if (mutating.current) return;
    mutating.current = true;
    setPending(true);
    setError("");
    try {
      const result = await request(path, body);
      if (success) setNotice(success);
      await load(id);
      return result;
    } catch (e) {
      showError(e);
    } finally {
      mutating.current = false;
      setPending(false);
    }
  }
  async function purchase(sku: string) {
    if (pending || !config?.paymentsConfigured) return;
    setPending(true);
    setError("");
    try {
      const order = await request("/billing/checkout", {
        clubId: data.clubId,
        sku,
      });
      if (!(window as any).Razorpay)
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve();
          script.onerror = () => reject(Error("CHECKOUT_UNAVAILABLE"));
          document.head.appendChild(script);
        });
      const checkout = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "MSN Cricket",
        description: t("credits"),
        handler: () => {
          setNotice(
            lang === "en"
              ? "Payment received by provider. Credits remain pending until the verified webhook arrives."
              : "പണമടയ്ക്കൽ സേവനം ഇടപാട് സ്വീകരിച്ചു. സ്ഥിരീകരിച്ച അറിയിപ്പ് ലഭിച്ചശേഷം ക്രെഡിറ്റുകൾ ലഭിക്കും.",
          );
          load(id).catch(showError);
        },
        modal: { ondismiss: () => setPending(false) },
      });
      checkout.open();
    } catch (error) {
      showError(error);
    } finally {
      setPending(false);
    }
  }
  function changeView(next: string) {
    document.title = `${t(next)} · MSN Cricket`;
    setView(next);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("#main h1")?.focus(),
    );
    setError("");
    setNotice("");
    window.history.replaceState(
      null,
      "",
      next === "projection" ? `/display/${id}` : `/auctions/${id}/${next}`,
    );
    window.scrollTo({ top: 0 });
    if (next === "my-registration")
      request(`/auctions/${id}/my-registration`)
        .then(setMyStatus)
        .catch(showError);
  }
  const activeLot =
    data?.lots?.find((l: Data) =>
      ["PREVIEW", "OPEN", "PAUSED", "CLOSED"].includes(l.status),
    ) ?? data?.lots?.at(-1);
  const player = data?.players?.find(
    (p: Data) => p.id === activeLot?.registrationId,
  );
  const myTeam = data?.teams?.find(
    (x: Data) => x.id === (data?.myTeamId ?? data?.assignedTeamId),
  );
  const leadingTeam = data?.teams?.find(
    (x: Data) => x.id === activeLot?.leadingTeamId,
  );
  const nextAmount = activeLot
    ? activeLot.amount === null
      ? activeLot.base
      : activeLot.amount + data.rules.increment
    : 0;
  const disabledReason = !synced
    ? "reconnecting"
    : data?.status === "PAUSED"
      ? "paused"
      : uncertain
        ? "awaitingResult"
        : pending
          ? "confirming"
          : myTeam && !data?.myTeamId
            ? "viewOnly"
            : !activeLot
              ? "waiting"
              : activeLot.status !== "OPEN"
                ? "closed"
                : activeLot.leadingTeamId === myTeam?.id
                  ? "leading"
                  : myTeam?.squadSize >= data?.rules.maxSquad
                    ? "full"
                    : nextAmount > data?.maxBid
                      ? "unaffordable"
                      : null;
  const nav = [
    ["overview", "◫"],
    ["live", "◉"],
    ["players", "♧"],
    ["squad", "♜"],
    ...(isAuctioneer ? [["club", "⚙"]] : []),
  ];
  const playerCard = (p: Data) => (
    <div className="player-row" key={p.id}>
      <span className="avatar" aria-hidden="true">
        {p.hasPhoto ? (
          <img alt="" className="pool-photo" src={`/api/photos/${p.id}`} />
        ) : (
          p.name
            .split(" ")
            .map((s: string) => s[0])
            .slice(0, 2)
            .join("")
        )}
      </span>
      <div className="grow">
        <strong>{p.name}</strong>
        <span className="muted">
          {t(p.role)} · {p.location}
        </span>
      </div>
      <div className="right">
        <strong className="numeric">{fmt(p.base)}</strong>
        <span className="muted">{t(p.status ?? "base")}</span>
      </div>
    </div>
  );
  if (!data && projection)
    return (
      <main className="projection">
        <h1>{lang === "en" ? "MSN Cricket display" : "MSN ക്രിക്കറ്റ് പ്രദർശനം"}</h1>
        <p role="status">
          {error
            ? lang === "en"
              ? "Display access is unavailable or expired. Ask the organizer for a new link."
              : "പ്രദർശന പ്രവേശനം ലഭ്യമല്ല അല്ലെങ്കിൽ കാലാവധി കഴിഞ്ഞു. പുതിയ ലിങ്കിനായി സംഘാടകനെ ബന്ധപ്പെടുക."
            : lang === "en"
              ? "Connecting to the auction…"
              : "ലേലത്തിലേക്ക് ബന്ധിപ്പിക്കുന്നു…"}
        </p>
      </main>
    );
  if (!data)
    return (
      <main className="landing">
        <header className="landing-head">
          <Link href="/" aria-label="MSN Cricket">
            <Crest small />
          </Link>
          <button
            className="text-btn"
            onClick={() => setLang(lang === "en" ? "ml" : "en")}
          >
            {t("language")}
          </button>
        </header>
        <section className="landing-grid">
          <div>
            <p className="eyebrow">MSN CRICKET / CLUB AUCTIONS</p>
            <h1>{t("welcome")}</h1>
            <p className="lede">{t("intro")}</p>
            {user && (
              <section className="card onboarding-card">
                <h2>
                  {lang === "en"
                    ? "Create your club auction"
                    : "നിങ്ങളുടെ ക്ലബ്ബിന്റെ ലേലം സൃഷ്ടിക്കുക"}
                </h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLoginBusy(true);
                    try {
                      const f = new FormData(e.currentTarget);
                      const club = await request("/clubs", {
                        name: f.get("clubName"),
                        slug: f.get("slug"),
                      });
                      const rules: any = { reserveEnabled: true };
                      for (const key of [
                        "purse",
                        "minSquad",
                        "maxSquad",
                        "minimumBase",
                        "defaultBase",
                        "increment",
                      ])
                        rules[key] = Number(f.get(key));
                      const created = await request(
                        `/clubs/${club.id}/auctions`,
                        { name: f.get("auctionName"), rules },
                      );
                      setId(created.id);
                      setView("setup");
                    } catch (error) {
                      showError(error);
                    } finally {
                      setLoginBusy(false);
                    }
                  }}
                >
                  <label>
                    {lang === "en" ? "Club name" : "ക്ലബ്ബിന്റെ പേര്"}
                    <input name="clubName" required maxLength={200} />
                  </label>
                  <label>
                    {lang === "en" ? "Club URL name" : "ക്ലബ് ലിങ്കിന്റെ പേര്"}
                    <input
                      name="slug"
                      pattern="[a-z0-9-]{3,60}"
                      required
                      maxLength={60}
                    />
                  </label>
                  <label>
                    {lang === "en" ? "Auction name" : "ലേലത്തിന്റെ പേര്"}
                    <input name="auctionName" required maxLength={200} />
                  </label>
                  <div className="form-grid">
                    {[
                      ["purse", 10000],
                      ["minSquad", 5],
                      ["maxSquad", 11],
                      ["minimumBase", 100],
                      ["defaultBase", 300],
                      ["increment", 100],
                    ].map(([key, value]) => (
                      <label key={key}>
                        {t(key === "purse" ? "initialPurse" : String(key))}
                        <input
                          type="number"
                          name={String(key)}
                          min="1"
                          step="1"
                          defaultValue={value}
                          required
                          inputMode="numeric"
                        />
                      </label>
                    ))}
                  </div>
                  <button className="btn" disabled={loginBusy}>
                    {t("save")}
                  </button>
                </form>
              </section>
            )}
            {config?.rehearsal ? (
              <div className="login-card">
                <span className="tag saffron">{t("rehearsal")}</span>
                <p>{t("sampleNote")}</p>
                <div className="stack">
                  {["admin", "managerA", "managerB"].map((r) => (
                    <button
                      className="btn"
                      key={r}
                      disabled={loginBusy}
                      onClick={() => login(r)}
                    >
                      {t(r === "admin" ? "organizer" : r)}{" "}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card">
                {config?.identityConfigured ? (
                  <a
                    className="btn"
                    href={`/api/auth/start?next=${encodeURIComponent(auctionId ? `/auctions/${auctionId}/${initialView}` : "/")}`}
                  >
                    {t("signin")}
                  </a>
                ) : (
                  <p>{t("identity")}</p>
                )}
              </div>
            )}
            {data?.rehearsal && <p className="tag saffron">{t("rehearsal")}</p>}
            {error && (
              <p role="alert" className="error">
                {t(error)}
              </p>
            )}
          </div>
          <div className="landing-art">
            <div className="orbit" />
            <Jersey />
            <span className="art-caption">ONE CLUB. MANY POSSIBILITIES.</span>
          </div>
        </section>
        <footer>MSN Cricket · Kerala</footer>
      </main>
    );
  const LivePlayer = () => (
    <section
      data-outcome={activeLot?.status}
      className={"card live-card " + (projection ? "broadcast" : "")}
    >
      <div className="section-top">
        <span className="eyebrow">{t("live")}</span>
        <span
          className={"tag " + (activeLot?.status === "OPEN" ? "positive" : "")}
        >
          {t(activeLot?.status ?? data.status)}
        </span>
      </div>
      <div className="player-feature">
        <div className="player-copy">
          <span className="muted">{player?.location ?? "MSN Cricket"}</span>
          <h2>{player?.name ?? t("waiting")}</h2>
          {player && (
            <>
              <p>
                {t(player.role)}
                <span className="dot">·</span>
                {player.battingStyle}
              </p>
              <span className="base-chip">
                {t("base")} <b>{fmt(activeLot.base)}</b>
              </span>
            </>
          )}
        </div>
        <div className="kit-wrap">
          {player?.hasPhoto ? (
            <img
              className="player-photo"
              src={`/api/photos/${player.id}${projection && /^[a-f0-9]{64}$/.test(id) ? `?display=${id}` : ""}`}
              alt={player.name}
            />
          ) : (
            <Jersey
              number={String((data.players?.indexOf(player) ?? 0) + 1).padStart(
                2,
                "0",
              )}
            />
          )}
        </div>
      </div>
      <div className="bid-score">
        <div>
          <span className="muted">{t("accepted")}</span>
          <div className="big-number">
            {activeLot?.amount === null || !activeLot
              ? "—"
              : fmt(activeLot.amount)}
            <small>{t("points")}</small>
          </div>
        </div>
        <div className="leader">
          <span className="muted">{t("leader")}</span>
          <strong>{leadingTeam?.name ?? t("noBids")}</strong>
        </div>
      </div>
      {!projection && myTeam && (
        <div className="bid-dock">
          <div className="section-top">
            <span>
              {t("next")} <b>{fmt(nextAmount)}</b>
            </span>
            <span className="muted">{myTeam.code}</span>
          </div>
          <button
            className="btn bid-button"
            disabled={!!disabledReason}
            onClick={() =>
              send("BID", {
                lotId: activeLot.id,
                expectedVersion: activeLot.version,
                amount: nextAmount,
              })
            }
          >
            {disabledReason
              ? t(disabledReason)
              : `${t("bid")} ${fmt(nextAmount)} ${t("points")}`}{" "}
            {!disabledReason && <span aria-hidden="true">↗</span>}
          </button>
          <p className="bid-help">
            {t("maxBid")}: <b>{fmt(data.maxBid)}</b> {t("points")}
          </p>
        </div>
      )}
    </section>
  );
  const Activity = () => (
    <section className="card">
      <div className="section-top">
        <h3>{t("activity")}</h3>
        <span className="muted">#{data.sequence}</span>
      </div>
      {activity.length ? (
        activity.map((e: Data) => (
          <div className="event" key={e.eventId}>
            <span className="event-icon" aria-hidden="true">
              {e.type === "BID" ? "↗" : "✓"}
            </span>
            <div className="grow">
              <strong>
                {e.type === "BID"
                  ? `${data.teams.find((t: Data) => t.id === e.payload.teamId)?.name ?? t("team")} · ${fmt(e.payload.amount)} ${t("points")}`
                  : t(
                      (
                        {
                          LOCK: "lock",
                          START: "start",
                          SELECT: "select",
                          RANDOM: "random",
                          OPEN: "open",
                          CLOSE: "closed",
                          SELL: "SOLD",
                          UNSOLD: "UNSOLD",
                          PAUSE: "paused",
                          RESUME: "resume",
                          REVERSE: "reverse",
                          RECALL: "recall",
                        } as any
                      )[e.type] ?? "status",
                    )}
              </strong>
              <span className="muted">
                {new Date(e.occurredAt).toLocaleTimeString(
                  lang === "ml" ? "ml-IN" : "en-IN",
                  {
                    timeZone: "Asia/Kolkata",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  },
                )}{" "}
                IST
              </span>
            </div>
          </div>
        ))
      ) : (
        <p className="empty">{t("noActivity")}</p>
      )}
    </section>
  );
  const Teams = () => (
    <section className="card">
      <h3>{t("allTeams")}</h3>
      {data.teams.map((team: Data) => (
        <div key={team.id} className="team-row">
          <span
            className="team-mark"
            style={{ background: team.color ?? "#0759D3" }}
            aria-hidden="true"
          >
            {team.hasLogo ? (
              <img
                className="team-logo"
                alt=""
                src={`/api/auctions/${data.id}/asset?team=${team.id}${projection && /^[a-f0-9]{64}$/.test(id) ? `&display=${id}` : ""}`}
              />
            ) : (
              team.code.slice(0, 3)
            )}
          </span>
          <div className="grow">
            <strong>{team.name}</strong>
            <span className="muted">
              {team.squadSize ??
                data.allocations.filter((a: Data) => a.teamId === team.id)
                  .length}{" "}
              / {data.rules.maxSquad} {t("slots")}
            </span>
            {projection &&
              data.allocations
                .filter((a: Data) => a.teamId === team.id)
                .map((a: Data) => (
                  <span className="muted" key={a.id}>
                    {
                      data.players.find((p: Data) => p.id === a.registrationId)
                        ?.name
                    }{" "}
                    · {fmt(a.price)} {t("points")}
                  </span>
                ))}
          </div>
          <div className="right">
            <strong className="numeric">{fmt(team.remainingPurse)}</strong>
            <span className="muted">
              {t("points")} {t("remaining")}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
  if (projection)
    return (
      <main className="projection">
        <header>
          <Crest small />
          <div>
            <span className="eyebrow">MSN CRICKET</span>
            <h1>{data.name}</h1>
          </div>
          <span className="tag">
            {t(synced ? "connected" : "reconnecting")}
          </span>
          <button
            className="text-btn"
            onClick={() => setLang(lang === "en" ? "ml" : "en")}
          >
            {t("language")}
          </button>
        </header>
        <div className="projection-grid">
          {LivePlayer()}
          {Teams()}
        </div>
        <footer>
          {data.clubName} · {t("published")}
        </footer>
      </main>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {lang === "en" ? "Skip to content" : "ഉള്ളടക്കത്തിലേക്ക്"}
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <Crest small />
          <span>
            MSN <b>Cricket</b>
          </span>
        </Link>
        <p className="sidebar-label">{data.clubName}</p>
        <nav aria-label={t("overview")}>
          {nav.map(([v, icon]) => (
            <button
              key={v}
              className={
                view === v ||
                (v === "club" &&
                  [
                    "control",
                    "setup",
                    "approvals",
                    "billing",
                    "reports",
                  ].includes(view))
                  ? "selected"
                  : ""
              }
              aria-current={view === v ? "page" : undefined}
              onClick={() => changeView(v)}
            >
              <span aria-hidden="true">{icon}</span>
              {t(v)}
            </button>
          ))}
        </nav>
        {(config?.rehearsal || data?.rehearsal) && (
          <div className="sidebar-bottom">
            <span className="tag saffron">{t("rehearsal")}</span>
            <p>{t("sampleNote")}</p>
          </div>
        )}
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            {data.clubBranding?.hasLogo && (
              <img
                className="club-logo"
                alt=""
                src={`/api/auctions/${data.id}/asset`}
              />
            )}
            <span className="eyebrow">MSN / {myTeam?.code ?? t("club")}</span>
            <strong>{data.clubName}</strong>
          </div>
          <div className="top-actions">
            <button
              className="text-btn"
              onClick={() => setLang(lang === "en" ? "ml" : "en")}
            >
              {t("language")}
            </button>
            {user?.platform && (
              <button
                className="text-btn"
                onClick={() => changeView("platform")}
              >
                {lang === "en" ? "Platform" : "പ്ലാറ്റ്ഫോം"}
              </button>
            )}
            <button className="text-btn" onClick={() => changeView("profile")}>
              {lang === "en" ? "Profile" : "എന്റെ വിവരങ്ങൾ"}
            </button>
            <button
              className="text-btn"
              onClick={async () => {
                await request("/auth/logout", {});
                location.href = "/";
              }}
            >
              {t("logout")}
            </button>
            <span className="user-avatar" aria-hidden="true">
              {myTeam?.code ?? "MC"}
            </span>
          </div>
        </header>
        <main
          id="main"
          className={`main-content ${view === "live" ? "live-page" : ""}`}
        >
          {data?.rehearsal && <p className="tag saffron">{t("rehearsal")}</p>}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {t("status")} / {t(data.status)}
              </p>
              <h1 tabIndex={-1}>{t(view === "club" ? "control" : view)}</h1>
              <p className="muted">{data.name}</p>
            </div>
            <span
              className={"connection " + (synced ? "online" : "offline")}
              role="status"
            >
              {t(synced ? "connected" : "reconnecting")}
            </span>
          </div>
          {error && (
            <div className="error" role="alert">
              {t(error)}{" "}
              <button
                className="text-btn"
                onClick={() =>
                  load(id)
                    .then(() => setError(""))
                    .catch(showError)
                }
              >
                {t("refresh")}
              </button>
            </div>
          )}
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {uncertain && (
            <button
              className="btn secondary"
              disabled={!synced || pending}
              onClick={async () => {
                if (!synced || mutating.current) return;
                mutating.current = true;
                setPending(true);
                try {
                  await request(`/auctions/${id}/commands`, uncertain);
                  setUncertain(null);
                  await load(id);
                } catch (e: any) {
                  if (!(e instanceof TypeError)) {
                    setUncertain(null);
                    showError(e);
                    await load(id).catch(() => {});
                  }
                } finally {
                  mutating.current = false;
                  setPending(false);
                }
              }}
            >
              {t("checking")}
            </button>
          )}
          {view === "overview" && (
            <>
              <section className="welcome-banner">
                <div>
                  <span className="tag light">{t(data.status)}</span>
                  <h2>{data.name}</h2>
                  <p>{data.venue}</p>
                  <button
                    className="btn white"
                    onClick={() => changeView("live")}
                  >
                    {t("join")} <span aria-hidden="true">↗</span>
                  </button>
                </div>
                <div className="banner-art">
                  <Jersey />
                </div>
              </section>
              <div className="stat-grid">
                <div className="card stat">
                  <span className="muted">{t("purse")}</span>
                  <strong className="stat-number">
                    {fmt(myTeam?.remainingPurse ?? data.rules.purse)}{" "}
                    <small>{t("points")}</small>
                  </strong>
                  <span className="muted">
                    {myTeam?.name ?? t("initialPurse")}
                  </span>
                </div>
                <div className="card stat">
                  <span className="muted">{t("slots")}</span>
                  <strong className="stat-number">
                    {myTeam?.squadSize ?? data.allocations.length}
                    <small> / {data.rules.maxSquad}</small>
                  </strong>
                  <span className="muted">
                    {t("minSquad")} {data.rules.minSquad}
                  </span>
                </div>
                <div className="card stat">
                  <span className="muted">{t("pool")}</span>
                  <strong className="stat-number">
                    {
                      data.players.filter((p: Data) => p.status === "APPROVED")
                        .length
                    }
                  </strong>
                  <span className="muted">{t("APPROVED")}</span>
                </div>
              </div>
              <div className="two-column">
                {Activity()}
                <section className="card">
                  <h3>{t("rules")}</h3>
                  <dl className="rule-list">
                    {[
                      ["initialPurse", "purse"],
                      ["defaultBase", "defaultBase"],
                      ["increment", "increment"],
                      ["minSquad", "minSquad"],
                      ["maxSquad", "maxSquad"],
                    ].map(([label, key]) => (
                      <div key={key}>
                        <dt>{t(label)}</dt>
                        <dd>{fmt(data.rules[key])}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="muted">
                    {t(data.rules.reserveEnabled ? "reserve" : "reserveOff")}
                  </p>
                  <div className="stack">
                    <ActionButton
                      pending={pending}
                      secondary
                      onClick={() => changeView("register")}
                    >
                      {t("register")}
                    </ActionButton>
                    <ActionButton
                      pending={pending}
                      secondary
                      onClick={() =>
                        mutate(
                          `/auctions/${id}/manager-applications`,
                          {},
                          t("pending"),
                        )
                      }
                    >
                      {t("apply")}
                    </ActionButton>
                    <ActionButton
                      pending={pending}
                      secondary
                      onClick={() => changeView("my-registration")}
                    >
                      {t("myStatus")}
                    </ActionButton>
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "live" && (
            <>
              <div className="mobile-purse">
                <span>
                  {t("purse")} <b>{fmt(myTeam?.remainingPurse ?? 0)}</b>
                </span>
                <span>
                  {t("slots")}{" "}
                  <b>
                    {myTeam?.squadSize ?? 0}/{data.rules.maxSquad}
                  </b>
                </span>
              </div>
              <div className="two-column live-grid">
                <div>
                  {LivePlayer()}
                  {isAuctioneer && (
                    <button
                      className="btn control-link"
                      onClick={() => changeView("control")}
                    >
                      {t("control")} →
                    </button>
                  )}
                </div>
                <div className="stack">
                  {Activity()}
                  {Teams()}
                </div>
              </div>
            </>
          )}
          {view === "players" && (
            <section className="card">
              <div className="filters">
                <label className="grow">
                  {t("search")}
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  {t("role")}
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="">{t("all")}</option>
                    {["BATTER", "BOWLER", "ALL_ROUNDER", "KEEPER"].map((r) => (
                      <option value={r} key={r}>
                        {t(r)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {data.players
                .filter(
                  (p: Data) =>
                    [p.name, p.location, p.battingStyle, p.bowlingStyle]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()) &&
                    (!roleFilter || p.role === roleFilter),
                )
                .map(playerCard)}
              {!data.players.some(
                (p: Data) =>
                  [p.name, p.location, p.battingStyle, p.bowlingStyle]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()) &&
                  (!roleFilter || p.role === roleFilter),
              ) && <p className="empty">{t("emptyPool")}</p>}
            </section>
          )}
          {view === "squad" && (
            <div className="two-column">
              <section className="card">
                <h2>{myTeam?.name ?? t("squad")}</h2>
                <p className="muted">
                  {t("purse")}: {fmt(myTeam?.remainingPurse ?? 0)} {t("points")}
                </p>
                {data.allocations
                  .filter((a: Data) => a.teamId === myTeam?.id)
                  .map((a: Data) => {
                    const p = data.players.find(
                      (p: Data) => p.id === a.registrationId,
                    );
                    return (
                      p && (
                        <div key={a.id}>
                          {playerCard({ ...p, base: a.price, status: "SOLD" })}
                        </div>
                      )
                    );
                  })}
                {!data.allocations.some(
                  (a: Data) => a.teamId === myTeam?.id,
                ) && (
                  <div className="empty-squad">
                    <Jersey />
                    <p>{t("emptySquad")}</p>
                    <ActionButton
                      pending={pending}
                      onClick={() => changeView("live")}
                    >
                      {t("join")}
                    </ActionButton>
                  </div>
                )}
              </section>
              {Teams()}
            </div>
          )}
          {[
            "club",
            "control",
            "setup",
            "approvals",
            "billing",
            "reports",
            "staff",
            "display",
            "branding",
            "operations",
          ].includes(view) &&
            isAuctioneer && (
              <>
                <nav className="club-tabs" aria-label={t("club")}>
                  {[
                    "control",
                    ...(isAdmin
                      ? [
                          "setup",
                          "approvals",
                          "billing",
                          "reports",
                          "staff",
                          "display",
                          "branding",
                          "operations",
                        ]
                      : []),
                  ].map((v) => (
                    <button
                      key={v}
                      aria-current={
                        view === v || (view === "club" && v === "control")
                          ? "page"
                          : undefined
                      }
                      className={
                        view === v || (view === "club" && v === "control")
                          ? "selected"
                          : ""
                      }
                      onClick={() => changeView(v)}
                    >
                      {t(v)}
                    </button>
                  ))}
                </nav>
                {["club", "control"].includes(view) && (
                  <div className="two-column">
                    <div className="stack">
                      {LivePlayer()}
                      <section className="card">
                        <h3>{t("control")}</h3>
                        <div className="action-grid">
                          {data.status === "LIVE" ? (
                            <ActionButton
                              pending={pending}
                              danger
                              onClick={() => send("PAUSE")}
                            >
                              {t("pause")}
                            </ActionButton>
                          ) : data.status === "PAUSED" ? (
                            <ActionButton
                              pending={pending}
                              onClick={() => send("RESUME")}
                            >
                              {t("resume")}
                            </ActionButton>
                          ) : null}
                          {activeLot && data.status === "LIVE" && (
                            <>
                              {activeLot.status === "PREVIEW" && (
                                <ActionButton
                                  pending={pending}
                                  onClick={() =>
                                    send("OPEN", {
                                      lotId: activeLot.id,
                                      expectedVersion: activeLot.version,
                                    })
                                  }
                                >
                                  {t("open")}
                                </ActionButton>
                              )}
                              {activeLot.status === "OPEN" && (
                                <ActionButton
                                  pending={pending}
                                  secondary
                                  onClick={() =>
                                    send(
                                      "CLOSE",
                                      {
                                        lotId: activeLot.id,
                                        expectedVersion: activeLot.version,
                                      },
                                      true,
                                    )
                                  }
                                >
                                  {t("close")}
                                </ActionButton>
                              )}
                              {activeLot.status === "CLOSED" && (
                                <>
                                  <ActionButton
                                    pending={pending}
                                    onClick={() =>
                                      send(
                                        activeLot.amount === null
                                          ? "UNSOLD"
                                          : "SELL",
                                        {
                                          lotId: activeLot.id,
                                          expectedVersion: activeLot.version,
                                        },
                                        true,
                                      )
                                    }
                                  >
                                    {t(
                                      activeLot.amount === null
                                        ? "unsold"
                                        : "sell",
                                    )}
                                  </ActionButton>
                                  {isAdmin && (
                                    <ActionButton
                                      pending={pending}
                                      secondary
                                      onClick={() => {
                                        const reason = prompt(t("reason"));
                                        if (reason)
                                          send(
                                            "REOPEN",
                                            {
                                              lotId: activeLot.id,
                                              expectedVersion:
                                                activeLot.version,
                                              reason,
                                            },
                                            true,
                                          );
                                      }}
                                    >
                                      {t("reopen")}
                                    </ActionButton>
                                  )}
                                </>
                              )}
                            </>
                          )}
                          {isAdmin &&
                            ["LIVE", "PAUSED"].includes(data.status) && (
                              <ActionButton
                                pending={pending}
                                secondary
                                onClick={() => send("COMPLETE", {}, true)}
                              >
                                {t("complete")}
                              </ActionButton>
                            )}
                        </div>
                        <a
                          className="display-link"
                          href={`/display/${id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("projection")} ↗
                        </a>
                      </section>
                      {Activity()}
                      {isAdmin &&
                        data.status === "PAUSED" &&
                        data.allocations.map((a: Data) => (
                          <section className="card" key={a.id}>
                            <strong>
                              {
                                data.players.find(
                                  (p: Data) => p.id === a.registrationId,
                                )?.name
                              }{" "}
                              · {fmt(a.price)}
                            </strong>
                            <ActionButton
                              pending={pending}
                              danger
                              onClick={() => {
                                const reason = prompt(t("reason"));
                                if (reason)
                                  send(
                                    "REVERSE",
                                    { allocationId: a.id, reason },
                                    true,
                                  );
                              }}
                            >
                              {t("reverse")}
                            </ActionButton>
                          </section>
                        ))}
                    </div>
                    <section className="card">
                      <div className="section-top">
                        <h3>{t("pool")}</h3>
                        <ActionButton
                          pending={pending}
                          secondary
                          disabled={
                            data.status !== "LIVE" ||
                            data.lots.some((l: Data) =>
                              ["OPEN", "PREVIEW", "PAUSED", "CLOSED"].includes(
                                l.status,
                              ),
                            )
                          }
                          onClick={() => send("RANDOM")}
                        >
                          {t("random")}
                        </ActionButton>
                      </div>
                      {data.players
                        .filter(
                          (p: Data) =>
                            p.status === "APPROVED" &&
                            !data.allocations.some(
                              (a: Data) => a.registrationId === p.id,
                            ),
                        )
                        .map((p: Data) => {
                          const previous = [...data.lots]
                            .reverse()
                            .find((l: Data) => l.registrationId === p.id);
                          return (
                            <div key={p.id} className="queue-item">
                              {playerCard(p)}
                              <ActionButton
                                pending={pending}
                                secondary
                                disabled={
                                  data.status !== "LIVE" ||
                                  data.lots.some((l: Data) =>
                                    [
                                      "OPEN",
                                      "PREVIEW",
                                      "PAUSED",
                                      "CLOSED",
                                    ].includes(l.status),
                                  ) ||
                                  (!!previous &&
                                    !["UNSOLD", "REVERSED"].includes(
                                      previous.status,
                                    ))
                                }
                                onClick={() =>
                                  send(previous ? "RECALL" : "SELECT", {
                                    registrationId: p.id,
                                  })
                                }
                              >
                                {t(previous ? "recall" : "select")}
                              </ActionButton>
                            </div>
                          );
                        })}
                    </section>
                  </div>
                )}
                {view === "setup" && isAdmin && (
                  <div className="two-column">
                    <div className="stack">
                      <section className="card">
                        <h3>{t("readiness")}</h3>
                        {!data?.rehearsal && (
                          <button
                            className="btn secondary"
                            disabled={pending || data.teams.length < 2}
                            onClick={async () => {
                              const result = await mutate(
                                `/auctions/${id}/rehearse`,
                                {},
                              );
                              if (result)
                                location.href = `/auctions/${result.id}/setup`;
                            }}
                          >
                            {lang === "en"
                              ? "Create separate practice auction"
                              : "പ്രത്യേക പരിശീലന ലേലം സൃഷ്ടിക്കുക"}
                          </button>
                        )}
                        {data.readiness.length ? (
                          data.readiness.map((r: string) => (
                            <p className="readiness-item" key={r}>
                              ○ {t(r)}
                            </p>
                          ))
                        ) : (
                          <p className="success">✓ {t("ready")}</p>
                        )}
                        <div className="stack">
                          {data.status === "DRAFT" && (
                            <ActionButton
                              pending={pending}
                              onClick={() => send("PUBLISH")}
                            >
                              {t("publish")}
                            </ActionButton>
                          )}
                          {["REGISTRATION_OPEN", "READY"].includes(
                            data.status,
                          ) && (
                            <ActionButton
                              pending={pending}
                              disabled={!!data.readiness.length}
                              onClick={() => send("LOCK", {}, true)}
                            >
                              {t("lock")}
                            </ActionButton>
                          )}
                          {data.status === "LOCKED" && (
                            <>
                              <ActionButton
                                pending={pending}
                                onClick={() => send("START", {}, true)}
                              >
                                {t("start")}
                              </ActionButton>
                              <ActionButton
                                pending={pending}
                                secondary
                                onClick={() => send("UNLOCK", {}, true)}
                              >
                                {t("unlock")}
                              </ActionButton>
                            </>
                          )}
                        </div>
                      </section>
                      <section className="card">
                        <h3>{t("setup")}</h3>
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const form = new FormData(e.currentTarget);
                            await mutate(`/auctions/${id}/configure`, {
                              name: form.get("name"),
                              venue: form.get("venue"),
                              publicVisible: form.get("public") === "on",
                              teamCapacity: Number(form.get("teamCapacity")),
                              selectionMode: form.get("selectionMode"),
                              ...(form.get("scheduledAt")
                                ? {
                                    scheduledAt:
                                      String(form.get("scheduledAt")) +
                                      ":00+05:30",
                                  }
                                : {}),
                              ...(form.get("registrationDeadline")
                                ? {
                                    registrationDeadline:
                                      String(form.get("registrationDeadline")) +
                                      ":00+05:30",
                                  }
                                : {}),
                              rules: {
                                purse: Number(form.get("purse")),
                                minSquad: Number(form.get("minSquad")),
                                maxSquad: Number(form.get("maxSquad")),
                                minimumBase: Number(form.get("minimumBase")),
                                defaultBase: Number(form.get("defaultBase")),
                                increment: Number(form.get("increment")),
                                reserveEnabled:
                                  form.get("reserveEnabled") === "on",
                              },
                            });
                          }}
                        >
                          <label>
                            {t("name")}
                            <input
                              name="name"
                              defaultValue={data.name}
                              required
                              maxLength={200}
                            />
                          </label>
                          <label>
                            {t("venue")}
                            <input
                              name="venue"
                              defaultValue={data.venue}
                              required
                              maxLength={200}
                            />
                          </label>
                          <div className="form-grid">
                            {[
                              ["purse", "initialPurse"],
                              ["minSquad", "minSquad"],
                              ["maxSquad", "maxSquad"],
                              ["minimumBase", "minimumBase"],
                              ["defaultBase", "defaultBase"],
                              ["increment", "increment"],
                            ].map(([key, label]) => (
                              <label key={key}>
                                {t(label)}
                                <input
                                  name={key}
                                  type="number"
                                  min="1"
                                  step="1"
                                  defaultValue={data.rules[key]}
                                  required
                                  inputMode="numeric"
                                />
                              </label>
                            ))}
                          </div>
                          <label>
                            {lang === "en"
                              ? "Team capacity"
                              : "ടീമുകളുടെ പരമാവധി എണ്ണം"}
                            <input
                              name="teamCapacity"
                              type="number"
                              min="2"
                              max="20"
                              required
                              defaultValue={data.teamCapacity ?? 20}
                            />
                          </label>
                          <label>
                            {lang === "en"
                              ? "Selection mode"
                              : "തിരഞ്ഞെടുക്കുന്ന രീതി"}
                            <select
                              name="selectionMode"
                              defaultValue={data.selectionMode ?? "BOTH"}
                            >
                              <option value="MANUAL">
                                {lang === "en" ? "Manual" : "നേരിട്ട്"}
                              </option>
                              <option value="RANDOM">
                                {lang === "en" ? "Random" : "ക്രമരഹിതം"}
                              </option>
                              <option value="BOTH">
                                {lang === "en"
                                  ? "Manual and random"
                                  : "നേരിട്ടും ക്രമരഹിതമായും"}
                              </option>
                            </select>
                          </label>
                          {["scheduledAt", "registrationDeadline"].map(
                            (field) => (
                              <label key={field}>
                                {field === "scheduledAt"
                                  ? lang === "en"
                                    ? "Auction time · IST"
                                    : "ലേല സമയം · ഇന്ത്യൻ സമയം"
                                  : lang === "en"
                                    ? "Registration deadline · IST"
                                    : "രജിസ്ട്രേഷൻ അവസാന സമയം · ഇന്ത്യൻ സമയം"}
                                <input
                                  name={field}
                                  type="datetime-local"
                                  defaultValue={
                                    data[field]
                                      ? new Date(data[field])
                                          .toLocaleString("sv-SE", {
                                            timeZone: "Asia/Kolkata",
                                          })
                                          .slice(0, 16)
                                          .replace(" ", "T")
                                      : ""
                                  }
                                />
                              </label>
                            ),
                          )}
                          <label className="check">
                            <input
                              type="checkbox"
                              name="reserveEnabled"
                              defaultChecked={data.rules.reserveEnabled}
                            />
                            {t("reserve")}
                          </label>
                          <p className="muted">
                            {lang === "en"
                              ? "Changing rules before locking requires player reapproval. Disabling reserve protection can leave a team without enough points to fill its minimum squad."
                              : "പൂട്ടുന്നതിന് മുമ്പ് നിയമങ്ങൾ മാറ്റിയാൽ കളിക്കാരെ വീണ്ടും അംഗീകരിക്കണം. കരുതൽ പോയിന്റുകൾ ഒഴിവാക്കിയാൽ കുറഞ്ഞ അംഗസംഖ്യ നിറയ്ക്കാൻ മതിയായ പോയിന്റുകൾ ഇല്ലാതാകാം."}
                          </p>
                          <label className="check">
                            <input
                              type="checkbox"
                              name="public"
                              defaultChecked={data.publicVisible}
                            />
                            {t("published")}
                          </label>
                          <button
                            className="btn"
                            disabled={
                              pending ||
                              !["DRAFT", "REGISTRATION_OPEN", "READY"].includes(
                                data.status,
                              )
                            }
                          >
                            {t("save")}
                          </button>
                        </form>
                      </section>
                    </div>
                    <div className="stack">
                      <section className="card">
                        <h3>{t("addTeam")}</h3>
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const element = e.currentTarget;
                            const form = new FormData(element);
                            const result = await mutate(
                              `/auctions/${id}/teams`,
                              {
                                name: form.get("name"),
                                code: form.get("code"),
                              },
                            );
                            if (result) element.reset();
                          }}
                        >
                          <label>
                            {t("teamName")}
                            <input name="name" required maxLength={200} />
                          </label>
                          <label>
                            {t("code")}
                            <input
                              name="code"
                              required
                              pattern="[A-Z0-9]{2,5}"
                              maxLength={5}
                            />
                          </label>
                          <button
                            className="btn"
                            disabled={
                              pending ||
                              !["DRAFT", "REGISTRATION_OPEN", "READY"].includes(
                                data.status,
                              )
                            }
                          >
                            {t("addTeam")}
                          </button>
                        </form>
                      </section>
                      <section className="card">
                        <h3>{t("invites")}</h3>
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            const result = await mutate(
                              `/auctions/${id}/invites`,
                              { email: f.get("email"), teamId: f.get("team") },
                            );
                            if (result)
                              setInvite(
                                `${location.origin}/auctions/${id}/join-team?invite=${result.token}`,
                              );
                          }}
                        >
                          <label>
                            {t("email")}
                            <input
                              type="email"
                              name="email"
                              required
                              autoComplete="email"
                            />
                          </label>
                          <label>
                            {t("team")}
                            <select name="team">
                              {data.teams.map((team: Data) => (
                                <option key={team.id} value={team.id}>
                                  {team.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button className="btn secondary" disabled={pending}>
                            {t("createInvite")}
                          </button>
                          {invite && (
                            <p className="invite-link">
                              <a href={invite}>{invite}</a>
                            </p>
                          )}
                        </form>
                      </section>
                      {Teams()}
                    </div>
                  </div>
                )}
                {view === "approvals" && isAdmin && (
                  <section className="card">
                    <h3>{t("review")}</h3>
                    {data.players
                      .filter((p: Data) =>
                        ["PENDING", "CHANGES_REQUESTED"].includes(p.status),
                      )
                      .map((p: Data) => (
                        <div className="approval" key={p.id}>
                          {playerCard(p)}
                          {p.duplicateFlags?.length > 0 && (
                            <p className="error">
                              {lang === "en"
                                ? "Possible duplicate name or phone. Review before approving."
                                : "പേരോ ഫോൺ നമ്പറോ ആവർത്തിച്ചിരിക്കാം. അംഗീകരിക്കുന്നതിന് മുമ്പ് പരിശോധിക്കുക."}
                            </p>
                          )}
                          <button
                            className="text-btn"
                            onClick={async () => {
                              try {
                                const review = await request(
                                  `/auctions/${id}/review/${p.id}`,
                                );
                                alert(
                                  `${review.name}\n${t("phone")}: ${review.phone}\n${t("birthDate")}: ${review.birthDate}`,
                                );
                              } catch (e) {
                                showError(e);
                              }
                            }}
                          >
                            {lang === "en"
                              ? "Review private profile"
                              : "സ്വകാര്യ വിവരങ്ങൾ പരിശോധിക്കുക"}
                          </button>
                          <div className="action-grid">
                            {["APPROVED", "REJECTED", "CHANGES_REQUESTED"].map(
                              (status) => (
                                <ActionButton
                                  pending={pending}
                                  key={status}
                                  secondary={status !== "APPROVED"}
                                  onClick={() => {
                                    const reason =
                                      status === "APPROVED"
                                        ? undefined
                                        : prompt(t("reason"));
                                    if (status !== "APPROVED" && !reason)
                                      return;
                                    mutate(`/auctions/${id}/review`, {
                                      kind: "PLAYER",
                                      id: p.id,
                                      status,
                                      ...(reason ? { reason } : {}),
                                    });
                                  }}
                                >
                                  {t(
                                    (
                                      {
                                        APPROVED: "approve",
                                        REJECTED: "reject",
                                        CHANGES_REQUESTED: "changes",
                                      } as any
                                    )[status],
                                  )}
                                </ActionButton>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    {data.applications
                      .filter((a: Data) =>
                        ["PENDING", "CHANGES_REQUESTED"].includes(a.status),
                      )
                      .map((a: Data) => (
                        <form
                          className="approval"
                          key={a.id}
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            mutate(`/auctions/${id}/review`, {
                              kind: "MANAGER",
                              id: a.id,
                              status: "APPROVED",
                              teamId: f.get("team"),
                            });
                          }}
                        >
                          <strong>
                            {t("apply")} · {a.userId.slice(0, 8)}
                          </strong>
                          <label>
                            {t("team")}
                            <select name="team">
                              {data.teams.map((team: Data) => (
                                <option key={team.id} value={team.id}>
                                  {team.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button className="btn" disabled={pending}>
                            {t("approve")}
                          </button>
                          <div className="action-grid">
                            {["REJECTED", "CHANGES_REQUESTED"].map((status) => (
                              <button
                                type="button"
                                className="btn secondary"
                                disabled={pending}
                                key={status}
                                onClick={() => {
                                  const reason = prompt(t("reason"));
                                  if (reason)
                                    mutate(`/auctions/${id}/review`, {
                                      kind: "MANAGER",
                                      id: a.id,
                                      status,
                                      reason,
                                    });
                                }}
                              >
                                {t(
                                  status === "REJECTED" ? "reject" : "changes",
                                )}
                              </button>
                            ))}
                          </div>
                        </form>
                      ))}
                    {!data.players.some((p: Data) =>
                      ["PENDING", "CHANGES_REQUESTED"].includes(p.status),
                    ) &&
                      !data.applications.some((a: Data) =>
                        ["PENDING", "CHANGES_REQUESTED"].includes(a.status),
                      ) && <p className="empty">✓ {t("noReviews")}</p>}
                  </section>
                )}
                {view === "billing" && isAdmin && (
                  <div className="two-column">
                    <section className="card credit-card">
                      <p className="eyebrow">{t("credits")}</p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const result = await mutate(
                            `/auctions/${id}/credit-request`,
                            {
                              units: Number(f.get("units")),
                              reference: f.get("reference"),
                            },
                          );
                          if (result) {
                            setBilling(
                              await request(`/auctions/${id}/billing`),
                            );
                            setNotice(
                              lang === "en"
                                ? "License request submitted for platform review."
                                : "ലൈസൻസ് അപേക്ഷ പ്ലാറ്റ്ഫോം പരിശോധനയ്ക്കായി സമർപ്പിച്ചു.",
                            );
                          }
                        }}
                      >
                        <h3>
                          {lang === "en"
                            ? "Request a manual license"
                            : "മാനുവൽ ലൈസൻസിന് അപേക്ഷിക്കുക"}
                        </h3>
                        <label>
                          {t("credits")}
                          <input
                            name="units"
                            type="number"
                            min="1"
                            max="1000"
                            defaultValue={1}
                            required
                            inputMode="numeric"
                          />
                        </label>
                        <label>
                          {lang === "en"
                            ? "Purchase reference (optional)"
                            : "വാങ്ങലിന്റെ റഫറൻസ് (നിർബന്ധമില്ല)"}
                          <input name="reference" maxLength={200} />
                        </label>
                        <button className="btn secondary" disabled={pending}>
                          {t("submit")}
                        </button>
                      </form>
                      <strong className="big-number">{data.credits}</strong>
                      {!config?.paymentsConfigured ? (
                        <p>{t("noCheckout")}</p>
                      ) : (
                        <div className="stack">
                          {products.map((p) => (
                            <button
                              className="btn"
                              key={p.sku}
                              disabled={pending}
                              onClick={() => purchase(p.sku)}
                            >
                              {p.units} {t("credits")} ·{" "}
                              {new Intl.NumberFormat(
                                lang === "ml" ? "ml-IN" : "en-IN",
                                { style: "currency", currency: p.currency },
                              ).format(p.amountMinor / 100)}
                            </button>
                          ))}
                        </div>
                      )}
                      {user?.platform && (
                        <form
                          className="manual-grant"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            await mutate("/platform/credit-grants", {
                              clubId: data.clubId,
                              units: Number(f.get("units")),
                              reason: f.get("reason"),
                            });
                          }}
                        >
                          <label>
                            {t("credits")}
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
                            {t("reason")}
                            <input
                              name="reason"
                              required
                              minLength={3}
                              maxLength={2000}
                            />
                          </label>
                          <button className="btn secondary" disabled={pending}>
                            {lang === "en"
                              ? "Issue manual credits"
                              : "മാനുവൽ ക്രെഡിറ്റുകൾ നൽകുക"}
                          </button>
                        </form>
                      )}
                    </section>
                    <section className="card">
                      <h3>{t("manual")}</h3>
                      {billing?.orders.map((o: Data) => (
                        <p className="event" key={o.id}>
                          {o.reference ?? o.id.slice(0, 8)} · {t(o.status)}
                        </p>
                      ))}
                      {billing?.requests.map((r: Data) => (
                        <p className="event" key={r.id}>
                          {r.units} {t("credits")} · {t(r.status)} {r.reason}
                        </p>
                      ))}
                      {data.grants.map((g: Data) => (
                        <div className="event" key={g.id}>
                          <div>
                            <strong>{g.reason}</strong>
                            <p className="muted">
                              {g.units - g.used} / {g.units} {t("remaining")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </section>
                  </div>
                )}
                {view === "reports" && isAdmin && (
                  <section className="card">
                    <h3>{t("reports")}</h3>
                    <p className="muted">{t("reportNote")}</p>
                    <div className="report-grid">
                      {[
                        "players",
                        "allocations",
                        "unsold",
                        "ledger",
                        "bids",
                      ].map((kind) => (
                        <a
                          className="report-download"
                          href={`/api/auctions/${id}/reports/${kind}`}
                          key={kind}
                        >
                          <span>
                            {t(
                              (
                                {
                                  players: "pool",
                                  allocations: "squad",
                                  unsold: "UNSOLD",
                                  ledger: "balance",
                                  bids: "activity",
                                } as any
                              )[kind],
                            )}
                          </span>
                          <strong>{t("download")} ↓</strong>
                        </a>
                      ))}
                    </div>
                    <ActionButton
                      pending={pending}
                      secondary
                      onClick={() =>
                        request(`/auctions/${id}/reconcile`)
                          .then(setReport)
                          .catch(showError)
                      }
                    >
                      {t("balance")}
                    </ActionButton>
                    {report && (
                      <p
                        role="status"
                        className={report.balanced ? "success" : "error"}
                      >
                        {report.balanced ? "✓" : "!"} {t("balance")}{" "}
                        {report.balanced ? "✓" : "!"}
                      </p>
                    )}
                  </section>
                )}
              </>
            )}
          {isAdmin &&
            ["staff", "display", "branding", "operations"].includes(view) && (
              <Management
                auction={data}
                lang={lang}
                refresh={() => load(id)}
                section={view}
              />
            )}
          {view === "platform" && user?.platform && (
            <PlatformConsole lang={lang} />
          )}
          {view === "profile" && (
            <ProfileEditor
              lang={lang}
              auctionId={id}
              onSaved={() => load(id)}
            />
          )}
          {view === "register" && (
            <section className="card form-card">
              {data.publicOnly && !user && (
                <p className="error">
                  <a
                    href={`/api/auth/start?next=${encodeURIComponent(`/auctions/${id}/${view}`)}`}
                  >
                    {t("signin")}
                  </a>
                </p>
              )}
              <h2>{t("register")}</h2>
              <form
                key={savedProfile?.id ?? "registration"}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const payload: Data = {};
                  for (const key of [
                    "name",
                    "birthDate",
                    "phone",
                    "location",
                    "role",
                    "battingStyle",
                    "bowlingStyle",
                  ])
                    payload[key] = f.get(key);
                  if (f.get("requestedBase"))
                    payload.requestedBase = Number(f.get("requestedBase"));
                  payload.displayConsent = f.get("consent") === "on";
                  if (photoKey) payload.photoKey = photoKey;
                  await mutate(
                    `/auctions/${id}/registrations`,
                    payload,
                    t("pending"),
                  );
                }}
              >
                {config?.storageConfigured && (
                  <label>
                    {lang === "en"
                      ? "Player photo · JPEG, PNG or WebP · up to 5 MB"
                      : "കളിക്കാരന്റെ ചിത്രം · JPEG, PNG, WebP · 5 MB വരെ"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      required={!photoKey}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setPending(true);
                        setPhotoKey("");
                        try {
                          if (file.size > 5 * 1024 * 1024)
                            throw Error("IMAGE_TOO_LARGE");
                          const bytes = new Uint8Array(
                            await file.arrayBuffer(),
                          );
                          let binary = "";
                          for (
                            let start = 0;
                            start < bytes.length;
                            start += 32768
                          )
                            binary += String.fromCharCode(
                              ...bytes.subarray(start, start + 32768),
                            );
                          const result = await request("/photos", {
                            base64: btoa(binary),
                          });
                          setPhotoKey(result.key);
                        } catch (error) {
                          showError(error);
                        } finally {
                          setPending(false);
                        }
                      }}
                    />
                  </label>
                )}
                <div className="form-grid">
                  {["name", "birthDate", "phone", "location"].map((field) => (
                    <label key={field}>
                      {t(field)}
                      <input
                        name={field}
                        defaultValue={savedProfile?.[field] ?? ""}
                        required
                        type={
                          field === "birthDate"
                            ? "date"
                            : field === "phone"
                              ? "tel"
                              : "text"
                        }
                        autoComplete={
                          field === "name"
                            ? "name"
                            : field === "birthDate"
                              ? "bday"
                              : field === "phone"
                                ? "tel"
                                : "address-level2"
                        }
                        maxLength={field === "phone" ? 30 : 200}
                      />
                    </label>
                  ))}
                  <label>
                    {t("role")}
                    <select
                      name="role"
                      defaultValue={savedProfile?.role ?? "BATTER"}
                    >
                      {["BATTER", "BOWLER", "ALL_ROUNDER", "KEEPER"].map(
                        (r) => (
                          <option key={r} value={r}>
                            {t(r)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  {["battingStyle", "bowlingStyle"].map((field) => (
                    <label key={field}>
                      {t(field)}
                      <input
                        name={field}
                        defaultValue={savedProfile?.[field] ?? ""}
                        required
                        maxLength={200}
                      />
                    </label>
                  ))}
                  <label>
                    {t("requestedBase")}
                    <input
                      type="number"
                      inputMode="numeric"
                      name="requestedBase"
                      min={data.rules.minimumBase}
                      max={data.rules.purse}
                      step="1"
                    />
                  </label>
                </div>
                <label className="check">
                  <input type="checkbox" name="consent" required />
                  {t("consent")}
                </label>
                <button className="btn" disabled={pending}>
                  {pending ? t("confirming") : t("submit")}
                </button>
              </form>
            </section>
          )}
          {view === "my-registration" && (
            <section className="card">
              <h2>{t("myStatus")}</h2>
              {myStatus?.players.map((r: Data) => (
                <p key={r.id}>
                  {t("register")} · <strong>{t(r.status)}</strong>
                  {r.reason && <span className="muted">{r.reason}</span>}
                  {r.teamName && (
                    <span className="muted">
                      {r.teamName} · {fmt(r.price)} {t("points")}
                    </span>
                  )}
                </p>
              ))}
              {myStatus?.manager.map((r: Data) => (
                <p key={r.id}>
                  {t("apply")} · <strong>{t(r.status)}</strong>
                  {r.reason && <span className="muted">{r.reason}</span>}
                </p>
              ))}
            </section>
          )}
          {view === "join-team" && (
            <section className="card">
              <h2>{t("apply")}</h2>
              <ActionButton
                pending={pending}
                onClick={() => {
                  const token = new URLSearchParams(location.search).get(
                    "invite",
                  );
                  mutate(
                    token
                      ? "/invites/accept"
                      : `/auctions/${id}/manager-applications`,
                    token ? { token } : {},
                    t("pending"),
                  );
                }}
              >
                {t("submit")}
              </ActionButton>
            </section>
          )}
        </main>
        <footer className="app-footer">
          MSN Cricket <span>·</span> {t("points")} ≠ ₹
        </footer>
      </div>
      <nav className="bottom-nav" aria-label={t("overview")}>
        {nav.map(([v, icon]) => (
          <button
            key={v}
            className={
              view === v ||
              (v === "club" &&
                [
                  "control",
                  "setup",
                  "approvals",
                  "billing",
                  "reports",
                ].includes(view))
                ? "selected"
                : ""
            }
            aria-current={view === v ? "page" : undefined}
            onClick={() => changeView(v)}
          >
            <span aria-hidden="true">{icon}</span>
            {t(v)}
          </button>
        ))}
      </nav>
    </div>
  );
}
