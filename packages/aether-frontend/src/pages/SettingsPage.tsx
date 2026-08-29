/**
 * Settings — schema-driven editor powered by omp's own SETTINGS_SCHEMA.
 *
 * Loads the settings schema (GET /api/omp/settings) plus the current values
 * (GET /api/omp/settings/values) and renders one control per setting: booleans
 * toggle, enums/optioned values pick from a select, strings/numbers edit
 * inline, and credentials get a masked input that never echoes the stored
 * value. Changes auto-save through PUT /api/omp/settings with a small
 * per-setting saved/error flash. A search box filters settings across every
 * tab. When the engine is unavailable (501), the page degrades to a neutral
 * hint plus the unaffected legacy control-plane.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getSettingsSchema,
  getSettingsValues,
  setSetting,
  type SettingDef,
  type SettingsSchema,
} from '../lib/api';

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

  let control: React.ReactNode;
  if (def.type === 'boolean') {
    const on = value === true;
    control = (
      <div className="row">
        <button
          className={`btn ${on ? 'primary' : ''}`}
          disabled={saving}
          onClick={() => onCommit(def.path, true)}
        >
          Enabled
        </button>
        <button
          className={`btn ${on ? '' : 'primary'}`}
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
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{def.label ?? def.path}</span>
          <span className="mono muted">{def.path}</span>
          {tabLabel && <span className="tag">{tabLabel}</span>}
          {credential && (
            <span className="tag" style={{ color: 'var(--yellow)', borderColor: 'var(--yellow)' }}>
              credential
            </span>
          )}
        </div>
        <div className="row">
          {saving && (
            <span className="muted" style={{ fontSize: 11 }}>
              saving…
            </span>
          )}
          {status && (
            <span
              className="mono"
              style={{ fontSize: 11, color: status.ok ? 'var(--green)' : 'var(--red)' }}
            >
              {status.ok ? 'saved' : status.msg}
            </span>
          )}
        </div>
      </div>
      {def.description && (
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
          {def.description}
        </p>
      )}
      {credential && (
        <p style={{ fontSize: 12, margin: '0 0 6px', color: 'var(--yellow)' }}>
          Secret — the stored value is never shown. Leave the field blank to keep it unchanged.
        </p>
      )}
      {control}
    </div>
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
        <h2>Settings</h2>
        <div className="card">
          <span className="muted">Loading settings…</span>
        </div>
      </>
    );
  }

  if (legacy) {
    return (
      <>
        <h2>Settings</h2>
        <div className="card" style={{ marginBottom: 12 }}>
          <h3>Live settings unavailable</h3>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
            The agent engine is not running under Bun (or the backend is unreachable):{' '}
            <span className="mono">{hint || 'engine not configured'}</span>. Omp reads its config
            from <span className="mono">~/.omp/agent/config.yml</span> on disk, so nothing here is
            required to keep running — editing is disabled on this page.
          </p>
        </div>
        <div className="card">
          <h3>Legacy behaviors (still served)</h3>
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
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Settings</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <input
          className="input"
          style={{ width: '100%' }}
          placeholder="Search settings by path, label, or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {schema && schema.tabs.length > 0 && !queryLower && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {schema.tabs.map((t) => (
            <button
              key={t.id}
              className={`btn ${tab === t.id ? 'primary' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label && t.label !== t.id ? t.label : prettyTab(t.id)}
            </button>
          ))}
        </div>
      )}

      {queryLower ? (
        <div className="stack" style={{ marginTop: 14 }}>
          {searchResults.length === 0 && (
            <div className="card">
              <span className="muted">No settings match “{query.trim()}”.</span>
            </div>
          )}
          {searchResults.map((d) => renderRow(d, tabLabelOf(schema, d.tab)))}
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 14 }}>
          {((schema?.settings.length ?? 0) === 0 ||
            (ungrouped.length === 0 && sections.length === 0)) && (
            <div className="card">
              <span className="muted">No settings exposed for this tab.</span>
            </div>
          )}
          {ungrouped.length > 0 && <div className="card">{ungrouped.map((d) => renderRow(d))}</div>}
          {sections.map((sec) => (
            <div className="card" key={sec.title}>
              <h3>{sec.title}</h3>
              <div className="stack">{sec.items.map((d) => renderRow(d))}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
