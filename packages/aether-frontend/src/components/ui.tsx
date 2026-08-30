import React, { useEffect, useRef, useState } from 'react';

/**
 * Shared UI primitives + hand-authored icon set (foundation).
 *
 * This module is the frozen API every page consumes (see the redesign
 * contract): PageHeader / Card / StatCard / StatusPill / EmptyState /
 * ErrorState / Skeleton / SegmentedControl / ConfirmButton / CopyButton plus
 * the `fmtCompact` / `fmtRelative` formatters. Icons are inline stroke SVG
 * (lucide-style, `stroke="currentColor"`, 1.75 width, no fill) — never emoji —
 * so they inherit text colour and stay crisp at any size.
 */

export type StatusTone = 'ok' | 'warn' | 'error' | 'info' | 'idle' | 'running';

export type IconName =
  | 'dashboard'
  | 'sessions'
  | 'loops'
  | 'skills'
  | 'models'
  | 'providers'
  | 'agents'
  | 'settings'
  | 'plus'
  | 'trash'
  | 'search'
  | 'play'
  | 'stop'
  | 'refresh'
  | 'folder'
  | 'send'
  | 'check'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'copy'
  | 'external'
  | 'alert'
  | 'sparkles'
  | 'key'
  | 'clock'
  | 'brain'
  | 'wrench';

/** Stroke geometry per icon, drawn on a 24×24 grid. */
const ICONS: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="9.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="13.5" y="12" width="7.5" height="9" rx="1.5" />
      <rect x="3" y="16" width="7.5" height="5" rx="1.5" />
    </>
  ),
  sessions: (
    <>
      <path d="M20.5 11.6c0 3.8-3.8 6.9-8.5 6.9-1.1 0-2.2-.2-3.2-.5L4.5 19.6l1.3-3.3a6.6 6.6 0 0 1-2.3-4.7c0-3.8 3.8-6.9 8.5-6.9s8.5 3.1 8.5 6.9Z" />
      <path d="M8.5 10.5h7M8.5 13.5h4.5" />
    </>
  ),
  loops: (
    <>
      <path d="m17 2.5 3.5 3.5L17 9.5" />
      <path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13" />
      <path d="m7 21.5-3.5-3.5L7 14.5" />
      <path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13" />
    </>
  ),
  skills: (
    <>
      <path d="M12 6.6C10.6 5.5 8.6 4.9 6.5 4.9c-1.1 0-2.1.1-3 .4v12.9c.9-.3 1.9-.4 3-.4 2.1 0 4.1.6 5.5 1.7 1.4-1.1 3.4-1.7 5.5-1.7 1.1 0 2.1.1 3 .4V5.3c-.9-.3-1.9-.4-3-.4-2.1 0-4.1.6-5.5 1.7Z" />
      <path d="M12 6.6v12.9" />
    </>
  ),
  models: (
    <>
      <path d="M20.5 8.1a2 2 0 0 0-1-1.7l-6.5-3.7a2 2 0 0 0-2 0L4.5 6.4a2 2 0 0 0-1 1.7v7.8a2 2 0 0 0 1 1.7l6.5 3.7a2 2 0 0 0 2 0l6.5-3.7a2 2 0 0 0 1-1.7Z" />
      <path d="m3.7 7.2 8.3 4.7 8.3-4.7" />
      <path d="M12 21.4v-9.5" />
    </>
  ),
  providers: (
    <>
      <rect x="2.8" y="3.6" width="18.4" height="7" rx="2" />
      <rect x="2.8" y="13.4" width="18.4" height="7" rx="2" />
      <path d="M6.6 7.1h.01M6.6 16.9h.01" />
      <path d="M11 7.1h5M11 16.9h5" />
    </>
  ),
  agents: (
    <>
      <rect x="4" y="6.5" width="16" height="12.5" rx="3" />
      <path d="M12 3.2v3.3" />
      <path d="M9.3 11.5v2M14.7 11.5v2" />
      <path d="M2.6 11.5v3M21.4 11.5v3" />
      <path d="M9.8 16.2h4.4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6.5h9M17.5 6.5H20" />
      <path d="M4 12h3.5M12 12h8" />
      <path d="M4 17.5h9M17.5 17.5H20" />
      <circle cx="15.2" cy="6.5" r="2.2" />
      <circle cx="9.7" cy="12" r="2.2" />
      <circle cx="15.2" cy="17.5" r="2.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7" />
      <path d="m6.6 7 .8 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.4 7" />
      <path d="M10.4 11v6M13.6 11v6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.6" />
      <path d="m15.6 15.6 4.6 4.6" />
    </>
  ),
  play: (
    <path d="M8 5.3v13.4a.6.6 0 0 0 .92.5l10.4-6.7a.6.6 0 0 0 0-1L8.92 4.8a.6.6 0 0 0-.92.5Z" />
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  refresh: (
    <>
      <path d="M3.5 12a8.5 8.5 0 0 1 8.5-8.5c2.5 0 4.75 1.1 6.3 2.85L20.5 8.5" />
      <path d="M20.5 3.5v5h-5" />
      <path d="M20.5 12a8.5 8.5 0 0 1-8.5 8.5c-2.5 0-4.75-1.1-6.3-2.85L3.5 15.5" />
      <path d="M3.5 20.5v-5h5" />
    </>
  ),
  folder: (
    <path d="M3.5 7.2A2 2 0 0 1 5.5 5.2h3.4a2 2 0 0 1 1.68.9l1 1.5h6.92a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  ),
  send: (
    <>
      <path d="M21 3 10.6 13.4" />
      <path d="M21 3l-6.5 18-3.9-7.6L3 9.5Z" />
    </>
  ),
  check: <path d="m5 12.5 4.6 4.6L19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.6A1.6 1.6 0 0 0 13.4 4H5.6A1.6 1.6 0 0 0 4 5.6v7.8A1.6 1.6 0 0 0 5.6 15" />
    </>
  ),
  external: (
    <>
      <path d="M13.5 4.5H6.8A2.3 2.3 0 0 0 4.5 6.8v10.4a2.3 2.3 0 0 0 2.3 2.3h10.4a2.3 2.3 0 0 0 2.3-2.3V10.5" />
      <path d="M14.5 4.5H20V10" />
      <path d="m10.5 13.5 9.3-9.3" />
    </>
  ),
  alert: (
    <>
      <path d="M10.6 4.3 2.7 18a1.6 1.6 0 0 0 1.4 2.4h15.8A1.6 1.6 0 0 0 21.3 18L13.4 4.3a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 9.5v4.2" />
      <path d="M12 17.2h.01" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11.4 3.2 13.2 8l4.8 1.8-4.8 1.8-1.8 4.8L9.6 11.6 4.8 9.8 9.6 8Z" />
      <path d="m18.4 15.2.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.2" r="3.7" />
      <path d="m10.7 12.5 9.6-9.6" />
      <path d="m16.4 6.8 2.6 2.6" />
      <path d="m13.9 9.3 2.1 2.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2.1" />
    </>
  ),
  brain: (
    <>
      <path d="M12 5.4a2.6 2.6 0 0 0-5-.9A2.7 2.7 0 0 0 4.5 8a2.8 2.8 0 0 0-.7 4.5A2.7 2.7 0 0 0 5.5 17a2.7 2.7 0 0 0 3.8 2.4A2.5 2.5 0 0 0 12 21Z" />
      <path d="M12 5.4a2.6 2.6 0 0 1 5-.9A2.7 2.7 0 0 1 19.5 8a2.8 2.8 0 0 1 .7 4.5A2.7 2.7 0 0 1 18.5 17a2.7 2.7 0 0 1-3.8 2.4A2.5 2.5 0 0 1 12 21Z" />
      <path d="M12 5.4V21" />
    </>
  ),
  wrench: (
    <path d="M14.4 7.6a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.7-3.7a6 6 0 0 1-7.9 7.9l-6.8 6.8a2.1 2.1 0 0 1-3-3l6.8-6.8a6 6 0 0 1 7.9-7.9Z" />
  ),
};

/** Inline stroke icon. Always decorative by default (aria-hidden): every call
 *  site pairs it with a text label or an aria-label on the control. */
export function Icon(props: { name: IconName; size?: number }): React.ReactElement {
  const size = props.size ?? 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[props.name]}
    </svg>
  );
}

export function PageHeader(props: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="page-header">
      <div className="page-head-main">
        <h2 className="page-title">{props.title}</h2>
        {props.subtitle ? <div className="page-subtitle">{props.subtitle}</div> : null}
      </div>
      {props.actions ? <div className="actions">{props.actions}</div> : null}
    </header>
  );
}

export function Card(props: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const className = ['card', props.className].filter(Boolean).join(' ');
  const showHeader = props.title !== undefined && props.title !== null;
  return (
    <section className={className}>
      {showHeader || props.actions ? (
        <header className="card-header">
          {showHeader ? <h3 className="card-title">{props.title}</h3> : <span className="spacer" />}
          {props.actions ? <div className="actions">{props.actions}</div> : null}
        </header>
      ) : null}
      <div className="card-body">{props.children}</div>
    </section>
  );
}

export function StatCard(props: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: IconName;
  tone?: StatusTone;
}): React.ReactElement {
  const tone = props.tone ?? 'idle';
  return (
    <div className="stat">
      {props.icon ? (
        <span className={`stat-tile ${tone}`}>
          <Icon name={props.icon} size={18} />
        </span>
      ) : null}
      <span className="stat-body">
        <span className="stat-label">{props.label}</span>
        <span className="stat-value">{props.value}</span>
        {props.hint ? <span className="stat-hint">{props.hint}</span> : null}
      </span>
    </div>
  );
}

/** Status chip. Tone is always paired with a text label — never colour alone. */
export function StatusPill(props: {
  tone: StatusTone;
  dot?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className={`pill ${props.tone}`}>
      {props.dot ? <span className="dot" /> : null}
      {props.children}
    </span>
  );
}

export function EmptyState(props: {
  icon?: IconName;
  title: string;
  message?: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={props.icon ?? 'sparkles'} size={28} />
      </span>
      <span className="empty-title">{props.title}</span>
      {props.message ? <span className="empty-message">{props.message}</span> : null}
      {props.action ? <span className="empty-action">{props.action}</span> : null}
    </div>
  );
}

export function ErrorState(props: {
  message: React.ReactNode;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div className="error-state" role="alert">
      <span className="empty-icon">
        <Icon name="alert" size={28} />
      </span>
      <span className="empty-title">Something went wrong</span>
      <span className="empty-message">{props.message}</span>
      {props.onRetry ? (
        <span className="empty-action">
          <button type="button" className="btn sm" onClick={props.onRetry}>
            <Icon name="refresh" size={14} />
            Retry
          </button>
        </span>
      ) : null}
    </div>
  );
}

/** Async placeholder that already occupies its final height (no layout shift). */
export function Skeleton(props: { rows?: number; className?: string }): React.ReactElement {
  const rows = Math.max(1, props.rows ?? 1);
  const cls = ['skeleton', props.className].filter(Boolean).join(' ');
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className={cls} />
      ))}
    </>
  );
}

export function SegmentedControl<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
}): React.ReactElement {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number): void => {
    const n = props.options.length;
    if (n === 0) return;
    const next = props.options[(from + delta + n) % n];
    props.onChange(next.value);
    refs.current[(from + delta + n) % n]?.focus();
  };

  return (
    <div className="seg" role="radiogroup" aria-orientation="horizontal">
      {props.options.map((opt, i) => (
        <button
          key={opt.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={opt.value === props.value}
          className={opt.value === props.value ? 'seg-btn active' : 'seg-btn'}
          tabIndex={opt.value === props.value ? 0 : -1}
          onClick={() => props.onChange(opt.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(i, -1);
            }
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Destructive action guard: first click arms the button for 3s, second confirms. */
export function ConfirmButton(props: {
  onConfirm: () => void;
  children?: React.ReactNode;
  title?: string;
  /** Icon-only confirms are announced as 'Confirm?' — screen readers need
   *  the real action ("Delete loop X"), which callers know and we don't. */
  ariaLabel?: string;
}): React.ReactElement {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  const click = (): void => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    if (!armed) {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    timer.current = undefined;
    setArmed(false);
    props.onConfirm();
  };

  return (
    <button
      type="button"
      className="btn danger sm"
      aria-label={props.ariaLabel}
      title={props.title ?? (armed ? 'Click again to confirm' : 'Click twice to confirm')}
      onClick={click}
    >
      <Icon name={armed ? 'alert' : 'trash'} size={14} />
      {armed ? 'Confirm?' : props.children}
    </button>
  );
}

/* ── Formatters ───────────────────────────────────────────────────────── */

const COMPACT_UNITS: { value: number; suffix: string }[] = [
  { value: 1e15, suffix: 'P' },
  { value: 1e12, suffix: 'T' },
  { value: 1e9, suffix: 'B' },
  { value: 1e6, suffix: 'M' },
  { value: 1e3, suffix: 'K' },
];

/** 1 000 000 → '1M', 262 144 → '262K', 950 → '950' (≤3 significant digits). */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const unit = COMPACT_UNITS.find((u) => abs >= u.value);
  if (!unit) return `${sign}${Math.round(abs)}`;
  const q = abs / unit.value;
  const text = q.toFixed(q >= 100 ? 0 : q >= 10 ? 1 : 2);
  // Drop trailing zeros so 1.00M reads as '1M' but 1.25M keeps its precision.
  return `${sign}${text.includes('.') ? text.replace(/\.?0+$/, '') : text}${unit.suffix}`;
}

/** Timestamp → coarse relative label ('1m ago'). Invalid input → '' (renders nothing). */
export function fmtRelative(input: number | string): string {
  const ts = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Seconds → coarse uptime: 42 → '42s', 429 → '7m 9s', 3725 → '1h 2m'. Invalid → ''. */
export function fmtUptime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Best-effort clipboard write: async Clipboard API with a same-document fallback. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Icon-only copy affordance with 1.2s success feedback. */
export function CopyButton(props: { text: string; title?: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async (): Promise<void> => {
    if (!(await writeClipboard(props.text))) return;
    setCopied(true);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopied(false);
      timer.current = undefined;
    }, 1200);
  };

  return (
    <button
      type="button"
      className="btn ghost sm icon"
      aria-label={props.title ?? 'Copy to clipboard'}
      title={props.title ?? 'Copy to clipboard'}
      onClick={() => {
        void copy();
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  );
}
