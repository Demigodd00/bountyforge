import { ReactNode, useEffect, useId, useRef } from "react";
import { TxProgress, shorten } from "@/lib/contract";

const statusLabels: Record<string, string> = {
  PENDING: "Queued", REJECTED_PENDING_APPEAL: "Appeal open", REJECTED_FINAL: "Rejected",
  ACCEPTED: "Awarded", TIMED_OUT: "Timed out", INCONCLUSIVE: "Inconclusive",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={"status status-" + status.toLowerCase().replaceAll("_", "-")}>{statusLabels[status] ?? status.replaceAll("_", " ")}</span>;
}

export function dateLabel(unix: string, withTime = false): string {
  const date = new Date(Number(unix) * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return withTime ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function ErrorNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  if (!message) return null;
  return <div className="alert" role="alert">{message}{onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss error">×</button>}</div>;
}

export function TxNotice({ progress, busy, onCheck, onClear }: { progress: TxProgress; busy: boolean; onCheck: () => void; onClear?: () => void }) {
  if (!progress.label || (progress.state === "failed" && !progress.hash)) return null;
  const spinning = ["checking", "awaiting-signature", "submitted", "finalizing"].includes(progress.state);
  return <div className="progress" role="status" aria-live="polite">
    {spinning && <span className="spinner" aria-hidden="true" />}
    <span>{progress.label}</span>
    {progress.hash && <code title={progress.hash}>{shorten(progress.hash)}</code>}
    {progress.state === "unconfirmed" && <button className="text-button" type="button" disabled={busy} onClick={onCheck}>Check status</button>}
    {progress.state === "unconfirmed" && onClear && <button className="text-button danger" type="button" disabled={busy} onClick={onClear}>Clear saved check</button>}
  </div>;
}

export function Modal({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const options = useRef({ busy, onClose });
  options.current = { busy, onClose };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLElement>("input,textarea,button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !options.current.busy) options.current.onClose();
      if (event.key !== "Tab") return;
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']") ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); modalRef.current?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Close dialog">×</button></div>
      {children}
    </div>
  </div>;
}
