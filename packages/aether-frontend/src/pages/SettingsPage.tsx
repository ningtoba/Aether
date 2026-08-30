/**
 * Settings — schema-driven editor powered by omp's own SETTINGS_SCHEMA.
 *
 * Loads the settings schema (GET /api/omp/settings) plus the current values
 * (GET /api/omp/settings/values) and renders one control per setting: booleans
 * toggle, enums/optioned values pick from a select, strings/numbers edit
 * inline, and credentials get a masked input that never echoes the stored
 * value. Changes auto-save through PUT /api/omp/settings with a small
 * per-setting saved/error flash. A search box filters settings across every
 * tab; the tab strip is a segmented row of toggle buttons (every schema tab
 * stays listed, including ones with no settings). When the engine is
 * unavailable (501), the page degrades to a neutral hint plus the unaffected
 * legacy control-plane. A browser-local "API key" card (sessionStorage, session-only) lets the
 * operator authenticate this tab against a key-enforcing backend; it renders in
 * both the normal and the degraded view, since a 401 is exactly when it is needed.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getApiKey,
  getSettingsSchema,
  getSettingsValues,
  setApiKey,
  setSetting,
  type SettingDef,
  type SettingsSchema,
} from '../lib/api';
import { Card, EmptyState, Icon, PageHeader, Skeleton, StatusPill } from '../components/ui';

/** Legacy control-plane surfaces that keep working while the engine is down. */
const LEGACY_BEHAVIORS: Array<{ name: string; note: string }> = [
  { name: 'Models & sessions', note: 'ModelsPage / SessionsPage — /api/models, /api/sessions*' },
  { name: 'Loop definitions', note: 'LoopsPage — /api/loops* (engine-backed runs included)' },
  {
    name: 'Agents & providers',
    note: 'AgentsPage / ProvidersPage — /api/agents*, /api/providers*',
  },
  { name: 'Skills', note: 'SkillsPage — /api/skills' },
];

function isCredential(def: SettingDef): boolean {
  return def.credential === true || def.type === 'credential';
}

/** Tab ids come through as bare slugs (e.g. "appearance"); humanize for labels. */
function prettyTab(id: string): string {
  if (!id) return 'Misc';
  return id
    .split(/[\s._-]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function stringifyForInput(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw);
}

/** Settings whose control is a free-text/number field seeded with a live value. */
function isFreeText(def: SettingDef): boolean {
  if (isCredential(def) || def.type === 'boolean') return false;
  if (Array.isArray(def.options) && def.options.length > 0) return false;
  if (def.type === 'enum') return (def.enumValues?.length ?? 0) === 0;
  return true;
}

/** A type can be rendered as a <select> when it carries options or enum values. */
function canRenderSelect(def: SettingDef): boolean {
  if (def.type === 'boolean' || isCredential(def)) return false;
  if (Array.isArray(def.options) && def.options.length > 0) return true;
  return def.type === 'enum' && (def.enumValues?.length ?? 0) > 0;
}

function selectOptions(def: SettingDef): Array<{ value: string; label: string }> {
  if (Array.isArray(def.options) && def.options.length > 0) {
    return def.options.map((o) => ({ value: o.value, label: o.label }));
  }
  return (def.enumValues ?? []).map((v) => ({ value: v, label: v }));
}

function tabLabelOf(schema: SettingsSchema | null, tabId: string | undefined): string | undefined {
  if (!schema || !tabId) return undefined;
  const t = schema.tabs.find((x) => x.id === tabId);
  if (!t) return prettyTab(tabId);
  return t.label && t.label !== t.id ? t.label : prettyTab(t.id);
}

interface SettingRowProps {
  def: SettingDef;
  value: unknown;
  saving: boolean;
  status?: { ok: boolean; msg: string };
  draft: string | undefined;
  onChangeDraft: (path: string, v: string) => void;
  onCommit: (path: string, value: unknown) => void;
  tabLabel?: string;
}

function SettingRow({
  def,
  value,
  saving,
  status,
  draft,
  onChangeDraft,
  onCommit,
  tabLabel,
}: SettingRowProps) {
  const credential = isCredential(def);
  const shown = draft !== undefined ? draft : stringifyForInput(value);
  const name = def.label ?? def.path;

  let control: React.ReactNode;
  if (def.type === 'boolean') {
    const on = value === true;
    control = (
      <div className="seg-row" role="group" aria-label={`${name} enabled`}>
        <button
          type="button"
          className={`seg-btn ${on ? 'active' : ''}`}
          aria-pressed={on}
          disabled={saving}
          onClick={() => onCommit(def.path, true)}
        >
          Enabled
        </button>
        <button
          type="button"
          className={`seg-btn ${on ? '' : 'active'}`}
          aria-pressed={!on}
          disabled={saving}
          onClick={() => onCommit(def.path, false)}
        >
          Disabled
        </button>
      </div>
    );
  } else if (canRenderSelect(def)) {
    control = (
      <select
        className="select"
        disabled={saving}
        value={stringifyForInput(value)}
        onChange={(e) => onCommit(def.path, e.target.value)}
      >
        {selectOptions(def).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (def.type === 'number') {
    control = (
      <input
        className="input"
        type="number"
        style={{ width: '100%' }}
        disabled={saving}
        value={shown}
        onChange={(e) => onChangeDraft(def.path, e.target.value)}
        onBlur={() => {
          const t = (draft ?? '').trim();
          if (!t || Number.isNaN(Number(t))) {
            onChangeDraft(def.path, stringifyForInput(value));
            return;
          }
          // Mirror the string row's diff guard below: a blur that did not
          // change the parsed value must not fire a PUT.
          if (Number(t) === Number(value)) return;
          onCommit(def.path, Number(t));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    );
  } else if (credential) {
    control = (
      <input
        className="input"
        type="password"
        style={{ width: '100%' }}
        autoComplete="new-password"
        disabled={saving}
        placeholder="stored — leave blank to keep current"
        value={draft ?? ''}
        onChange={(e) => onChangeDraft(def.path, e.target.value)}
        onBlur={() => {
          if (draft) onCommit(def.path, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    );
  } else if (def.type === 'string' || def.type === 'enum') {
    control = (
      <input
        className="input"
        type="text"
        style={{ width: '100%' }}
        disabled={saving}
        value={shown}
        onChange={(e) => onChangeDraft(def.path, e.target.value)}
        onBlur={() => {
          if (draft !== undefined && draft !== stringifyForInput(value)) onCommit(def.path, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    );
  } else {
    // Unknown structured types (array / record / ...) edit as JSON text.
    control = (
      <input
        className="input mono"
        type="text"
        style={{ width: '100%' }}
        disabled={saving}
        value={shown}
        onChange={(e) => onChangeDraft(def.path, e.target.value)}
        onBlur={() => {
          if (draft === undefined) return;
          const t = draft.trim();
          if (!t) {
            onCommit(def.path, '');
            return;
          }
          try {
            onCommit(def.path, JSON.parse(t));
          } catch {
            onCommit(def.path, draft);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    );
  }

  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{name}</span>
          <span className="key mono">{def.path}</span>
          {tabLabel && <StatusPill tone="idle">{tabLabel}</StatusPill>}
          {credential && (
            <StatusPill tone="warn" dot>
              credential
            </StatusPill>
          )}
        </div>
        <div className="row">
          {saving && (
            <span className="muted" style={{ fontSize: 11 }}>
              saving…
            </span>
          )}
          {status &&
            (status.ok ? (
              <StatusPill tone="ok">saved</StatusPill>
            ) : (
              <span role="alert">
                <StatusPill tone="error">{status.msg}</StatusPill>
              </span>
            ))}
        </div>
      </div>
      {def.description && (
        <p className="help" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          {def.description}
        </p>
      )}
      {credential && (
        <p style={{ fontSize: 12, margin: '0 0 6px', color: 'var(--warn)' }}>
          Secret — the stored value is never shown. Leave the field blank to keep it unchanged.
        </p>
      )}
      {control}
    </div>
  );
}

/** Browser-local backend API key (sessionStorage, session-only by design). */
function ApiKeyCard() {
  const [value, setValue] = useState(() => getApiKey() ?? '');
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setFlash(null), 2800);
  }, []);

  const save = () => {
    setApiKey(value);
    setValue(getApiKey() ?? '');
    showFlash(value.trim() ? 'Saved for this browser tab' : 'API key cleared');
  };

  const clear = () => {
    setApiKey('');
    setValue('');
    showFlash('API key cleared');
  };

  const isSet = getApiKey() !== null;

  return (
    <Card title="API key">
      <div className="field" style={{ marginBottom: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              Backend API key
            </span>
            <span className="key mono">aether.apiKey</span>
            {isSet ? <StatusPill tone="ok">key set</StatusPill> : null}
          </div>
          {flash ? (
            <div className="row">
              <StatusPill tone="ok">{flash}</StatusPill>
            </div>
          ) : null}
        </div>
        <p className="help" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          Sent as <span className="mono">Authorization: Bearer …</span> on every API call and used
          to mint realtime tickets. Held in session storage only — it is cleared when this tab
          closes.
        </p>
        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            type="password"
            autoComplete="new-password"
            aria-label="Backend API key"
            placeholder={isSet ? 'stored — re-enter to replace' : 'not set'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          <button type="button" className="btn primary" onClick={save}>
            <Icon name="key" size={14} />
            Save
          </button>
          <button type="button" className="btn" onClick={clear}>
            <Icon name="close" size={14} />
            Clear
          </button>
        </div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const [schema, setSchema] = useState<SettingsSchema | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [tab, setTab] = useState('');
  const [query, setQuery] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const timersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { schema: s } = await getSettingsSchema();
        if (!alive) return;
        setSchema(s);
        setTab(s.tabs[0]?.id ?? '');
        setLegacy(false);
        try {
          const { values: v } = await getSettingsValues();
          if (alive) {
            setValues(v);
            const init: Record<string, string> = {};
            for (const d of s.settings) {
              if (isFreeText(d) && !isCredential(d)) {
                const raw = v[d.path] !== undefined ? v[d.path] : d.defaultValue;
                init[d.path] = stringifyForInput(raw);
              }
            }
            setDrafts((prev) => ({ ...init, ...prev }));
          }
        } catch {
          // Live values are optional — controls still work from defaults or typed input.
        }
      } catch (e) {
        if (!alive) return;
        const msg =
          e instanceof Error && e.message
            ? e.message
            : 'Agent engine not configured (requires Bun runtime)';
        setLegacy(true);
        setHint(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      Object.values(timersRef.current).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const flash = useCallback((path: string, ok: boolean, msg: string) => {
    setStatus((s) => ({ ...s, [path]: { ok, msg } }));
    const prev = timersRef.current[path];
    if (prev) window.clearTimeout(prev);
    timersRef.current[path] = window.setTimeout(() => {
      setStatus((s) => {
        const next = { ...s };
        delete next[path];
        return next;
      });
      delete timersRef.current[path];
    }, 2800);
  }, []);

  const commit = useCallback(
    async (path: string, value: unknown) => {
      setSaving((s) => ({ ...s, [path]: true }));
      setStatus((s) => {
        const next = { ...s };
        delete next[path];
        return next;
      });
      try {
        await setSetting(path, value);
        setValues((v) => ({ ...v, [path]: value }));
        flash(path, true, 'saved');
      } catch (e) {
        flash(path, false, e instanceof Error ? e.message : String(e));
      } finally {
        setSaving((s) => {
          const next = { ...s };
          delete next[path];
          return next;
        });
      }
    },
    [flash],
  );

  const setDraft = useCallback((path: string, v: string) => {
    setDrafts((d) => ({ ...d, [path]: v }));
  }, []);

  const liveValue = useCallback(
    (def: SettingDef): unknown => {
      if (values[def.path] !== undefined) return values[def.path];
      return def.defaultValue;
    },
    [values],
  );

  const queryLower = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!schema || !queryLower) return [];
    const q = queryLower;
    return schema.settings.filter((d) => {
      const label = (d.label ?? '').toLowerCase();
      const desc = (d.description ?? '').toLowerCase();
      return d.path.toLowerCase().includes(q) || label.includes(q) || desc.includes(q);
    });
  }, [schema, queryLower]);

  const { ungrouped, sections } = useMemo(() => {
    if (!schema)
      return {
        ungrouped: [] as SettingDef[],
        sections: [] as Array<{ title: string; items: SettingDef[] }>,
      };
    const groupsList = schema.groups?.[tab] ?? [];
    const known = new Set(groupsList);
    const ungrouped: SettingDef[] = [];
    const byGroup: Record<string, SettingDef[]> = {};
    const stray: Record<string, SettingDef[]> = {};
    for (const d of schema.settings) {
      if ((d.tab ?? '') !== tab) continue;
      if (!d.group) {
        ungrouped.push(d);
      } else if (known.has(d.group)) {
        if (!byGroup[d.group]) byGroup[d.group] = [];
        byGroup[d.group].push(d);
      } else {
        if (!stray[d.group]) stray[d.group] = [];
        stray[d.group].push(d);
      }
    }
    const sections: Array<{ title: string; items: SettingDef[] }> = groupsList
      .map((g) => ({ title: g, items: byGroup[g] ?? [] }))
      .filter((s) => s.items.length > 0);
    for (const [name, items] of Object.entries(stray)) {
      sections.push({ title: name, items });
    }
    return { ungrouped, sections };
  }, [schema, tab]);

  const renderRow = (d: SettingDef, label?: string) => (
    <SettingRow
      key={d.path}
      def={d}
      value={liveValue(d)}
      saving={Boolean(saving[d.path])}
      status={status[d.path]}
      draft={drafts[d.path]}
      onChangeDraft={setDraft}
      onCommit={commit}
      tabLabel={label}
    />
  );

  if (loading) {
    return (
      <>
        <PageHeader title="Settings" subtitle="omp SETTINGS_SCHEMA · loading…" />
        <Card>
          <Skeleton rows={6} />
        </Card>
      </>
    );
  }

  if (legacy) {
    return (
      <>
        <PageHeader title="Settings" subtitle="live engine settings unavailable" />
        <div className="stack">
          <Card title="Live settings unavailable">
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              The agent engine is not running under Bun (or the backend is unreachable):{' '}
              <span className="mono">{hint || 'engine not configured'}</span>. Omp reads its config
              from <span className="mono">~/.omp/agent/config.yml</span> on disk, so nothing here
              is required to keep running — editing is disabled on this page.
            </p>
          </Card>
          <Card title="Legacy behaviors (still served)">
            <table className="table">
              <tbody>
                {LEGACY_BEHAVIORS.map((b) => (
                  <tr key={b.name}>
                    <td style={{ width: 220 }}>{b.name}</td>
                    <td className="muted">{b.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <ApiKeyCard />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          <>
            omp SETTINGS_SCHEMA · {schema?.settings.length ?? 0} settings exposed · autosaved on
            change
          </>
        }
      />

      <div className="stack">
        <Card>
          <div className="row" style={{ gap: 'var(--s-2)' }}>
            <span className="muted" aria-hidden="true" style={{ display: 'inline-flex' }}>
              <Icon name="search" />
            </span>
            <input
              className="input"
              style={{ flex: 1 }}
              aria-label="Search settings by path, label, or description"
              placeholder="Search settings by path, label, or description…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </Card>

        {schema && schema.tabs.length > 0 && !queryLower && (
          <div
            className="seg-row"
            role="group"
            aria-label="Settings tabs"
            style={{ overflowX: 'auto', flexWrap: 'nowrap' }}
          >
            {schema.tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`seg-btn ${tab === t.id ? 'active' : ''}`}
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label && t.label !== t.id ? t.label : prettyTab(t.id)}
              </button>
            ))}
          </div>
        )}

        {queryLower ? (
          searchResults.length === 0 ? (
            <EmptyState
              icon="search"
              title="No settings match"
              message={<>Nothing matches “{query.trim()}” — try a different path, label, or keyword.</>}
              action={
                <button className="btn" onClick={() => setQuery('')}>
                  Clear search
                </button>
              }
            />
          ) : (
            <Card title={`Search results (${searchResults.length})`}>
              <div className="stack">{searchResults.map((d) => renderRow(d, tabLabelOf(schema, d.tab)))}</div>
            </Card>
          )
        ) : (
          <>
            {((schema?.settings.length ?? 0) === 0 ||
              (ungrouped.length === 0 && sections.length === 0)) && (
              <EmptyState
                icon="settings"
                title="Nothing to edit here"
                message={
                  (schema?.settings.length ?? 0) === 0
                    ? 'The engine exposes no settings through the schema endpoint.'
                    : 'No settings exposed for this tab — try another tab or search across all of them.'
                }
              />
            )}
            {ungrouped.length > 0 && (
              <Card>
                <div className="stack">{ungrouped.map((d) => renderRow(d))}</div>
              </Card>
            )}
            {sections.map((sec) => (
              <Card key={sec.title} title={sec.title}>
                <div className="stack">{sec.items.map((d) => renderRow(d))}</div>
              </Card>
            ))}
          </>
        )}
        <ApiKeyCard />
      </div>
    </>
  );
}
