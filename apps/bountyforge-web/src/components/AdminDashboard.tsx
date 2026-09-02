"use client";

import { useEffect, useState } from "react";
import { CONTRACT_ADDRESS, CONTRACT_READY, ProtocolConfig, friendlyError, formatDuration, formatGen, getAdminData, isCompatibleConfig, NETWORK_NAME } from "@/lib/contract";
import { ErrorNotice } from "./Ui";

export default function AdminDashboard() {
  const [data, setData] = useState<{ config: ProtocolConfig; stats: Record<string, string> } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (CONTRACT_READY) void getAdminData().then(setData).catch((err) => setError(friendlyError(err)));
  }, []);
  return <main className="admin-page">
    <nav className="nav shell"><a href="/" className="brand"><span className="brand-mark">BF</span><span>Bounty<span className="accent">Forge</span></span></a><a className="button ghost small" href="/bounties">← Back to bounties</a></nav>
    <section className="admin shell">
      <p className="eyebrow">READ-ONLY</p><h1>Protocol status.</h1><p className="lede">StudioNet contract and settings.</p>
      {!CONTRACT_READY ? <div className="empty-state"><h3>Contract not configured</h3></div>
        : error ? <ErrorNotice message={error} />
        : !data ? <div className="progress"><span className="spinner" />Loading protocol…</div>
        : <>
          <div className="release-note">{isCompatibleConfig(data.config) ? "StudioNet test release. Not for real-value funds." : "Contract upgrade pending. Transactions are paused."}</div>
          <div className="stat-grid">{[["Created", data.stats.total_created], ["Claims", data.stats.total_claims_submitted], ["Accepted", data.stats.total_accepted], ["Settled", data.stats.total_settled]].map(([label, value]) => <div className="stat-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
          <div className="admin-grid">
            <section className="admin-card"><p className="eyebrow">DEPLOYMENT</p>
              <Row label="Network" value={NETWORK_NAME} /><Row label="Contract" value={CONTRACT_ADDRESS} /><Row label="Version" value={data.config.version} />
              <Row label="Policy" value={isCompatibleConfig(data.config) ? "Verified evidence · GenLayer consensus" : "Legacy contract"} />
              <Row label="Treasury" value={data.config.treasury} /><Row label="Protocol fee" value={Number(data.config.fee_bps) / 100 + "%"} />
              {data.config.funding_model && <Row label="Funding" value="Withdrawable app balance" />}
            </section>
            <section className="admin-card"><p className="eyebrow">RULES</p>
              <Row label="Claim stake" value={formatGen(data.config.claim_stake_atto) + " GEN"} />
              <Row label="Challenge window" value={formatDuration(data.config.challenge_window_secs)} />
              <Row label="Appeal window" value={formatDuration(data.config.appeal_window_secs)} />
              {data.config.review_window_secs && <Row label="Review window" value={formatDuration(data.config.review_window_secs)} />}
              <Row label={isCompatibleConfig(data.config) ? "Active claim slots" : "Claim slots"} value={data.config.max_claims_per_bounty} />
              {data.config.max_patch_files && <Row label="Evidence limit" value={data.config.max_patch_files + " files · " + data.config.max_patch_chars + " characters"} />}
            </section>
          </div>
        </>}
    </section>
  </main>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="admin-row"><span>{label}</span><b title={value}>{value}</b></div>;
}
