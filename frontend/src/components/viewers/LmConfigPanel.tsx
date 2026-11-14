import { Fragment } from 'react';
import type { CSSProperties } from 'react';

/** One config attr value, already JSON-safe: the backend coerces np.bool_ / np.int64 /
 *  np.float64 / bytes, and turns non-finite floats into null. An ndarray attr
 *  (e.g. a list-valued skill_vocab) arrives as a flat array of those scalars. */
export type LmConfigValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;

/** One display group, in the backend-decided display order. */
export interface LmConfigGroup {
  /** Group label, verbatim from /api/lm/info:
   *  recipe notes | identity | schedule | model | augmentation | data | optimizer | other */
  name: string;
  /** Keys of this group, in display order. Every key is guaranteed present in `config`. */
  keys: string[];
}

export interface LmConfigPanelProps {
  /** /api/lm/info `config_kv`. null on an OLD dump (no config/ group)
   *  -> the panel renders its one-line fallback and nothing else. */
  config: Record<string, LmConfigValue> | null;
  /** /api/lm/info `config_groups`. [] when `config` is null. Render in array order. */
  groups: LmConfigGroup[];
  /** /api/lm/info `config` (the ROOT ATTR: the config NAME, e.g. "pi05_ti5-…").
   *  Always a string, "" if the dump had none. Shown in the summary line. */
  configName: string;
  /** Group names rendered with the accent rail + active-value highlighting.
   *  Default ['augmentation'] — the spec says aug_* is one of the two things to read first. */
  emphasizeGroups?: string[];
  /** Initial open state of the <details>. Default false (collapsed). */
  defaultOpen?: boolean;
  /** Group names rendered as full-width one-line-per-key prose notes instead of the
   *  two-column key/value grid. Default ['recipe notes']. */
  noteGroups?: string[];
}

// The panel is purely presentational: no fetch, no effect, no controlled state.
// <details> carries the only piece of interaction, natively.

const rootStyle: CSSProperties = {
  flexShrink: 0,
  borderBottom: '1px solid var(--border-color)',
  background: 'var(--bg-panel)',
};

const fallbackStyle: CSSProperties = {
  padding: '2px 16px',
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const summaryStyle: CSSProperties = {
  padding: '2px 16px',
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--text-secondary)',
};

const bodyStyle: CSSProperties = {
  padding: '4px 16px 8px',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 8,
};

const rowsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
  fontSize: 11,
  fontFamily: 'monospace',
  wordBreak: 'break-word',
};

const keyStyle: CSSProperties = { color: 'var(--text-secondary)' };

/** A note group spans the whole body: the doc_* values are sentences, not numbers,
 *  and a 280px column would wrap every one of them into four lines. */
const noteRootStyle: CSSProperties = {
  gridColumn: '1 / -1',
  border: '1px solid var(--border-color)',
  borderLeft: '2px solid var(--accent)',
  borderRadius: 4,
  background: 'var(--bg-secondary)',
  padding: '4px 6px',
};

const noteRowsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px minmax(0,1fr)',
  columnGap: 8,
  rowGap: 2,
  fontSize: 11,
};

const noteKeyStyle: CSSProperties = {
  color: 'var(--text-secondary)',
  fontFamily: 'monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Numbers stay readable at 11px: integers bare, 1e-5 exponential, the rest
 *  trimmed to 6 decimals. Empty strings become "" so a blank cell can never be
 *  confused with a missing key. */
const fmtVal = (v: LmConfigValue): string => {
  if (Array.isArray(v)) return v.length ? v.map(fmtVal).join(', ') : '[]';
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v);
    return a !== 0 && (a < 1e-3 || a >= 1e6) ? v.toExponential(2) : String(Number(v.toFixed(6)));
  }
  return v === '' ? '""' : v;
};

/** In an emphasized group, a value that actually does something is accented and
 *  an off/zero/empty one is dimmed — so "which augmentations are on" is one glance. */
const isActive = (v: LmConfigValue): boolean =>
  v === true ||
  (typeof v === 'number' && v !== 0) ||
  (typeof v === 'string' && v.length > 0) ||
  (Array.isArray(v) && v.length > 0);

/** The doc_* keys are one-line self-describing sentences the writer put in the dump —
 *  the single most useful thing in config/. Rendered as prose, key first with the
 *  doc_ prefix stripped, an "off" value dimmed but never hidden (its presence is
 *  information: it says that stage of the recipe ran and did nothing). */
function NoteGroup({
  group,
  config,
}: {
  group: LmConfigGroup;
  config: Record<string, LmConfigValue>;
}) {
  const keys = group.keys.filter(k => k in config);

  return (
    <div style={noteRootStyle}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3, color: 'var(--accent)' }}>
        {group.name}
      </div>
      <div style={noteRowsStyle}>
        {keys.map(k => {
          const text = fmtVal(config[k]);
          return (
            <Fragment key={k}>
              <div style={noteKeyStyle} title={k}>
                {k.startsWith('doc_') ? k.slice(4) : k}
              </div>
              <div
                style={{
                  color: 'var(--text-primary)',
                  opacity: text === 'off' ? 0.55 : 1,
                  wordBreak: 'break-word',
                }}
                title={text}
              >
                {text}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Group({
  group,
  config,
  emph,
}: {
  group: LmConfigGroup;
  config: Record<string, LmConfigValue>;
  emph: boolean;
}) {
  // Defensive: the backend never lists a key it did not emit.
  const keys = group.keys.filter(k => k in config);

  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderLeft: emph ? '2px solid var(--accent)' : '1px solid var(--border-color)',
        borderRadius: 4,
        background: 'var(--bg-secondary)',
        padding: '4px 6px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          marginBottom: 3,
          color: emph ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        {group.name}
      </div>
      <div style={rowsStyle}>
        {keys.map(k => {
          const v = config[k];
          const text = fmtVal(v);
          const valStyle: CSSProperties = emph
            ? isActive(v)
              ? { color: 'var(--accent)' }
              : { color: 'var(--text-primary)', opacity: 0.55 }
            : { color: 'var(--text-primary)' };
          return (
            <Fragment key={k}>
              <div style={keyStyle} title={k}>
                {k}
              </div>
              <div style={valStyle} title={text}>
                {text}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function LmConfigPanel({
  config,
  groups,
  configName,
  emphasizeGroups = ['augmentation'],
  defaultOpen = false,
  noteGroups = ['recipe notes'],
}: LmConfigPanelProps) {
  if (config == null) {          // == : absent (old backend) as well as null
    return (
      <div style={rootStyle}>
        <div style={fallbackStyle}>recipe: not recorded (old-format dump)</div>
      </div>
    );
  }

  // The single sentence worth seeing without opening the panel: what fraction of
  // prompts the recipe expects to survive the corruption augmentations.
  const intact = config['doc_prompt_intact'];
  const digest = typeof intact === 'string' && intact.length > 0 ? ` · ${intact}` : '';

  return (
    <div style={rootStyle}>
      <details open={defaultOpen}>
        <summary style={summaryStyle}>
          recipe · {configName} · {Object.keys(config).length} keys{digest}
        </summary>
        <div style={bodyStyle}>
          {groups.map(g =>
            noteGroups.includes(g.name) ? (
              <NoteGroup key={g.name} group={g} config={config} />
            ) : (
              <Group
                key={g.name}
                group={g}
                config={config}
                emph={emphasizeGroups.includes(g.name)}
              />
            )
          )}
        </div>
      </details>
    </div>
  );
}
