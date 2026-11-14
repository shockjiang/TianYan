import { Fragment } from 'react';
import type { CSSProperties } from 'react';

/** /api/lm/info -> batch.skill (or val_batch.skill / splits[].skill). */
export interface LmSkillBatchStats {
  num_classes: number;
  classes: string[];
  classes_warning: string | null;
  n: number;
  has_target: boolean;
  has_in_prompt: boolean;
  acc_file: number | null;
  n_supervised_file: number | null;
  n_labeled: number;
  n_ignored: number;
  n_in_prompt: number | null;
  acc_pooled: number | null;
  n_pooled: number;
  acc_evidence: number | null;
  n_evidence: number;
  acc_in_prompt: number | null;
  n_in_prompt_labeled: number;
  confusion_subset: 'evidence' | 'labeled' | null;
  confusion: number[][] | null;
  class_counts: { target: number[]; pred: number[] };
  /** Backend-authored one-liner explaining the state of the evidence subset.
   *  Rendered verbatim under the headline; never re-derived on the client. */
  evidence_note: string | null;
}

/** /api/lm/sample -> skill. */
export interface LmSkillSample {
  pred: number;
  pred_name: string;
  target: number | null;
  target_name: string | null;
  labeled: boolean;
  correct: boolean | null;
  in_prompt: boolean | null;
  logits: (number | null)[] | null;
  probs: (number | null)[] | null;
  classes: string[];
  /** softmax[pred]; null when logits are absent/non-finite. */
  pred_prob: number | null;
  /** softmax[target]; null when unlabelled or probs absent. */
  target_prob: number | null;
  /** 1-based rank of the TRUE class in the model's own distribution
   *  (1 = the model's top choice). null when unlabelled or probs absent. */
  true_rank: number | null;
}

export interface LmSkillPanelProps {
  /** Batch-level stats. Required — the caller renders nothing at all when info.*.skill is null. */
  batch: LmSkillBatchStats;
  /** The selected sample's row. null while the sample request is in flight, or on a
   *  view whose sample response carries no skill (never on a view whose batch has one). */
  sample: LmSkillSample | null;
  /** Initial open state of the <details>. Default true. */
  defaultOpen?: boolean;
}

// Purely presentational: no fetch, no effect, no controlled state. <details> carries
// the only interaction, natively.

// Same status palette as Lm.tsx / LmActionPlot.tsx — legible on both --bg-panel
// values. Everything else is a CSS var.
const OK = '#67c23a';
const BAD = '#f06292';
const WARN = '#e6a23c';
const WARN_BG = 'rgba(230,162,60,0.25)';

const IN_PROMPT_TRUE_TITLE =
  'the served prompt contained the skill clause — this row is NOT evidence';
const IN_PROMPT_FALSE_TITLE = 'the model had to infer the skill — this row is evidence';
// Fallbacks only. The caption under the headline is `batch.evidence_note`, authored by
// the backend, which knows which of the four cases this group is in. These two are the
// sentences this panel used before that field existed, kept per-branch so an older
// backend still reads correctly instead of asserting the wrong thing.
const EVIDENCE_CAPTION =
  'in-prompt frames had the answer inside the served prompt — the training loss ' +
  'excludes them, and so does the number above';
const NO_IN_PROMPT_CAPTION =
  'in_prompt not recorded — this number includes frames whose prompt contained the answer';

const pct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}%`;

const num = (v: number | null | undefined, d = 3): string =>
  v == null || !Number.isFinite(v) ? '–' : v.toFixed(d);

/** ≥.8 good, ≥.5 unremarkable, below that bad. Colour is never the only signal:
 *  the percentage itself is right there. */
const accColor = (v: number | null): string =>
  v == null ? 'var(--text-primary)' : v >= 0.8 ? OK : v >= 0.5 ? 'var(--text-primary)' : BAD;

/** K comes from num_classes, never from a hardcoded vocabulary size: the head has
 *  shipped with 4, 7, 8 and 9 classes. */
const nameOf = (classes: string[], i: number): string => classes[i] ?? `class_${i}`;

const chip = (color: string, background?: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  borderRadius: 3,
  fontSize: 11,
  whiteSpace: 'nowrap',
  border: `1px solid ${color}`,
  color,
  background: background ?? 'var(--bg-secondary)',
});

const boxStyle: CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  padding: '6px 8px',
};

const capStyle: CSSProperties = { fontSize: 11, color: 'var(--text-secondary)' };

// -------------------------------------------------------------- per sample

/** pred vs target by NAME, with the class id kept alongside so a screenshot still
 *  maps onto the confusion matrix. `unlabelled` is its own visual state — a dashed
 *  neutral chip — never a red "wrong". */
function SampleBlock({
  s,
  classes,
  k,
}: {
  s: LmSkillSample | null;
  classes: string[];
  k: number;
}) {
  const row: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    minHeight: 22, // reserved: the block must not resize when the sample lands
  };

  if (!s) {
    return (
      <div style={boxStyle}>
        <div style={{ ...row, color: 'var(--text-secondary)', fontSize: 11, opacity: 0.55 }}>
          this sample&apos;s skill row — loading…
        </div>
      </div>
    );
  }

  const predName = s.pred_name || nameOf(classes, s.pred);
  const tgtName = s.target_name ?? (s.target == null ? null : nameOf(classes, s.target));

  return (
    <div style={boxStyle}>
      <div style={row}>
        <span style={{ ...capStyle, minWidth: 42 }}>sample</span>

        <span style={chip('var(--accent)')} title={`predicted class ${s.pred}`}>
          <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>pred {s.pred}</span>
          <b style={{ fontWeight: 600 }}>{predName}</b>
        </span>

        {s.target == null ? (
          <span style={{ ...chip('var(--text-secondary)'), borderStyle: 'dashed' }}>
            no target recorded
          </span>
        ) : s.labeled ? (
          <span style={chip('var(--text-primary)')} title={`true class ${s.target}`}>
            <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>target {s.target}</span>
            <b style={{ fontWeight: 600 }}>{tgtName}</b>
          </span>
        ) : (
          <span
            style={{
              ...chip('var(--text-secondary)'),
              borderStyle: 'dashed',
              whiteSpace: 'normal',
            }}
            title="target < 0 — this frame carries no skill label"
          >
            target: unlabelled ({s.target}) — excluded from every accuracy
          </span>
        )}

        {/* Confidence, and where the TRUE class landed in the model's own ranking:
            this is what separates a confident-and-wrong prediction from a near-miss. */}
        <span
          style={chip('var(--text-secondary)')}
          title="softmax probability of the predicted class"
        >
          p(pred) {num(s.pred_prob, 3)}
        </span>
        {s.labeled && s.true_rank != null && (
          <span
            style={chip(s.true_rank === 1 ? OK : s.true_rank <= 3 ? 'var(--text-primary)' : BAD)}
            title="where the TRUE class ranked in the model's own distribution"
          >
            true class rank {s.true_rank}/{k} · p {num(s.target_prob, 3)}
          </span>
        )}

        {s.correct === true && (
          <span style={chip(OK)}>
            <b style={{ fontWeight: 700 }}>✓</b> correct
          </span>
        )}
        {s.correct === false && (
          <span style={chip(BAD)}>
            <b style={{ fontWeight: 700 }}>✗</b> wrong
          </span>
        )}

        {s.in_prompt === true && (
          <span style={chip(WARN, WARN_BG)} title={IN_PROMPT_TRUE_TITLE}>
            in_prompt: true
          </span>
        )}
        {s.in_prompt === false && (
          <span style={chip('var(--text-secondary)')} title={IN_PROMPT_FALSE_TITLE}>
            in_prompt: false
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------- probability bars

function ProbBars({ s, classes, k }: { s: LmSkillSample; classes: string[]; k: number }) {
  if (!s.probs) return null;
  const probs = s.probs;

  return (
    <div style={boxStyle}>
      <div style={{ ...capStyle, marginBottom: 3 }}>softmax over the {k} skill classes</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,132px) minmax(40px,1fr) 46px 62px',
          columnGap: 6,
          rowGap: 2,
          alignItems: 'center',
          fontSize: 11,
        }}
      >
        {Array.from({ length: k }, (_, i) => {
          const raw = probs[i];
          const p = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
          const isPred = i === s.pred;
          const isTgt = s.target != null && s.target === i;
          const nm = nameOf(classes, i);
          return (
            <Fragment key={i}>
              <div
                style={{
                  fontFamily: 'monospace',
                  color: isPred ? 'var(--accent)' : 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${i} ${nm}`}
              >
                {i} {nm}
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 2,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  // The true class is outlined, so it stays findable when the model
                  // put no probability mass on it at all.
                  boxShadow: isTgt ? `0 0 0 1px ${OK}` : undefined,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.max(0, Math.min(1, p ?? 0)) * 100}%`,
                    height: '100%',
                    background: isPred ? 'var(--accent)' : 'var(--text-secondary)',
                    opacity: isPred ? 1 : 0.45,
                  }}
                />
              </div>
              <div
                style={{ fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-primary)' }}
              >
                {num(p)}
              </div>
              <div style={{ ...capStyle, whiteSpace: 'nowrap' }}>
                {isPred && isTgt ? 'pred · target' : isPred ? 'pred' : isTgt ? 'target' : ''}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- matrix

function Confusion({
  m,
  classes,
  subset,
}: {
  m: number[][];
  classes: string[];
  subset: 'evidence' | 'labeled' | null;
}) {
  const k = m.length;
  let max = 1;
  for (const r of m) for (const c of r) if (c > max) max = c;

  const cellBase: CSSProperties = {
    position: 'relative',
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    fontSize: 10,
    borderRadius: 2,
  };

  return (
    <div style={boxStyle}>
      <div style={{ ...capStyle, marginBottom: 3 }}>
        confusion ({subset ?? 'labeled'} subset) · rows = target ↓ · cols = pred →
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `28px repeat(${k}, minmax(18px, 1fr))`,
          gap: 1,
        }}
      >
        <div />
        {Array.from({ length: k }, (_, c) => (
          <div
            key={`h${c}`}
            style={{ ...capStyle, textAlign: 'center', fontFamily: 'monospace' }}
            title={`pred ${c} ${nameOf(classes, c)}`}
          >
            {c}
          </div>
        ))}
        {Array.from({ length: k }, (_, r) => (
          <Fragment key={`r${r}`}>
            <div
              style={{ ...capStyle, textAlign: 'right', fontFamily: 'monospace', lineHeight: '18px' }}
              title={`target ${r} ${nameOf(classes, r)}`}
            >
              {r}
            </div>
            {Array.from({ length: k }, (_, c) => {
              const v = m[r]?.[c] ?? 0;
              return (
                <div
                  key={`c${r}-${c}`}
                  style={{
                    ...cellBase,
                    background: 'var(--bg-primary)',
                    boxShadow: r === c ? 'inset 0 0 0 1px var(--text-secondary)' : undefined,
                  }}
                  title={`target ${nameOf(classes, r)} → pred ${nameOf(classes, c)}: ${v}`}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'var(--accent)',
                      opacity: (v / max) * 0.8,
                      borderRadius: 2,
                    }}
                  />
                  <span style={{ position: 'relative', color: 'var(--text-primary)' }}>
                    {v === 0 ? '' : v}
                  </span>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------ prediction counts

/** The only aggregate available when the dump carries no targets. */
function PredCounts({ counts, classes, k }: { counts: number[]; classes: string[]; k: number }) {
  let max = 1;
  for (const c of counts) if (c > max) max = c;

  return (
    <div style={boxStyle}>
      <div style={{ ...capStyle, marginBottom: 3 }}>no skill targets in this dump — predictions only</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,132px) minmax(40px,1fr) 46px',
          columnGap: 6,
          rowGap: 2,
          alignItems: 'center',
          fontSize: 11,
        }}
      >
        {Array.from({ length: k }, (_, i) => {
          const v = counts[i] ?? 0;
          const nm = nameOf(classes, i);
          return (
            <Fragment key={i}>
              <div
                style={{
                  fontFamily: 'monospace',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${i} ${nm}`}
              >
                {i} {nm}
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 2,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(v / max) * 100}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    opacity: 0.8,
                  }}
                />
              </div>
              <div
                style={{ fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-primary)' }}
              >
                {v}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- panel

export function LmSkillPanel({ batch, sample, defaultOpen = true }: LmSkillPanelProps) {
  // Defensive only: the caller renders nothing when the view has no skill group.
  if (!batch) return null;

  const k = batch.num_classes;
  const classes = batch.classes ?? [];

  // The headline is the honest number: accuracy where the served prompt did NOT
  // already contain the answer. `acc_file` and `acc_pooled` both include frames the
  // training loss masked out, so neither is ever promoted to the headline.
  const evidence = batch.has_target && batch.has_in_prompt;
  // Every labelled frame carried the clause in its served prompt (the real case for
  // val_batch on a generation-D dump): there IS no evidence subset. Say so in words.
  // The pooled number is NOT promoted into the headline — it would be a lie about a
  // split containing zero evidence frames.
  const noEvidence = evidence && batch.n_evidence === 0;
  const headline = evidence ? batch.acc_evidence : batch.acc_pooled;

  const summary = !batch.has_target
    ? `skill head · ${k} classes · predictions only`
    : noEvidence
      ? `skill head · ${k} classes · evidence acc n/a (0 of ${batch.n_labeled} labelled frames)`
      : evidence
        ? `skill head · ${k} classes · evidence acc ${pct(batch.acc_evidence)} (${batch.n_evidence})`
        : `skill head · ${k} classes · acc ${pct(batch.acc_pooled)} (${batch.n_pooled}, in_prompt not recorded)`;

  const note = batch.evidence_note ?? (batch.has_in_prompt ? EVIDENCE_CAPTION : NO_IN_PROMPT_CAPTION);

  return (
    <div style={{ padding: '8px 12px' }}>
      <details open={defaultOpen} style={boxStyle}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
          {summary}
        </summary>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6 }}>
          {batch.classes_warning && (
            <div style={{ fontSize: 11, color: WARN }} title={batch.classes_warning}>
              {batch.classes_warning}
            </div>
          )}

          <SampleBlock s={sample} classes={classes} k={k} />

          {sample && <ProbBars s={sample} classes={classes} k={k} />}

          {batch.has_target ? (
            <div style={boxStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={capStyle}>
                  {evidence
                    ? 'skill acc (evidence: prompt did NOT contain the answer)'
                    : 'skill acc (all labelled frames)'}
                </span>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    color: noEvidence ? 'var(--text-secondary)' : accColor(headline),
                  }}
                >
                  {noEvidence ? 'n/a' : pct(headline)}
                </span>
                <span style={capStyle}>
                  {noEvidence
                    ? `· 0/${batch.n_labeled} frames had the clause withheld`
                    : evidence
                      ? `· ${batch.n_evidence}/${batch.n_labeled} frames`
                      : `· ${batch.n_pooled}/${batch.n_labeled} frames`}
                </span>
              </div>

              {/* The ONLY place the pooled / in-prompt numbers appear: labelled as what
                  they are, so neither can be mistaken for the evidence accuracy. */}
              {evidence && (
                <div style={{ fontSize: 11, color: 'var(--text-primary)', opacity: 0.65, marginTop: 3 }}>
                  in-prompt (answer was in the prompt) {pct(batch.acc_in_prompt)} (
                  {batch.n_in_prompt_labeled}) · pooled {pct(batch.acc_pooled)} ({batch.n_pooled}) ·
                  file attr acc {num(batch.acc_file, 4)}
                </div>
              )}

              <div
                style={{
                  ...capStyle,
                  marginTop: evidence ? 2 : 3,
                  color: noEvidence || !batch.has_in_prompt ? WARN : capStyle.color,
                }}
                title={note}
              >
                {note}
              </div>
            </div>
          ) : (
            <PredCounts counts={batch.class_counts?.pred ?? []} classes={classes} k={k} />
          )}

          {batch.n_ignored > 0 && (
            <div style={capStyle}>
              {batch.n_ignored} unlabelled frame(s) excluded (target &lt; 0)
            </div>
          )}

          {batch.confusion && (
            <Confusion m={batch.confusion} classes={classes} subset={batch.confusion_subset} />
          )}
        </div>
      </details>
    </div>
  );
}
