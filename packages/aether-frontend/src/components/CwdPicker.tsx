/**
 * CwdPicker — browse the host filesystem and choose a working directory.
 *
 * Backed by /api/workspaces (browse paths within configured roots). The GUI
 * uses this for sessions and loops so each one can target a different real
 * host directory. Renders a compact inline browser: current path, a parent
 * button, a scrollable list of subdirectories, and a "Use this directory"
 * action that calls back with the chosen path.
 */
import React, { useEffect, useState } from 'react';
import {
  listWorkspaces,
  browseWorkspace,
  type WorkspaceRoot,
  type WorkspaceDirEntry,
} from '../lib/api';
import { Icon } from './ui';
export interface CwdPickerProps {
  /** Currently selected working directory (shown in the header). */
  value?: string;
  /** Called when the user confirms a directory. */
  onSelect: (path: string) => void;
  /** Optional placeholder when nothing is selected yet. */
  placeholder?: string;
}

export function CwdPicker({ value, onSelect, placeholder }: CwdPickerProps) {
  const [roots, setRoots] = useState<WorkspaceRoot[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [entries, setEntries] = useState<WorkspaceDirEntry[]>([]);
  const [parent, setParent] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (path?: string) => {
    try {
      const r = await browseWorkspace(path);
      setCurrent(r.path);
      setEntries(r.entries);
      setParent(r.parent);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    listWorkspaces()
      .then((r) => setRoots(r.workspaces))
      .catch((e) => setError((e as Error).message));
  }, []);

  // Enter the browser at the first root (or the current value when it's inside
  // a root) when opened.
  const openBrowser = () => {
    setOpen(true);
    const seed =
      value &&
      (roots.some((r) => r.path === value || value.startsWith(r.path + '/')) || roots.length === 0)
        ? value
        : roots[0]?.path;
    void load(seed);
  };

  const jumpRoot = (p: string) => void load(p);
  const goUp = () => parent && void load(parent);
  const choose = () => current && onSelect(current);

  if (!open) {
    return (
      <div className="field">
        <label>Working directory {value ? '' : '(optional)'}</label>
        <div className="row" style={{ alignItems: 'center' }}>
          <div
            className="code-preview"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={value || undefined}
          >
            {value || placeholder || 'default (first workspace root)'}
          </div>
          <button className="btn" onClick={openBrowser}>
            <Icon name="folder" size={14} /> Browse
          </button>
        </div>
        {error && (
          <span className="help" role="alert" style={{ color: 'var(--error)' }}>
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="field">
      <label>Working directory</label>
      <div className="card" style={{ padding: 'var(--s-2) 10px' }}>
        <div className="row" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Roots:
          </span>
          {roots.map((r) => (
            <button key={r.path} className="btn sm" onClick={() => jumpRoot(r.path)}>
              {r.label}
            </button>
          ))}
          <div className="spacer" />
          <button className="btn sm" onClick={goUp} disabled={!parent} title="Go up one level">
            <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}>
              <Icon name="chevron-right" size={12} />
            </span>{' '}
            up
          </button>
        </div>
        <div
          className="mono muted"
          style={{ fontSize: 11, marginBottom: 4, wordBreak: 'break-all' }}
        >
          {current}
        </div>
        <div className="console" style={{ height: 140 }}>
          {entries.length === 0 && (
            <div className="meta" style={{ textAlign: 'center', padding: '8px 0' }}>
              No subdirectories
            </div>
          )}
          {entries.map((e) => (
            <div key={e.path} className="row" style={{ padding: '1px 0' }}>
              <button
                className="btn ghost"
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  justifyContent: 'flex-start',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                }}
                onClick={() => void load(e.path)}
                title={e.path}
              >
                <Icon name="folder" size={13} />{' '}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.name}
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary" onClick={choose} disabled={!current}>
            Use this directory
          </button>
          <button className="btn ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
      {error && (
        <span className="help" role="alert" style={{ color: 'var(--error)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
