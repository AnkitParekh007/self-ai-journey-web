import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { RecordKind } from '@core/schemas';
import type { AppStore } from '../state/store';
import { renderMarkdown } from '../lib/markdown';

// ---------- store context ----------

export const StoreContext = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreContext missing');
  useSyncExternalStore(s.subscribe, s.getVersion);
  return s;
}

export function useRecords<T>(kind: RecordKind): T[] {
  const s = useStore();
  return useMemo(() => s.records<T>(kind), [s, s.version, kind]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- toast ----------

const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastContext.Provider value={setMsg}>
      {children}
      <div aria-live="polite" role="status">
        {msg && <div className="toast">{msg}</div>}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- primitives ----------

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'accent' | undefined;

export function Badge({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge${tone ? ` badge-${tone}` : ''}`} title={title}>
      {children}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
      {action && <div className="row" style={{ justifyContent: 'center', marginTop: '0.75rem' }}>{action}</div>}
    </div>
  );
}

export function Card({ title, sub, children, actions, id }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  const hid = useId();
  return (
    <section className="card" aria-labelledby={title ? hid : undefined} id={id}>
      {(title || actions) && (
        <div className="row" style={{ marginBottom: sub ? '0.25rem' : '0.75rem' }}>
          {title && <h2 id={hid} style={{ margin: 0 }}>{title}</h2>}
          {actions && <div className="right row">{actions}</div>}
        </div>
      )}
      {sub && <div className="card-sub">{sub}</div>}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (t: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = tabs[(i + d + tabs.length) % tabs.length];
    onChange(n.id);
    refs.current[n.id]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          role="tab"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.count !== undefined && <span className="muted"> ({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const hid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={hid} onClose={onClose} onCancel={onClose}>
      {open && (
        <>
          <div className="dialog-head">
            <h2 id={hid} style={{ margin: 0 }}>
              {title}
            </h2>
            <button className="btn btn-ghost btn-sm right" onClick={onClose} aria-label="Close dialog">
              ✕
            </button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar" role="img" aria-label={`${label}: ${value} of ${max}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copied to clipboard');
        } catch {
          toast('Clipboard unavailable: select the text and copy manually');
        }
      }}
    >
      {label}
    </button>
  );
}

export const eligTone = (s: string): Tone => (s === 'confirmed' || s === 'not_needed' ? 'ok' : s === 'ruled_out' ? 'bad' : 'warn');
export const eligLabel = (s: string) => ({ confirmed: 'confirmed', unconfirmed: 'unconfirmed', ruled_out: 'ruled out', not_needed: 'not needed' })[s] ?? s;

export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
