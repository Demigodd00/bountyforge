"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BountyAction, BountySummary, BountyView, ClaimAction, ClaimView, ProtocolConfig,
  ProgressHandler, TxProgress, WalletSession, CONTRACT_READY,
  appealClaim, cancelBounty, challengeClaim, claimPayout, clearPendingTransaction, connectWallet, createBounty, depositCredit, withdrawCredit, getCredit,
  expireBounty, finalizeBounty, formatDuration, formatGen, friendlyError, getBounty,
  getConfig, getPendingTransaction, isBountyId, isCompatibleConfig, listBounties,
  listClaims, listHunterClaims, listSponsorBounties, parseGen, releaseRejectedStake,
  resolveClaim, resumePendingTransaction, sameAddress, shorten, submitClaim,
  timeoutClaim, validateChallengeInput, validateClaimInput, validateCreateInput, watchWallet, restoreWallet,
} from "@/lib/contract";
import BountyControls from "./BountyControls";
import ClaimRow from "./ClaimRow";
import { ErrorNotice, Field, Modal, StatusPill, TxNotice, dateLabel } from "./Ui";

type Feed = "all" | "sponsor" | "hunter";
export type BountyForgeView = "explore" | "dashboard" | "post" | "bounty";
type FormKind = "submit" | "challenge" | null;
type BountyForgeAppProps = { view?: BountyForgeView; bountyId?: string };
const emptyProgress: TxProgress = { state: "confirmed", label: "" };

function mergeItems<T>(first: T[], previous: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return [...first, ...previous].filter((item) => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; });
}

export default function BountyForgeApp({ view = "explore", bountyId = "" }: BountyForgeAppProps) {
  const router = useRouter();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [config, setConfig] = useState<ProtocolConfig | null>(null);
  const [credit, setCredit] = useState<bigint | null>(null);
  const [bounties, setBounties] = useState<BountySummary[]>([]);
  const [activity, setActivity] = useState<ClaimView[]>([]);
  const [total, setTotal] = useState(0);
  const [feed, setFeed] = useState<Feed>(view === "dashboard" ? "sponsor" : "all");
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState<BountyView | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [claimTotal, setClaimTotal] = useState(0);
  const [openId, setOpenId] = useState("");
  const [progress, setProgress] = useState<TxProgress>(emptyProgress);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [modal, setModal] = useState<FormKind>(null);
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [pot, setPot] = useState("0.001");
  const [deadline, setDeadline] = useState("14");
  const [prUrl, setPrUrl] = useState("");
  const [headSha, setHeadSha] = useState("");
  const [githubLogin, setGithubLogin] = useState("");
  const [challengeStatement, setChallengeStatement] = useState("");

  const feedRequest = useRef(0);
  const detailRequest = useRef(0);
  const actionLock = useRef(false);
  const lastWriteConfirmed = useRef(false);
  const scrollTarget = useRef("");
  const selectedIdRef = useRef("");
  const loadedCount = useRef(0);
  const knownFeedTotal = useRef(0);
  const knownClaimTotal = useRef(0);
  const creditRequest = useRef(0);
  const currentWalletAddress = useRef("");
  currentWalletAddress.current = session?.address ?? "";
  selectedIdRef.current = selectedId;
  loadedCount.current = feed === "hunter" ? activity.length : bounties.length;
  knownFeedTotal.current = total;
  knownClaimTotal.current = claimTotal;

  const ready = isCompatibleConfig(config);
  const locked = busy || progress.state === "unconfirmed";
  const writesDisabled = !ready || locked || !session;
  const stakeLabel = config ? formatGen(config.claim_stake_atto ?? "0") : "—";
  const appealLabel = config ? formatDuration(config.appeal_window_secs) : "—";
  const reviewLabel = config ? formatDuration(config.review_window_secs) : "—";
  const stakeCost = ready ? BigInt(config!.claim_stake_atto) : 0n;
  const creationCost = useMemo(() => { try { return parseGen(pot); } catch { return 0n; } }, [pot]);
  const hasCredit = (amount: bigint) => credit !== null && credit >= amount;
  const lockedLabel = progress.state === "unconfirmed" ? "Resolve previous transaction…" : "Transaction in progress…";
  const stepTwoLabel = (label: string, amount: bigint) => {
    if (!ready) return "Checking StudioNet…";
    if (locked) return lockedLabel;
    if (!session) return "Connect wallet above";
    if (credit === null) return "Loading app balance…";
    if (!hasCredit(amount)) return "Complete Step 1 first";
    return label;
  };
  const limit = (name: string, fallback: number) => Number(config?.[name] ?? fallback);
  const reportReadError = useCallback((err: unknown) => {
    setError((lastWriteConfirmed.current ? "Confirmed, but refresh failed. " : "") + friendlyError(err));
  }, []);

  const loadCredit = useCallback(async () => {
    const request = ++creditRequest.current;
    if (!session) { setCredit(null); return; }
    const amount = await getCredit(session.address);
    if (request === creditRequest.current && currentWalletAddress.current === session.address) setCredit(amount);
  }, [session]);

  useEffect(() => {
    setCredit(null);
    if (ready) void loadCredit().catch(reportReadError);
    return () => { ++creditRequest.current; };
  }, [ready, loadCredit, reportReadError]);

  const loadFeed = useCallback(async (reset = true) => {
    if (!CONTRACT_READY) return;
    const request = reset ? ++feedRequest.current : feedRequest.current;
    const offset = reset ? 0 : loadedCount.current;
    const previousTotal = knownFeedTotal.current;
    if (feed !== "all" && !session) { setBounties([]); setActivity([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      if (feed === "hunter" && session) {
        let page = await listHunterClaims(session.address, offset);
        const restart = !reset && page.total !== previousTotal;
        // Newest-first offsets move when records arrive. Restart from a fresh
        // first page rather than skipping items or looping on duplicates.
        if (restart) page = await listHunterClaims(session.address, 0);
        if (request !== feedRequest.current) return;
        setActivity((old) => reset || restart ? page.items : mergeItems(old, page.items, (claim) => claim.bounty_id + ":" + claim.index));
        setTotal(page.total);
      } else {
        const fetchPage = (start: number) => feed === "sponsor" && session ? listSponsorBounties(session.address, start) : listBounties(start);
        let page = await fetchPage(offset);
        const restart = !reset && page.total !== previousTotal;
        if (restart) page = await fetchPage(0);
        if (request !== feedRequest.current) return;
        setBounties((old) => reset || restart ? page.items : mergeItems(old, page.items, (bounty) => bounty.id));
        setTotal(page.total);
      }
    } finally { if (request === feedRequest.current) setLoading(false); }
  }, [feed, session]);

  const loadDetails = useCallback(async (id: string, preserve = false) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    try {
      const [bounty, page] = await Promise.all([getBounty(id), listClaims(id)]);
      if (request !== detailRequest.current || selectedIdRef.current !== id) return;
      setSelected(bounty);
      setBounties((old) => old.map((item) => item.id === id ? { ...item, ...bounty } : item));
      const refreshedClaims = new Map(page.items.map((claim) => [claim.index, claim]));
      setActivity((old) => old.map((item) => item.bounty_id === id ? refreshedClaims.get(item.index) ?? item : item));
      setClaims((old) => preserve && page.total === knownClaimTotal.current ? mergeItems(page.items, old, (claim) => claim.index) : page.items);
      setClaimTotal(page.total);
    } finally { if (request === detailRequest.current) setDetailLoading(false); }
  }, []);

  const selectBounty = useCallback(async (id: string) => {
    if (!isBountyId(id)) { setError("Use a bounty ID such as bf-1."); return; }
    selectedIdRef.current = id;
    scrollTarget.current = id;
    setSelectedId(id); setSelected(null); setClaims([]); setError("");
    try {
      await loadDetails(id);
    } catch (err) { if (selectedIdRef.current === id) setError(friendlyError(err)); }
  }, [loadDetails]);

  useEffect(() => {
    let active = true;
    if (CONTRACT_READY) {
      void getConfig().then((value) => { if (active) setConfig(value); }).catch((err) => { if (active) setError(friendlyError(err)); });
      void restoreWallet().then((wallet) => {
        if (active && wallet && !currentWalletAddress.current) setSession(wallet);
      }).catch(() => { /* Connection remains an explicit user action. */ });
    }
    const pending = getPendingTransaction();
    if (pending) {
      setProgress({ state: "unconfirmed", label: "Checking your previous transaction…", hash: pending.hash });
      void checkPending();
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (view === "bounty" && bountyId) { setOpenId(bountyId); void selectBounty(bountyId); return; }
    ++detailRequest.current; selectedIdRef.current = ""; setSelectedId(""); setSelected(null); setClaims([]);
  }, [view, bountyId, selectBounty]);

  useEffect(() => {
    if (view !== "explore" && view !== "dashboard") return;
    setBounties([]); setActivity([]); setTotal(0);
    void loadFeed().catch(reportReadError);
    return () => { ++feedRequest.current; };
  }, [view, loadFeed, reportReadError]);

  useEffect(() => {
    if (!selected || scrollTarget.current !== selected.id) return;
    scrollTarget.current = "";
    document.getElementById("bounty-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  useEffect(() => {
    if (!session) return;
    return watchWallet(session, (reason) => { setSession(null); setError(reason); });
  }, [session]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !actionLock.current) void loadDetails(selectedId, true).catch(reportReadError);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [selectedId, loadDetails, reportReadError]);

  const refresh = async () => {
    await Promise.all([
      getConfig().then(setConfig), loadFeed(),
      ready ? loadCredit() : Promise.resolve(),
      selectedIdRef.current ? loadDetails(selectedIdRef.current, true) : Promise.resolve(),
    ]);
  };

  async function connect() {
    if (connecting) return;
    setConnecting(true); setError("");
    try { setSession(await connectWallet()); }
    catch (err) { setError(friendlyError(err)); }
    finally { setConnecting(false); }
  }

  function finishForm(functionName?: string) {
    if (functionName && ["deposit", "deposit_credit_recovered", "withdraw_credit", "create_bounty", "submit_claim", "challenge_claim"].includes(functionName)) setCredit(null);
    if (functionName === "deposit") setProgress((current) => ({ ...current, state: "confirmed", label: "Deposit confirmed. Complete Step 2 below." }));
    if (functionName === "deposit_credit_recovered") setProgress((current) => ({ ...current, state: "confirmed", label: "App balance found. Continue to Step 2." }));
    if (functionName === "create_bounty") { setTitle(""); setCriteria(""); setIssueUrl(""); }
    if (functionName === "submit_claim") { setModal(null); setPrUrl(""); setHeadSha(""); setGithubLogin(""); }
    if (functionName === "challenge_claim") { setModal(null); setChallengeStatement(""); }
  }

  async function refreshAfterSuccess(functionName?: string) {
    try {
      await refresh();
      if (functionName === "create_bounty" && session) {
        const mine = await listSponsorBounties(session.address);
        if (mine.items[0]) router.push("/bounties/" + mine.items[0].id);
      }
    } catch (err) { setError("Confirmed, but refresh failed. " + friendlyError(err)); }
  }

  async function run(action: (wallet: WalletSession, notify: ProgressHandler) => Promise<string>, functionName?: string): Promise<boolean> {
    if (actionLock.current || locked) return false;
    if (!session) { setError("Connect your wallet first."); return false; }
    if (!ready) { setError("Contract upgrade pending. Transactions are paused."); return false; }
    actionLock.current = true; lastWriteConfirmed.current = false; setBusy(true); setError("");
    try {
      await action(session, setProgress);
      lastWriteConfirmed.current = true;
      finishForm(functionName);
      await refreshAfterSuccess(functionName);
      return true;
    } catch (err) { setError(friendlyError(err)); return false; }
    finally { actionLock.current = false; setBusy(false); }
  }

  async function checkPending() {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError("");
    try {
      const functionName = await resumePendingTransaction(setProgress);
      lastWriteConfirmed.current = true;
      finishForm(functionName);
      await refreshAfterSuccess(functionName);
    } catch (err) { setError(friendlyError(err)); }
    finally { actionLock.current = false; setBusy(false); }
  }

  function clearSavedPending() {
    const pending = getPendingTransaction();
    if (!pending) { setProgress(emptyProgress); return; }
    const approved = window.confirm("Clear this saved check only after the transaction already appears onchain or in your wallet activity. This does not cancel the transaction. Do not submit it again.");
    if (!approved) return;
    try {
      clearPendingTransaction(pending.hash);
      setProgress(emptyProgress);
      setError("Saved check cleared. Do not repeat an action that already appears onchain.");
      void refresh().catch(reportReadError);
    } catch (err) { setError(friendlyError(err)); }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    try {
      const days = Number(deadline);
      if (!Number.isInteger(days) || days < 1) throw new Error("Enter a whole number of days.");
      const input = { title, criteria, issueUrl, potAtto: parseGen(pot), deadlineUnix: Math.floor(Date.now() / 1000) + days * 86400 };
      validateCreateInput(input, config);
      await run((wallet, notify) => createBounty(wallet, input, notify), "create_bounty");
    } catch (err) { setError(friendlyError(err)); }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      validateClaimInput(selected.owner_repo, prUrl, headSha, githubLogin);
      await run((wallet, notify) => submitClaim(wallet, selected, prUrl, headSha, githubLogin, notify), "submit_claim");
    } catch (err) { setError(friendlyError(err)); }
  }

  async function onChallenge(event: FormEvent) {
    event.preventDefault();
    if (!selected || !config) return;
    try {
      validateChallengeInput(challengeStatement, config);
      await run((wallet, notify) => challengeClaim(wallet, selected.id, challengeStatement, notify), "challenge_claim");
    } catch (err) { setError(friendlyError(err)); }
  }

  function bountyAction(action: BountyAction) {
    if (!selected) return;
    const method = { cancel: cancelBounty, expire: expireBounty, finalize: finalizeBounty, payout: claimPayout }[action];
    void run((wallet, notify) => method(wallet, selected.id, notify));
  }

  function claimAction(action: ClaimAction, claim: ClaimView) {
    if (!selected || claim.bounty_id !== selected.id) return;
    const method = { resolve: resolveClaim, refund: resolveClaim, appeal: appealClaim, "close-appeal": releaseRejectedStake, timeout: timeoutClaim }[action];
    void run((wallet, notify) => method(wallet, selected.id, claim.index, notify));
  }

  function fundingStep(amount: bigint) {
    if (!session || !ready) return null;
    const shortfall = credit !== null && amount > credit ? amount - credit : 0n;
    return <div className="funding-step">
      <span>App balance: <b>{credit === null ? "Loading…" : formatGen(credit) + " GEN"}</b></span>
      {shortfall > 0n
        ? <><button type="button" className="button ghost small" disabled={locked} onClick={() => void run((wallet, notify) => depositCredit(wallet, shortfall, notify), "deposit")}>1 · Deposit {formatGen(shortfall)} GEN</button><small>Then complete Step 2.</small></>
        : credit !== null && amount > 0n ? <small>Balance ready. Step 2 attaches 0 GEN and spends this existing app balance.</small> : null}
    </div>;
  }

  async function moreClaims() {
    if (!selected || claimsLoading) return;
    const id = selected.id, request = detailRequest.current;
    setClaimsLoading(true);
    try {
      const page = await listClaims(id, claims.length);
      if (selectedIdRef.current !== id || request !== detailRequest.current) return;
      if (page.total !== knownClaimTotal.current) { await loadDetails(id); return; }
      setClaims((old) => mergeItems(old, page.items, (claim) => claim.index)); setClaimTotal(page.total);
    } catch (err) { setError(friendlyError(err)); }
    finally { setClaimsLoading(false); }
  }

  const visible = useMemo(() => filter === "ALL" ? bounties : bounties.filter((bounty) => bounty.status === filter), [bounties, filter]);
  const ownActiveClaim = claims.some((claim) => sameAddress(claim.hunter, session?.address) && !claim.stake_released);
  const canSubmit = selected?.accepting_claims && !ownActiveClaim;
  const walletButton = <button className="wallet-button" disabled={busy || connecting} onClick={() => session ? setSession(null) : void connect()} aria-label={session ? "Disconnect wallet" : "Connect wallet"}>
    {session ? <><span className="wallet-dot" />{shorten(session.address)}</> : connecting ? "Connecting…" : "Connect wallet"}
  </button>;
  const postButton = <a className="button primary small" href="/post">+ Post a bounty</a>;

  return <main>
    <nav className="nav shell">
      <a href="/" className="brand"><span className="brand-mark">BF</span><span>Bounty<span className="accent">Forge</span></span></a>
      <div className="nav-links">
        <a className={view === "explore" || view === "bounty" ? "active" : ""} href="/bounties">Explore</a>
        <a className={view === "post" ? "active" : ""} href="/post">Post</a>
        <a className={view === "dashboard" ? "active" : ""} href="/dashboard">Dashboard</a>
        <a href="/admin">Protocol</a>
      </div>
      {walletButton}
    </nav>

    {!ready && <div className="release-note shell" role="status">{!CONTRACT_READY ? "Contract not configured." : config ? "Contract upgrade pending. Transactions are paused." : "Checking contract…"} <a href="/admin">Protocol status ↗</a></div>}
    {!modal && <div className="shell"><ErrorNotice message={error} onDismiss={() => setError("")} /><TxNotice progress={progress} busy={busy} onCheck={() => void checkPending()} onClear={clearSavedPending} /></div>}

    {session && ready && <div className="wallet-balance shell"><span>App balance <b>{credit === null ? "Loading…" : formatGen(credit) + " GEN"}</b></span><button className="text-button" disabled={locked || credit === null || credit === 0n} onClick={() => void run(withdrawCredit, "withdraw_credit")}>Withdraw unused GEN</button></div>}
    {view === "post" && <section className="form-page shell">
      <div className="page-intro"><p className="eyebrow">CREATE BOUNTY</p><h1>Post a bounty.</h1><p className="lede">Fund one public GitHub issue and define exactly what a successful fix must do.</p></div>
      <div className="form-layout">
        <form className="form-card" aria-label="Post a bounty" onSubmit={onCreate}><fieldset disabled={locked}>
          <Field label="Bounty title"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Fix dark mode" required minLength={limit("min_title_chars", 3)} maxLength={limit("max_title_chars", 80)} /></Field>
          <Field label="GitHub issue URL"><input value={issueUrl} onChange={(event) => setIssueUrl(event.target.value)} placeholder="https://github.com/org/repo/issues/42" required type="url" maxLength={limit("max_url_chars", 200)} /><small className="hint">Public repositories only.</small></Field>
          <Field label="Acceptance criteria"><textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="What must the fix do?" required minLength={limit("min_criteria_chars", 20)} maxLength={limit("max_criteria_chars", 600)} /></Field>
          <div className="form-row"><Field label="Reward (GEN)"><input value={pot} onChange={(event) => setPot(event.target.value)} inputMode="decimal" required /><small className="hint">{config ? formatGen(config.min_pot_atto) + "–" + formatGen(config.max_pot_atto) + " GEN" : ""}</small></Field><Field label="Deadline (days)"><input value={deadline} onChange={(event) => setDeadline(event.target.value)} type="number" min={1} max={Math.floor(limit("max_deadline_secs", 31536000) / 86400)} step={1} required /></Field></div>
          <p className="form-note">Funds enter contract escrow. You can cancel only before the first claim.</p>
          {!session && <div className="connect-callout"><div><b>Connect MetaMask to fund this bounty</b><p>Use Connect wallet above. MetaMask is selected safely when other wallets are enabled.</p></div></div>}
          {fundingStep(creationCost)}
          <button className="button primary full" type="submit" disabled={writesDisabled || !hasCredit(creationCost)}>{stepTwoLabel("2 · Create bounty with 0 GEN attached", creationCost)} <span>→</span></button>
        </fieldset></form>
        <aside className="transaction-plan">
          <p className="eyebrow">SAFE FUNDING</p>
          <ol><li><b>Deposit reward</b><span>GEN becomes your recoverable BountyForge balance.</span></li><li><b>Create bounty</b><span>The non-payable call attaches 0 GEN and spends that balance.</span></li></ol>
          <p>Unused balance can be withdrawn from this page.</p>
        </aside>
      </div>
    </section>}

    {(view === "explore" || view === "dashboard") && <section className="workspace shell">
      <div className="section-heading"><div><p className="eyebrow">{view === "dashboard" ? "YOUR WORK" : "MARKETPLACE"}</p><h1 className="page-title">{view === "dashboard" ? "Your activity." : "Find your next fix."}</h1></div>{postButton}</div>
      {view === "dashboard" && <div className="feed-tabs" role="group" aria-label="Dashboard views">
        {([["sponsor", "My bounties"], ["hunter", "My claims"]] as const).map(([value, label]) => <button key={value} className={feed === value ? "active" : ""} aria-pressed={feed === value} onClick={() => { setFeed(value); setFilter("ALL"); }}>{label}</button>)}
      </div>}
      <div className="toolbar">
        <div className="filters">{feed !== "hunter" && ["ALL", "OPEN", "AWARDED", "FINALIZED", "SETTLED"].map((value) => <button key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "ALL" ? "Any status" : value.toLowerCase()}</button>)}</div>
        <span className="muted">{loading ? "Loading…" : loadedCount.current + " of " + total + " loaded"}</span>
        <button className="icon-button" aria-label="Refresh bounties" disabled={loading || busy || !CONTRACT_READY} onClick={() => { setError(""); void refresh().catch((err) => setError(friendlyError(err))); }}>↻</button>
      </div>
      <form className="bounty-lookup" onSubmit={(event) => {
        event.preventDefault();
        const id = openId.trim();
        if (!isBountyId(id)) { setError("Use a bounty ID such as bf-1."); return; }
        router.push("/bounties/" + id);
      }}>
        <label htmlFor="bounty-id">Open bounty</label><input id="bounty-id" value={openId} onChange={(event) => setOpenId(event.target.value)} placeholder="bf-123" maxLength={23} /><button className="button ghost small" disabled={!CONTRACT_READY}>Open</button>
      </form>
      <div className="bounty-grid">
        {view === "dashboard" && !session ? <Empty title="Connect your wallet" text="Your bounties and claims appear here." />
          : loading && !loadedCount.current ? <Empty title="Loading bounties…" />
          : feed === "hunter" ? activity.length ? activity.map((claim) => <a className="bounty-card" key={claim.bounty_id + ":" + claim.index} href={"/bounties/" + claim.bounty_id}>
              <div className="card-line"><StatusPill status={claim.status} /><span>{claim.bounty_id}</span></div><h3>{claim.bounty_title}</h3><p>PR #{claim.pr_number} · {claim.github_login}</p><div className="card-bottom"><span>View claim</span><span>→</span></div>
            </a>) : <Empty title="No claims yet" text="Find a bounty to get started." />
          : !visible.length ? <Empty title={!CONTRACT_READY ? "Bounties unavailable" : filter !== "ALL" ? "No matches in loaded bounties" : feed === "sponsor" ? "No bounties posted yet" : "No bounties yet"} text={filter === "ALL" ? "Post the first one." : undefined} />
          : visible.map((bounty) => <a className="bounty-card" key={bounty.id} href={"/bounties/" + bounty.id}>
              <div className="card-line"><StatusPill status={bounty.status} /><span>{bounty.id}</span></div>
              <h3>{bounty.title}</h3><p>{bounty.acceptance_criteria ?? bounty.owner_repo + " · #" + bounty.issue_number}</p>
              <div className="card-bottom"><span className="reward"><b>{formatGen(bounty.pot_atto)}</b> GEN <small>reward</small></span><span className="deadline">Due {dateLabel(bounty.deadline_unix)} <span>→</span></span></div>
            </a>)}
      </div>
      {loadedCount.current < total && <button className="button ghost load-more" disabled={loading} onClick={() => void loadFeed(false).catch((err) => setError(friendlyError(err)))}>{loading ? "Loading…" : feed === "hunter" ? "Load more claims" : "Load more bounties"}</button>}
    </section>}

    {view === "bounty" && detailLoading && !selected && <div className="shell progress" role="status">Loading bounty…</div>}
    {view === "bounty" && selected && <section className="detail shell" id="bounty-detail" aria-label="Bounty details">
      <div className="detail-main">
        <div className="detail-kicker"><a className="back" href="/bounties">← All bounties</a><span className="muted">{selected.id}</span><StatusPill status={selected.status} /></div>
        <h2>{selected.title}</h2><p className="detail-repo"><a href={selected.issue_url} target="_blank" rel="noreferrer">github.com/{selected.owner_repo} #{selected.issue_number} ↗</a></p>
        <div className="criteria"><p className="eyebrow">ACCEPTANCE CRITERIA</p><p>{selected.acceptance_criteria}</p></div>
        <div className="claims-heading"><h3>Claims <span>{claimTotal}</span></h3>{canSubmit && <button className="button primary small" disabled={!ready || locked} onClick={() => { setError(""); setModal("submit"); }}>Submit a claim</button>}</div>
        {selected.has_open_appeal && <p className="queue-note">Review paused for an appeal.</p>}
        {!session && ready && (["OPEN", "AWARDED", "FINALIZED"].includes(selected.status) || claims.some((claim) => claim.refundable)) && <p className="queue-note">Connect your wallet to continue.</p>}
        <div className="claims-list">{!claims.length ? <p className="muted">No claims yet.</p> : claims.map((claim) => <ClaimRow key={claim.index} claim={claim} address={session?.address} disabled={writesDisabled} onAction={claimAction} />)}</div>
        {claims.length < claimTotal && <button className="button ghost load-more" disabled={claimsLoading || detailLoading} onClick={() => void moreClaims()}>Load more claim history</button>}
      </div>
      <aside className="detail-side">
        <div className="reward-panel"><p className="eyebrow">BOUNTY REWARD</p><strong>{formatGen(selected.pot_atto)} <small>GEN</small></strong><p>{formatGen(selected.payout_preview_atto)} GEN after protocol fee</p><div className="side-rule" />
          <div className="side-row"><span>Deadline</span><b>{dateLabel(selected.deadline_unix, true)}</b></div>
          <div className="side-row"><span>{selected.accepting_claims ? "Slots available" : "Active claims"}</span><b>{selected.accepting_claims ? selected.claims_remaining : selected.active_claim_count} / {config?.max_claims_per_bounty ?? "—"}</b></div>
          <div className="side-row"><span>Review window</span><b>{reviewLabel}</b></div>
          <div className="side-row"><span>Appeal window</span><b>{appealLabel}</b></div>
          {selected.status === "AWARDED" && <div className="side-row"><span>Challenge until</span><b>{dateLabel(selected.challenge_deadline_unix, true)}</b></div>}
        </div>
        <BountyControls bounty={selected} address={session?.address} disabled={writesDisabled} onAction={bountyAction} onChallenge={() => { setError(""); setModal("challenge"); }} />
      </aside>
    </section>}

    {modal && <Modal title={modal === "submit" ? "Submit your claim" : "Challenge the award"} busy={busy} onClose={() => setModal(null)}>
      <ErrorNotice message={error} /><TxNotice progress={progress} busy={busy} onCheck={() => void checkPending()} onClear={clearSavedPending} />
      {!session && <div className="modal-wallet">{walletButton}</div>}
      {modal === "submit" && selected && <form onSubmit={onSubmit}><fieldset disabled={locked}>
        <div className="callout"><b>PR wallet marker</b><p>Add this line to your PR description:</p><code>BountyForge-Wallet: {session?.address ?? "your wallet address"}</code></div>
        <Field label="Pull request URL"><input value={prUrl} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/org/repo/pull/123" type="url" maxLength={limit("max_url_chars", 200)} required /><small className="hint">Repository: {selected.owner_repo}.</small></Field>
        <Field label="PR head commit SHA"><input value={headSha} onChange={(event) => setHeadSha(event.target.value)} placeholder="40-character commit SHA" minLength={40} maxLength={40} required /></Field>
        <Field label="GitHub login"><input value={githubLogin} onChange={(event) => setGithubLogin(event.target.value)} placeholder="your-github-handle" maxLength={39} required /></Field>
        <p className="form-note">Final rejections forfeit the stake. Appeal within {appealLabel}.</p>
        <details className="form-details"><summary>Evidence &amp; review limits</summary><p>Up to {config?.max_patch_files} text files and {config?.max_patch_chars} diff characters. PR description: {config?.max_pr_body_chars} characters; issue: {config?.max_issue_body_chars}. One active claim per wallet and GitHub author. Review within {reviewLabel} of your turn.</p></details>
        {fundingStep(stakeCost)}
        <button className="button primary full" type="submit" disabled={writesDisabled || !hasCredit(stakeCost) || !selected.accepting_claims}>{stepTwoLabel("2 · Submit claim · " + stakeLabel + " GEN", stakeCost)} <span>→</span></button>
      </fieldset></form>}
      {modal === "challenge" && selected && <form onSubmit={onChallenge}><fieldset disabled={locked}>
        <p className="modal-lede">Bond: {stakeLabel} GEN, returned after a decisive review. Reviews use the saved PR evidence.</p>
        <Field label="What's wrong with the award?"><textarea value={challengeStatement} onChange={(event) => setChallengeStatement(event.target.value)} minLength={limit("min_statement_chars", 10)} maxLength={limit("max_statement_chars", 600)} placeholder="Describe the gap in the fix." required /></Field>
        {fundingStep(stakeCost)}
        <button className="button danger-button full" type="submit" disabled={writesDisabled || !hasCredit(stakeCost) || !selected.challenge_open}>{stepTwoLabel("2 · Challenge award · " + stakeLabel + " GEN", stakeCost)}</button>
      </fieldset></form>}
    </Modal>}

    <footer className="footer shell"><div className="brand"><span className="brand-mark">BF</span><span>Bounty<span className="accent">Forge</span></span></div><span>StudioNet release 3.2 · GitHub work. Onchain rewards.</span><a href="/admin">Protocol status ↗</a></footer>
  </main>;
}

function Empty({ title, text }: { title: string; text?: string }) {
  return <div className="empty-state"><div className="empty-icon">✦</div><h3>{title}</h3>{text && <p>{text}</p>}</div>;
}
