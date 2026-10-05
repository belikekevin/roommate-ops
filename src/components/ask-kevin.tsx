"use client";
// "Ask Kevin" drawer. Same agent as Telegram, acting as the dashboard's selected member (POST /api/chat).
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

type Button = { text: string; url: string };
type Msg = {
  id: string;
  role: "me" | "kevin";
  text: string;
  buttons?: Button[];
  /** Server-side error detail shown under a Kevin bubble (from a non-OK { error } JSON). */
  detail?: string;
};
type Saved = { open: boolean; log: Msg[] };

const STORAGE_KEY = "kevin:ask-kevin";
const MAX_LOG = 50;
const GREETING = "Nobody cheats Kevin. What do you need, bestie? 😜";
const BUSY = "Kevin's line is busy, probably setting a trap. Try again in a sec 🙈";

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

type Reply = { text?: string; buttons?: Button[]; error?: string };

async function parseReply(res: Response): Promise<Reply | null> {
  try {
    return (await res.json()) as Reply;
  } catch {
    return null;
  }
}

function load(): Saved | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return { open: Boolean(parsed.open), log: Array.isArray(parsed.log) ? parsed.log.slice(-MAX_LOG) : [] };
  } catch {
    return null;
  }
}

function save(state: Saved) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, log: state.log.slice(-MAX_LOG) }));
  } catch {
    // storage unavailable (private mode, quota, SSR); the panel still works for this page view
  }
}

export function AskKevin({ actorName }: { actorName?: string }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Restore from sessionStorage after mount (never during SSR).
  useEffect(() => {
    const saved = load();
    if (saved) {
      setOpen(saved.open);
      setLog(saved.log);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) save({ open, log });
  }, [hydrated, open, log]);

  // Focus the box on open; keep the newest message in view.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, log, busy]);

  // Size the textarea between 1 and 3 rows.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.rows = 1;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const rows = Math.min(3, Math.max(1, Math.ceil((el.scrollHeight - 16) / line)));
    el.rows = rows;
  }, [draft, open]);

  const push = useCallback((m: Msg) => setLog((prev) => [...prev, m].slice(-MAX_LOG)), []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    push({ id: uid(), role: "me", text });
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await parseReply(res);
      if (!res.ok || !data || typeof data.text !== "string") {
        const detail = data?.error ?? `HTTP ${res.status}`;
        if (process.env.NODE_ENV !== "production") console.error("[ask-kevin]", res.status, detail);
        push({ id: uid(), role: "kevin", text: BUSY, detail });
        return;
      }
      push({ id: uid(), role: "kevin", text: data.text, buttons: data.buttons?.length ? data.buttons : undefined });
      // Kevin may have logged an expense or chore: re-render the server cards on this page.
      router.refresh();
    } catch (err) {
      if (process.env.NODE_ENV !== "production") console.error("[ask-kevin]", err);
      push({ id: uid(), role: "kevin", text: BUSY });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [draft, busy, push, router]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const transcript: Msg[] = log.length ? log : [{ id: "greeting", role: "kevin", text: GREETING }];

  return (
    <>
      <button
        type="button"
        className="ak-launcher"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="ask-kevin-panel"
      >
        Ask Kevin 😜
      </button>

      {open && (
        <section
          id="ask-kevin-panel"
          className="ak-panel"
          role="dialog"
          aria-label="Ask Kevin"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <header className="ak-head">
            <div>
              <div className="ak-title">Kevin</div>
              {actorName && <small className="muted">talking as {actorName} · this is my house, I have to defend it</small>}
            </div>
            <button type="button" className="btn-ghost ak-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </header>

          <div className="ak-log" ref={logRef} aria-live="polite">
            {transcript.map((m) => (
              <div key={m.id} className={`ak-msg ${m.role}`}>
                <div className="ak-bubble">{m.text}</div>
                {m.buttons && (
                  <div className="ak-buttons">
                    {m.buttons.map((b, i) => (
                      <a key={`${m.id}-${i}`} className="btn btn-ghost" href={b.url} target="_blank" rel="noopener noreferrer">
                        {b.text}
                      </a>
                    ))}
                  </div>
                )}
                {m.detail && <small className="ak-detail muted">{m.detail}</small>}
              </div>
            ))}
            {busy && (
              <div className="ak-msg kevin">
                <div className="ak-bubble ak-thinking">Kevin is scheming</div>
              </div>
            )}
          </div>

          <form className="ak-form" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              className="ak-input"
              rows={1}
              value={draft}
              placeholder="Ask Kevin anything, ya filthy animal…"
              aria-label="Message Kevin"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              Send
            </button>
          </form>
        </section>
      )}
    </>
  );
}
