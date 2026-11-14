import { useEffect, useMemo, useState } from 'react';
import { Input, Modal, Select } from 'antd';
import { H5_EXTS } from '../constants';
import { LmActionPlot } from '../components/viewers/LmActionPlot';
import type { LmSeries } from '../components/viewers/LmActionPlot';
import { H5Viewer } from '../components/viewers/H5Viewer';
import { LmConfigPanel } from '../components/viewers/LmConfigPanel';
import type { LmConfigGroup, LmConfigValue } from '../components/viewers/LmConfigPanel';
import { LmSkillPanel } from '../components/viewers/LmSkillPanel';
import type { LmSkillBatchStats, LmSkillSample } from '../components/viewers/LmSkillPanel';
import type { FileNode, TupleMatcher, TupleViewerProps } from '../types';

// ---------------------------------------------------------------- matcher

const isH5 = (n?: FileNode) =>
  !!n && n.type === 'file' && !!n.extension && H5_EXTS.has(n.extension.toLowerCase());

/** Filenames that name themselves an LM dump. MainPanel uses this to auto-route
 *  in single-file mode; the matcher below uses it to rank candidates. The
 *  backend still validates structurally, so a mis-named file 4xx's cleanly. */
export const isLmDumpName = (name: string) => {
  const n = name.toLowerCase();
  return n.startsWith('lm_step_') || n.startsWith('step_');
};

/** Returns AT MOST ONE match: MainPanel renders a single match full-view, and
 *  two or more would box the dashboard into a 200px grid cell. */
export const lmMatcher: TupleMatcher = (files, selectedFile) => {
  if (isH5(selectedFile)) {
    return [{ label: selectedFile!.name, files: { h5: selectedFile!.path }, confidence: 1.0 }];
  }
  let first: FileNode | undefined;
  let stepped: FileNode | undefined;
  for (const f of files) {                       // single O(n) pass, no allocation
    if (!isH5(f)) continue;
    if (!first) first = f;
    if (!stepped && isLmDumpName(f.name)) stepped = f;
    if (stepped) break;
  }
  const pick = stepped ?? first;
  return pick ? [{ label: pick.name, files: { h5: pick.path }, confidence: 0.6 }] : [];
};

// ------------------------------------------------------- response contract

interface LmNormStats {
  found: boolean;
  path: string | null;
  source: string | null;
  dim: number | null;
  error: string | null;
}

interface LmCamera {
  stage: string;
  name: string;
  shape: number[];
  dtype: string;
}

interface LmCameraPair {
  original: string;
  model_input: string;
}

/** The four pinned stage tokens. `model_input` is POST-augmentation on a new
 *  dump and PRE-augmentation on an old one — never label it from the id, always
 *  from the backend's `label`/`note`. */
type LmStageId = 'original' | 'model_input' | 'model_input_preaug' | 'model_input_aug';

interface LmStageCamera {
  name: string;
  shape: number[];
  dtype: string;
}

interface LmStage {
  id: LmStageId;
  label: string;
  note: string;
  group: string;
  /** True on the stage whose frames produced output/pred_actions. */
  pred_input: boolean;
  default_on: boolean;
  cameras: LmStageCamera[];
}

/** One grid row: stage id -> camera name. A key is absent when that stage has
 *  no camera at this row index. */
type LmCameraRow = Partial<Record<LmStageId, string>>;

/** The five view-level fields generation D adds to BOTH split and batch views.
 *  Every one is optional: an older backend (or a cached response) simply omits
 *  them and the caller's `??` defaults keep today's UI. */
interface LmViewExtras {
  /** Which camera column pred_actions was sampled from, phrased by the backend.
   *  Never inferred here — see the pred/original distinction in §5 of the spec. */
  pred_note?: string | null;
  /** How dim_real was resolved: original | <split name> | dim_names | assumed_ti5. */
  dim_real_from?: string | null;
  has_original_prompt?: boolean;
  prompt_diff_count?: number | null;
  prompt_diff_rate?: number | null;
  skill?: LmSkillBatchStats | null;
}

interface LmSplitInfo extends LmViewExtras {
  name: string;
  num_samples: number;
  sample_indices: number[];
  action_mse: number | null;
  per_sample_mse: (number | null)[];
  prompt_differs: boolean[];
  horizon: number | null;
  dim_padded: number | null;
  dim_real: number | null;
  has_output: boolean;
  has_original_state: boolean;
  has_original_actions: boolean;
  has_model_state: boolean;
  has_tokenized_prompt: boolean;
  cameras: LmCamera[];
  camera_pairs: LmCameraPair[];
  has_images_preaug: boolean;
  stages: LmStage[];
  camera_rows: LmCameraRow[];
  image_note: string;
}

/** The real per-process training batch (B >> N). On a batch-only dump it also
 *  carries pred_actions/action_mse, and from generation C an original/ image
 *  stage — so nothing here may assume "inputs and ground truth only". */
interface LmBatchInfo extends LmViewExtras {
  /** "batch" | "val_batch". The backend has always sent it; keyed UI state
   *  (the ImageGrid stage chips) must use it so the two views do not share. */
  name?: string;
  /** Per-sample original-vs-served prompt verdict. Only generation D fills it. */
  prompt_differs?: boolean[];
  local_batch_size: number;
  global_batch_size: number | null;
  process_index: number | null;
  process_count: number | null;
  device_count: number | null;
  num_samples: number;
  horizon: number | null;
  dim_padded: number | null;
  dim_real: number | null;
  /** batch/ carries its own pred_actions + action_mse in a batch-only dump. */
  has_output?: boolean;
  action_mse?: number | null;
  has_tokenized_prompt: boolean;
  has_prompt_text: boolean;
  has_model_state: boolean;
  stages: LmStage[];
  camera_rows: LmCameraRow[];
  cameras: LmCamera[];
  image_note: string;
}

/** Where the slot names on every axis, table and chip came from. `file` means the
 *  dump recorded its own state_dim_names/action_dim_names; anything else means the
 *  viewer guessed, and the header badge has to say so. */
interface LmDimNames {
  source: 'file' | 'assumed_ti5' | 'generic';
  /** FULL unsliced file lists (padded width), null unless source === 'file'. */
  state: string[] | null;
  action: string[] | null;
  padded_len: number | null;
  real_len: number | null;
  note: string;
  warning: string | null;
}

interface LmInfo {
  path: string;
  name: string;
  step: number;
  /** The ROOT ATTR: the config NAME. Not the config/ group. */
  config: string;
  generation: string;
  aug_image: boolean | null;
  /** Absent on a backend that predates the dim-name probe -> no badge. */
  dim_names?: LmDimNames | null;
  /** Root skill_classes. Present without a skill/ group on a head-off dump. */
  skill_classes?: string[] | null;
  config_kv: Record<string, LmConfigValue> | null;
  config_groups: LmConfigGroup[];
  batch: LmBatchInfo | null;
  /** Held-out device batch; written whenever the run has val episodes. */
  val_batch?: LmBatchInfo | null;
  splits: LmSplitInfo[];
  norm_stats: LmNormStats;
}

interface LmTokenizedPrompt {
  length: number;
  num_nonzero: number;
  preview: number[];
}

interface LmStateT0 {
  aligned: boolean;
  raw: (number | null)[] | null;
  norm: (number | null)[] | null;
  denorm: (number | null)[] | null;
  /** Why the marker is (or is not) there — the backend built the permutation by
   *  NAME, so this is the only honest explanation of a missing marker. */
  reason?: string | null;
}

interface LmSampleData {
  split: string;
  /** "split" | "batch". Absent on an old backend -> reads as a split. */
  source: string;
  sample: number;
  num_samples: number;
  sample_index: number | null;
  step: number;
  prompt_original: string | null;
  /** Which dataset the original came from: original/prompt_text (new) or
   *  original/prompt (old split layout). Absent -> the old one. */
  prompt_original_source?: string | null;
  prompt_model: string | null;
  prompt_differs: boolean;
  tokenized_prompt: LmTokenizedPrompt | null;
  tokenized_prompt_original?: LmTokenizedPrompt | null;
  /** Provenance of action_dim_names/state_dim_names below, per sample. */
  dim_names_source?: 'file' | 'assumed_ti5' | 'generic';
  dim_names_warning?: string | null;
  dim_real_from?: string | null;
  skill?: LmSkillSample | null;
  mse: number | null;
  mse_real_dims: number | null;
  per_dim_mse: (number | null)[] | null;
  horizon: number;
  dim_real: number;
  dim_padded: number;
  /** Slot names sliced to dim_real, in FILE order — the order the model is fed.
   *  Never sorted, never re-indexed into each other: the index a user reads off
   *  the screen is the index in the h5. The two lists hold the same names in
   *  DIFFERENT positions, so pairing them by index is always wrong. */
  action_dim_names: string[];
  state_dim_names: string[];
  gt_norm: LmSeries;
  pred_norm: LmSeries | null;
  gt_denorm: LmSeries | null;
  pred_denorm: LmSeries | null;
  actions_raw: LmSeries | null;
  state_norm: (number | null)[] | null;
  state_raw: (number | null)[] | null;
  state_denorm: (number | null)[] | null;
  state_t0: LmStateT0;
  norm_stats: LmNormStats;
}

// ------------------------------------------------------------------- view
//
// One shape for "the thing being browsed", so the render path never branches on
// split-vs-batch. A split has mse/prompt-diff/sample-index arrays; the batch has
// none of those (no output/, no original/, no sample_indices) and says so with
// empty arrays instead of nulls the caller must test.

interface LmView {
  name: string;
  isBatch: boolean;
  num_samples: number;
  per_sample_mse: (number | null)[];
  prompt_differs: boolean[];
  sample_indices: number[];
  action_mse: number | null;
  horizon: number | null;
  dim_real: number | null;
  dim_padded: number | null;
  stages: LmStage[];
  camera_rows: LmCameraRow[];
  image_note: string;
  /** Backend-authored: which image column pred_actions came from. */
  pred_note: string | null;
  /** How the backend resolved dim_real on THIS view: original | <split> |
   *  dim_names | assumed_ti5 | padded. Shown in the dim badge tooltip so the
   *  slot count is never an unattributed number. */
  dim_real_from: string | null;
  /** Batch-level prompt-corruption tally. count/rate are null when the pair is
   *  absent (no original prompt recorded) — which is NOT "prompts identical". */
  has_original_prompt: boolean;
  prompt_diff_count: number | null;
  prompt_diff_rate: number | null;
  skill: LmSkillBatchStats | null;
}

/** Stages for a backend that predates the stage contract: rebuild today's two
 *  columns from camera_pairs so an old bundle/server pairing still shows images
 *  instead of an empty grid. */
function legacyStages(s: LmSplitInfo): LmStage[] {
  const cams = (id: LmStageId) =>
    (s.cameras ?? []).filter(c => c.stage === id).map(c => ({ name: c.name, shape: c.shape, dtype: c.dtype }));
  return (['original', 'model_input'] as LmStageId[]).map(id => ({
    id,
    label: id,
    note: '',
    group: `${id}/images`,
    pred_input: id === 'model_input',
    default_on: true,
    cameras: cams(id),
  }));
}

function fromSplit(s: LmSplitInfo): LmView {
  return {
    name: s.name,
    isBatch: false,
    num_samples: s.num_samples,
    per_sample_mse: s.per_sample_mse,
    prompt_differs: s.prompt_differs ?? [],
    sample_indices: s.sample_indices,
    action_mse: s.action_mse,
    horizon: s.horizon,
    dim_real: s.dim_real,
    dim_padded: s.dim_padded,
    stages: s.stages ?? legacyStages(s),
    camera_rows: s.camera_rows ?? (s.camera_pairs as LmCameraRow[]),
    image_note: s.image_note ?? '',
    pred_note: s.pred_note ?? null,
    dim_real_from: s.dim_real_from ?? null,
    has_original_prompt: s.has_original_prompt ?? (s.prompt_differs ?? []).length > 0,
    prompt_diff_count: s.prompt_diff_count ?? null,
    prompt_diff_rate: s.prompt_diff_rate ?? null,
    skill: s.skill ?? null,
  };
}

function fromBatch(b: LmBatchInfo): LmView {
  return {
    // NOT hardcoded 'batch': the ImageGrid chip state is keyed by this, so
    // batch and val_batch must not share one entry.
    name: b.name ?? 'batch',
    isBatch: true,
    num_samples: b.num_samples,
    per_sample_mse: [],
    prompt_differs: b.prompt_differs ?? [],
    sample_indices: [],
    action_mse: b.action_mse ?? null,
    horizon: b.horizon,
    dim_real: b.dim_real,
    dim_padded: b.dim_padded,
    stages: b.stages ?? [],
    camera_rows: b.camera_rows ?? [],
    image_note: b.image_note ?? '',
    pred_note: b.pred_note ?? null,
    dim_real_from: b.dim_real_from ?? null,
    has_original_prompt: b.has_original_prompt ?? false,
    prompt_diff_count: b.prompt_diff_count ?? null,
    prompt_diff_rate: b.prompt_diff_rate ?? null,
    skill: b.skill ?? null,
  };
}

// ------------------------------------------------------------- primitives

const WARN = '#e6a23c';
const ERR = '#ff6b6b';

const fmt = (v: number | null | undefined, d = 3) =>
  v == null || !isFinite(v) ? '–' : v.toFixed(d);

const btnStyle = (active: boolean, disabled?: boolean): React.CSSProperties => ({
  padding: '2px 10px',
  cursor: disabled ? 'default' : 'pointer',
  background: active ? 'var(--accent)' : 'var(--bg-secondary)',
  color: active ? '#fff' : 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  fontSize: 12,
  opacity: disabled ? 0.5 : 1,
  pointerEvents: disabled ? 'none' : 'auto',
});

function NormBadge({ ns }: { ns: LmNormStats }) {
  if (!ns.found) {
    return (
      <span style={{ color: WARN }} title={ns.error ?? undefined}>
        norm: none — normalized units only
      </span>
    );
  }
  if (ns.error) {
    return (
      <span style={{ color: WARN }} title={ns.error}>
        norm: {ns.source} — {ns.error}
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--text-secondary)' }} title={ns.path ?? undefined}>
      norm: {ns.source} ✓
    </span>
  );
}

// ------------------------------------------------------------- image grid

function CamTile({
  src,
  label,
  dims,
  stageLabel,
}: {
  src: string;
  label: string;
  dims: string;
  stageLabel: string;
}) {
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  // The tile outlives every sample/split switch (it is keyed by camera name),
  // so a one-off error must not blank it for the rest of the session.
  useEffect(() => setFailed(false), [src]);
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', padding: '2px 4px' }}>
        {label} <span style={{ opacity: 0.6 }}>{dims}</span>
      </div>
      <div
        onClick={() => !failed && setZoom(true)}
        style={{
          height: 170,
          background: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: failed ? 'default' : 'zoom-in',
          overflow: 'hidden',
        }}
      >
        {failed ? (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>frame unavailable</span>
        ) : (
          <img
            key={src}
            src={src}
            alt={label}
            onError={() => setFailed(true)}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
          />
        )}
      </div>
      <Modal
        open={zoom}
        onCancel={() => setZoom(false)}
        footer={null}
        width="80%"
        title={`${stageLabel} · ${label} ${dims}`}
      >
        <div style={{ background: '#1a1a1a', textAlign: 'center', padding: 8, overflow: 'auto' }}>
          <img src={src} alt={label} style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />
        </div>
      </Modal>
    </div>
  );
}

/** Chip state the backend dictates: which stages start visible. */
const stageDefaults = (stages: LmStage[]): Record<string, boolean> =>
  Object.fromEntries(stages.map(s => [s.id, s.default_on]));

function ImageGrid({
  apiBase,
  h5Path,
  split,
  sampleIdx,
  view,
}: {
  apiBase: string;
  h5Path: string;
  split: string;
  sampleIdx: number;
  view: LmView;
}) {
  const stages = view.stages;
  // The chip state is keyed by the stage id SET, not by the array identity: a
  // new file (or the batch view) rebuilds it from default_on, stepping samples
  // does not. Reset during render rather than in an effect, so switching split
  // never paints a frame of "no image stage selected".
  const stageKey = stages.map(s => s.id).join(',') + '|' + view.name;
  const [stagesOn, setStagesOn] = useState<Record<string, boolean>>(() => stageDefaults(stages));
  const [chipKey, setChipKey] = useState(stageKey);
  if (chipKey !== stageKey) {
    setChipKey(stageKey);
    setStagesOn(stageDefaults(stages));
  }

  const dimsOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stages) {
      for (const c of s.cameras) {
        const hw = c.shape.length >= 3 ? `${c.shape[1]}×${c.shape[2]}` : c.shape.join('×');
        m.set(`${s.id}/${c.name}`, hw);
      }
    }
    return m;
  }, [stages]);

  if (stages.length === 0) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--text-secondary)' }}>no images in this dump</div>
    );
  }

  const visible = stages.filter(s => stagesOn[s.id]);
  // The accent marks the column pred_actions was actually sampled from. It means
  // something as soon as a second column sits beside it to be confused with —
  // from generation C that second column is `original` vs a POST-augmentation
  // `model_input`, which is exactly the pair a reader would misread as in->out.
  const ambiguous = stages.length > 1;

  const url = (stage: string, camera: string) =>
    `${apiBase}/api/lm/frame?path=${encodeURIComponent(h5Path)}&split=${encodeURIComponent(split)}` +
    `&sample=${sampleIdx}&stage=${stage}&camera=${encodeURIComponent(camera)}`;

  return (
    <div style={{ padding: 4 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '2px 4px 6px' }}>
        {stages.map(s => (
          <button
            key={s.id}
            title={s.note}
            onClick={() => setStagesOn(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
            style={btnStyle(!!stagesOn[s.id])}
          >
            {s.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--text-secondary)' }}>no image stage selected</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${visible.length}, 1fr)`, gap: 2 }}>
          {visible.map(s => (
            <div key={`h-${s.id}`} title={s.note}>
              <div
                style={{
                  fontSize: 11,
                  color: s.pred_input && ambiguous ? 'var(--accent)' : 'var(--text-secondary)',
                  padding: '2px 4px 0',
                }}
              >
                {s.label}
                {s.pred_input && ambiguous && (
                  <span style={{ opacity: 0.8 }}> · pred source</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.75, padding: '0 4px 2px' }}>
                {s.note}
              </div>
            </div>
          ))}
          {view.camera_rows.map((r, ri) =>
            visible.map(s => {
              const cam = r[s.id];
              if (cam == null) {
                return (
                  <div key={`${ri}-${s.id}`}>
                    <div style={{ fontSize: 11, padding: '2px 4px' }}>&nbsp;</div>
                    <div
                      style={{
                        height: 170,
                        background: '#1a1a1a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      —
                    </div>
                  </div>
                );
              }
              return (
                <CamTile
                  key={`${ri}-${s.id}`}
                  src={url(s.id, cam)}
                  label={cam}
                  stageLabel={s.label}
                  dims={dimsOf.get(`${s.id}/${cam}`) ?? ''}
                />
              );
            })
          )}
        </div>
      )}

      <div
        style={{
          padding: '2px 8px 6px',
          fontSize: 11,
          color: view.image_note.startsWith('pred_actions') ? WARN : 'var(--text-secondary)',
        }}
      >
        {view.image_note}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- prompt panel

/** Number of leading whitespace-separated words the two prompts share. */
function commonWordPrefix(a: string[], b: string[]): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

/** Number of trailing words the two prompts share, never overlapping the shared
 *  prefix already counted. */
function commonWordSuffix(a: string[], b: string[], prefixLen: number): number {
  let k = 0;
  while (
    k < a.length - prefixLen &&
    k < b.length - prefixLen &&
    a[a.length - 1 - k] === b[b.length - 1 - k]
  )
    k++;
  return k;
}

function PromptBlock({
  label,
  text,
  prefixLen,
  suffixLen,
}: {
  label: string;
  text: string | null;
  prefixLen: number;
  suffixLen: number;
}) {
  // Highlight the EDITED span only — shared head AND shared tail are trimmed.
  // On a generation-D pair both prompts carry the same `State: …;\nAction:`
  // block and differ only in the skill clause, so a prefix-only rule would light
  // up ~90% of both strings and bury the one edit the user came to see.
  const words = text == null ? [] : text.split(/\s+/);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{label}</div>
      {text == null ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>prompt unavailable</div>
      ) : (
        <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
          {words.map((w, i) => (
            <span
              key={i}
              style={
                i >= prefixLen && i < words.length - suffixLen
                  ? { background: 'rgba(230,162,60,0.25)', color: WARN }
                  : undefined
              }
            >
              {w}{' '}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenDetails({ label, tp }: { label: string; tp: LmTokenizedPrompt }) {
  return (
    <details style={{ marginTop: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4 }}>
      <summary style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
        {label}
      </summary>
      <div style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
        {tp.length} ids, {tp.num_nonzero} non-zero
        <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{tp.preview.join(' ')}</div>
      </div>
    </details>
  );
}

/** One decimal, trailing '.0' trimmed: 57.8, 100, 0. */
const pct = (r: number) => {
  const s = (r * 100).toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
};

/** How much of the configured prompt corruption actually landed in this batch.
 *  The expected rate is NOT recomputed here — the writer already did that
 *  arithmetic into config/doc_prompt_intact, and a second formula would be a
 *  second source of truth. */
function CorruptionStrip({
  view,
  cfg,
  origSource,
}: {
  view: LmView;
  cfg: Record<string, LmConfigValue> | null;
  /** Which dataset the original prompt came from, straight off the sample. The two
   *  names mean different things (see origLabel in PromptPanel), so the tally does
   *  too — original/prompt is the bare dataset task string, not an oracle. */
  origSource: string | null;
}) {
  const n = view.prompt_differs.length;
  // A dump that records no original prompt cannot be audited. That is NOT
  // "no corruption realised" — B and C corrupt prompts just as hard as D, they
  // simply keep no oracle to diff against. Staying silent here reads as "clean".
  const auditable = view.has_original_prompt && n > 0;
  const count = view.prompt_diff_count ?? view.prompt_differs.filter(Boolean).length;
  const rate = view.prompt_diff_rate ?? (n > 0 ? count / n : 0);
  // The held-out batch is served uncorrupted by design: quoting the train-loader
  // knobs beside its 0% reads as "the augmentation silently failed".
  const heldOut = view.name === 'val_batch';
  // Generation A's original/prompt is the BARE task string; the served prompt ADDS
  // the skill clause. A 100% diff there means "the clause was appended", the exact
  // inverse of "nothing survived intact".
  const oldFormat = origSource === 'original/prompt';

  const probs: string[] = [];
  const add = (key: string, label: string) => {
    const v = cfg?.[key];
    if (v != null && !Array.isArray(v)) probs.push(`${label} ${v}`);
  };
  if (!heldOut) {
    add('aug_skill_dropout_prob', 'skill_dropout');
    add('aug_skill_swap_prob', 'skill_swap');
    add('aug_skill_time_dropout_prob', 'clock_dropout');
  }

  const intact = cfg?.doc_prompt_intact;
  const expected =
    !heldOut && typeof intact === 'string' && intact.length > 0 ? intact : null;
  // Nothing measured, nothing configured, nothing documented: an old dump with
  // no config/ at all has genuinely nothing to say here.
  if (probs.length === 0 && !expected && !auditable && !heldOut) return null;

  const line = heldOut
    ? auditable
      ? `corruption realised: ${count}/${n} — the held-out batch is served uncorrupted by design`
      : 'corruption realised: n/a — the held-out batch is served uncorrupted by design'
    : oldFormat
      ? auditable
        ? `served prompt adds the skill clause on ${count}/${n} samples — this old-format dump ` +
          'records no uncorrupted oracle, so corruption is not auditable'
        : 'corruption realised: not auditable — this view records no original prompt'
      : auditable
        ? `corruption realised: ${count}/${n} prompts differ (${pct(rate)}%) — intact ${pct(1 - rate)}%`
        : 'corruption realised: not auditable — this view records no original prompt';
  const warn = auditable && rate > 0 && !heldOut && !oldFormat;

  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ color: warn ? WARN : 'var(--text-secondary)' }}>
        {line}
        {probs.length > 0 && (
          <span style={{ color: 'var(--text-secondary)' }}> · {probs.join(' · ')}</span>
        )}
      </div>
      {expected && <div style={{ color: 'var(--text-secondary)' }}>expected: {expected}</div>}
    </div>
  );
}

function PromptPanel({
  d,
  view,
  cfg,
}: {
  d: LmSampleData;
  view: LmView | null;
  cfg: Record<string, LmConfigValue> | null;
}) {
  // Gated on DATA, never on the view kind: generation D writes an original
  // prompt into batch/ too, and generations B/C write none anywhere. A missing
  // original means the audit is impossible — it never means "identical".
  const hasOriginal = d.prompt_original != null;
  const oWords = d.prompt_original ? d.prompt_original.split(/\s+/) : null;
  const mWords = d.prompt_model ? d.prompt_model.split(/\s+/) : null;
  // No highlight at all unless both prompts exist AND actually differ.
  const differs = hasOriginal && !!oWords && !!mWords && d.prompt_differs;
  const prefix = differs ? commonWordPrefix(oWords!, mWords!) : Number.MAX_SAFE_INTEGER;
  const suffix = differs ? commonWordSuffix(oWords!, mWords!, prefix) : 0;
  const tp = d.tokenized_prompt;
  const tpo = d.tokenized_prompt_original ?? null;

  // Absent source (old backend) can only mean the old dataset name.
  const origLabel =
    d.prompt_original_source === 'original/prompt_text'
      ? 'original/prompt_text — before skill dropout / swap / clock dropout'
      : 'original/prompt — raw dataset prompt (old-format dump)';

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-color)' }}>
      {view && <CorruptionStrip view={view} cfg={cfg} origSource={d.prompt_original_source ?? null} />}
      <div style={{ fontSize: 11, color: differs ? WARN : 'var(--text-secondary)' }}>
        {hasOriginal
          ? differs
            ? 'prompt corrupted — original ≠ served'
            : 'prompt intact — original == served'
          : 'original prompt not recorded in this view — corruption cannot be audited'}
      </div>
      {hasOriginal && (
        <PromptBlock label={origLabel} text={d.prompt_original} prefixLen={prefix} suffixLen={suffix} />
      )}
      <PromptBlock
        label="model_input/prompt_text — what the model was served (decoded from tokenized_prompt; includes the State: block)"
        text={d.prompt_model}
        prefixLen={prefix}
        suffixLen={suffix}
      />
      {tp && <TokenDetails label="tokenized_prompt" tp={tp} />}
      {tpo && <TokenDetails label="tokenized_prompt (original)" tp={tpo} />}
    </div>
  );
}

// ------------------------------------------------------------ state panel

function StatePanel({ d }: { d: LmSampleData }) {
  const perDim = d.per_dim_mse;
  const top = useMemo(() => {
    if (!perDim) return [];
    return perDim
      .map((v, i) => ({ i, v }))
      .filter((r): r is { i: number; v: number } => r.v != null)
      .sort((a, b) => b.v - a.v)
      .slice(0, 8);
  }, [perDim]);

  const cell: React.CSSProperties = { padding: '1px 8px', whiteSpace: 'nowrap' };

  return (
    <div style={{ padding: '8px 12px' }}>
      <details open style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4 }}>
        <summary style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
          state @ t=0 · state_dim_names order (# = state slot)
          {/* Empty on a backend that predates the probe: silence beats asserting
              a provenance nobody told us. */}
          {d.dim_names_source === 'file'
            ? ' · names from file'
            : d.dim_names_source === 'assumed_ti5'
              ? ' · assumed ti5 layout'
              : d.dim_names_source === 'generic'
                ? ' · slots unnamed'
                : ''}
        </summary>
        <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-secondary)' }}>
          rows are in state_dim_names order — the action plot is in action_dim_names order, and the
          two lists hold the same names in different slots, so never read a row against a panel of
          the same index
          {'; '}
          {d.state_raw
            ? 'raw from original/state'
            : d.state_denorm
              ? 'raw denormalized from model_input/state (this view records no original/state)'
              : 'raw unavailable — no norm_stats resolved, showing normalized only'}
        </div>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace', width: '100%' }}>
          <thead>
            <tr style={{ color: 'var(--text-secondary)' }}>
              <th style={{ ...cell, textAlign: 'right' }}>#</th>
              <th style={{ ...cell, textAlign: 'left' }}>dim</th>
              <th style={{ ...cell, textAlign: 'right' }}>norm</th>
              <th style={{ ...cell, textAlign: 'right' }}>raw</th>
            </tr>
          </thead>
          <tbody>
            {d.state_dim_names.map((n, i) => (
              <tr key={n + i} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={{ ...cell, textAlign: 'right', color: 'var(--text-secondary)' }}>{i}</td>
                <td style={{ ...cell, color: 'var(--accent)' }}>{n}</td>
                <td style={{ ...cell, textAlign: 'right', color: 'var(--text-primary)' }}>{fmt(d.state_norm?.[i])}</td>
                <td style={{ ...cell, textAlign: 'right', color: 'var(--text-primary)' }}>
                  {fmt(d.state_raw?.[i] ?? d.state_denorm?.[i])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details style={{ marginTop: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4 }}>
        <summary style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
          per-dim mse (normalized, {d.dim_real} dims) · index = action slot
        </summary>
        {top.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: 11, color: 'var(--text-secondary)' }}>n/a</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace', width: '100%' }}>
            <tbody>
              {/* a top-8 RANKING, not a slot list — so each row prints the
                  action slot it belongs to rather than its rank. */}
              {top.map(r => (
                <tr key={r.i} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ ...cell, textAlign: 'right', color: 'var(--text-secondary)' }}>{r.i}</td>
                  <td style={{ ...cell, color: 'var(--accent)' }}>{d.action_dim_names[r.i] ?? `dim_${r.i}`}</td>
                  <td style={{ ...cell, textAlign: 'right', color: 'var(--text-primary)' }}>{fmt(r.v, 5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}

// ----------------------------------------------------------------- viewer

export function LmViewer({ match, apiBase }: TupleViewerProps) {
  const h5Path = match.files.h5;

  const [nsOverride, setNsOverride] = useState('');
  const [nsInput, setNsInput] = useState('');

  const [info, setInfo] = useState<LmInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The filename auto-route and the 0.6-confidence matcher both send .h5 files
  // here that the backend may reject structurally. Hand those to the generic
  // viewer instead of dead-ending on an error page.
  const [notLm, setNotLm] = useState(false);

  const [split, setSplit] = useState('');
  const [sampleIdx, setSampleIdx] = useState(0);

  const [sampleData, setSampleData] = useState<LmSampleData | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const [units, setUnits] = useState<'raw' | 'normalized'>('raw');
  const [showPred, setShowPred] = useState(true);
  const [selectedDims, setSelectedDims] = useState<number[]>([]);

  useEffect(() => {
    const nsQuery = nsOverride ? `&norm_stats=${encodeURIComponent(nsOverride)}` : '';
    setLoading(true);
    setError(null);
    setNotLm(false);
    setInfo(null);
    setSampleData(null);
    setSampleError(null);
    fetch(`${apiBase}/api/lm/info?path=${encodeURIComponent(h5Path)}${nsQuery}`)
      .then(r =>
        r.ok
          ? r.json()
          : r.json().then(d => {
              // Only the structural rejection means "wrong viewer"; a truncated
              // file or a path error keeps its own, clearer message.
              if (String(d.detail ?? '').startsWith('Not an LM dump')) setNotLm(true);
              return Promise.reject(new Error(d.detail || 'Failed'));
            })
      )
      .then((d: LmInfo) => {
        setInfo(d);
        // A batch-only dump has no train/val group at all.
        setSplit(d.splits[0]?.name ?? (d.batch ? 'batch' : d.val_batch ? 'val_batch' : ''));
        setSampleIdx(0);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [h5Path, apiBase, nsOverride]);

  useEffect(() => {
    if (!info || !split) return;
    const nsQuery = nsOverride ? `&norm_stats=${encodeURIComponent(nsOverride)}` : '';
    // Held arrow keys fire ~30 requests/s; without this an earlier response can
    // land last and label sample N with sample M's data.
    let stale = false;
    setSampleLoading(true);
    setSampleError(null);
    fetch(
      `${apiBase}/api/lm/sample?path=${encodeURIComponent(h5Path)}&split=${encodeURIComponent(split)}` +
        `&sample=${sampleIdx}${nsQuery}`
    )
      .then(r => (r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.detail || 'Failed')))))
      .then((d: LmSampleData) => { if (!stale) setSampleData(d); })
      .catch(e => { if (!stale) setSampleError(e.message); })
      .finally(() => { if (!stale) setSampleLoading(false); });
    return () => { stale = true; };
  }, [h5Path, apiBase, split, sampleIdx, nsOverride, info]);

  const batchOf = (nm: string): LmBatchInfo | null =>
    nm === 'batch' ? info?.batch ?? null : nm === 'val_batch' ? info?.val_batch ?? null : null;

  const splitInfo = useMemo(
    () => info?.splits.find(s => s.name === split) ?? null,
    [info, split]
  );
  // Everything below reads `view`, never splitInfo/info.batch directly.
  const view = useMemo<LmView | null>(() => {
    const b = batchOf(split);
    if (b) return fromBatch(b);
    return splitInfo ? fromSplit(splitInfo) : null;
  }, [info, split, splitInfo]);
  const numSamples = view?.num_samples ?? 0;

  // Reset the dim selection only when the dim count changes, so stepping
  // through samples keeps the user's chosen subset.
  const dimCount = sampleData?.action_dim_names.length ?? 0;
  useEffect(() => {
    setSelectedDims(Array.from({ length: dimCount }, (_, i) => i));
  }, [dimCount]);

  // ArrowLeft/ArrowRight step samples; same input guard as App's 'f' binding.
  useEffect(() => {
    if (numSamples <= 0) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSampleIdx(s => Math.max(0, s - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSampleIdx(s => Math.min(numSamples - 1, s + 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [numSamples]);

  const maxMse = useMemo(() => {
    const vals = (view?.per_sample_mse ?? []).filter(
      (v): v is number => v != null && isFinite(v)
    );
    return vals.length ? Math.max(...vals) : 0;
  }, [view]);

  if (loading) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading LM dump…</div>;
  if (notLm) return <H5Viewer path={h5Path} name={match.label} apiBase={apiBase} />;
  if (error) return <div style={{ padding: 24, color: ERR }}>Error: {error}</div>;
  if (!info) return null;

  const d = sampleData;
  const rawGt = d ? d.gt_denorm ?? d.actions_raw : null;
  const rawAvailable = !!rawGt;
  const effUnits = rawAvailable ? units : 'normalized';
  // A prediction exists in normalized space but is only plottable in raw units
  // when norm_stats could denormalize it, so the toggle is unit-aware.
  const predSeries: LmSeries | null = d ? (effUnits === 'raw' ? d.pred_denorm : d.pred_norm) : null;
  const predExists = !!d?.pred_norm;
  const predAvailable = !!predSeries;
  const effShowPred = predAvailable && showPred;

  const plotGt: LmSeries | null = d ? (effUnits === 'raw' ? rawGt : d.gt_norm) : null;
  const plotPred: LmSeries | null = effShowPred ? predSeries : null;
  const plotStart = d
    ? effUnits === 'raw'
      ? d.state_t0.raw ?? d.state_t0.denorm
      : d.state_t0.norm
    : null;
  const unitsLabel = effUnits === 'raw' ? 'raw units (rad, m/s)' : 'normalized (q01/q99 -> ∓1)';

  // The t=0 marker is a per-value lookup BY NAME into the state vector, done by
  // the backend. When it could not be built, say why instead of dropping it
  // silently — but only when the marker is genuinely absent from the payload,
  // not when the current unit toggle simply has no series to draw.
  const t0Absent = !!d && !d.state_t0.raw && !d.state_t0.norm && !d.state_t0.denorm;
  const startPoseNote = d && !plotStart && t0Absent ? d.state_t0.reason ?? null : null;

  const batch = batchOf(split);
  const cfgGbs = info.config_kv?.global_batch_size;
  const gbsMismatch =
    batch != null &&
    typeof cfgGbs === 'number' &&
    batch.global_batch_size != null &&
    cfgGbs !== batch.global_batch_size;

  // Page is derived from the selected sample, never stored: arrow keys step by
  // one and the window follows.
  const PAGE = 256;
  const page = Math.floor(sampleIdx / PAGE);
  const pageCount = Math.max(1, Math.ceil(numSamples / PAGE));
  const pageStart = page * PAGE;
  const pageEnd = Math.min(numSamples, pageStart + PAGE);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* header */}
      <div
        style={{
          flexShrink: 0,
          padding: '4px 16px',
          borderBottom: '1px solid var(--border-color)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--text-primary)' }}>LM: {match.label}</span>
        <span title={info.config}>step {info.step}</span>
        <span>horizon {view?.horizon ?? '–'} · dim {view?.dim_real ?? '–'}</span>
        {info.dim_names && (
          // The whole point of the format change: a reader must never be unable
          // to tell "the file told me these names" from "the viewer guessed".
          <span
            style={{
              color:
                info.dim_names.warning == null && info.dim_names.source === 'file'
                  ? 'var(--text-secondary)'
                  : WARN,
            }}
            title={`${info.dim_names.warning ?? info.dim_names.note}${
              view?.dim_real_from ? ` · dim_real from ${view.dim_real_from}` : ''
            }`}
          >
            {info.dim_names.source === 'file'
              ? `dims: names from file (${info.dim_names.real_len}/${info.dim_names.padded_len})`
              : info.dim_names.source === 'assumed_ti5'
                ? 'dims: assumed ti5 layout'
                : 'dims: unnamed'}
          </span>
        )}
        <Select
          size="small"
          style={{ width: batch ? 160 : 90 }}
          value={split}
          onChange={v => {
            setSplit(v);
            setSampleIdx(0);
          }}
          options={[
            ...info.splits.map(s => ({ value: s.name, label: s.name })),
            ...(info.batch ? [{ value: 'batch', label: `batch (B=${info.batch.num_samples})` }] : []),
            ...(info.val_batch
              ? [{ value: 'val_batch', label: `val_batch (B=${info.val_batch.num_samples})` }]
              : []),
          ]}
        />
        <span>
          sample {sampleIdx}/{Math.max(0, numSamples - 1)}
          {d?.sample_index != null && ` (idx ${d.sample_index})`}
        </span>
        {batch ? (
          <>
            <span style={{ fontFamily: 'monospace' }}>
              B {batch.local_batch_size} local / {batch.global_batch_size ?? '–'} global · proc{' '}
              {batch.process_index ?? '–'}/{batch.process_count ?? '–'} · dev {batch.device_count ?? '–'}
            </span>
            {gbsMismatch && (
              <span style={{ color: WARN }}>
                global_batch_size: config {String(cfgGbs)} ≠ batch {batch.global_batch_size}
              </span>
            )}
          </>
        ) : (
          <span>action_mse {fmt(view?.action_mse, 5)}</span>
        )}
        <NormBadge ns={info.norm_stats} />
        <details>
          <summary style={{ cursor: 'pointer' }}>norm_stats</summary>
          <Input
            size="small"
            style={{ width: 420, marginTop: 4 }}
            placeholder={info.norm_stats.path ?? 'path to norm_stats.json'}
            value={nsInput}
            onChange={e => setNsInput(e.target.value)}
            onPressEnter={() => setNsOverride(nsInput.trim())}
            onBlur={() => setNsOverride(nsInput.trim())}
          />
        </details>
      </div>

      {/* the recipe: config/ attrs, or a one-liner on an old dump */}
      <LmConfigPanel config={info.config_kv} groups={info.config_groups} configName={info.config} />

      {/* sample strip */}
      <div
        style={{
          flexShrink: 0,
          padding: '4px 16px',
          display: 'flex',
          gap: 4,
          // Wrap, so a 64-sample batch is fully visible instead of running 3.6k px
          // off the right edge. A split (N=8) still fits one line, unchanged.
          flexWrap: 'wrap',
          alignContent: 'flex-start',
          // Only the batch row mixes short tiles with page controls; the split
          // row keeps today's default stretch so old dumps look untouched.
          alignItems: batch ? 'center' : undefined,
          maxHeight: batch ? 138 : undefined,
          overflowY: batch ? 'auto' : undefined,
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        {batch && pageCount > 1 && (
          <>
            <button
              disabled={page === 0}
              onClick={() => setSampleIdx(Math.max(0, (page - 1) * PAGE))}
              style={{ ...btnStyle(false, page === 0), flexShrink: 0 }}
            >
              ‹ page
            </button>
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--text-secondary)' }}>
              page {page + 1}/{pageCount}
            </span>
            <button
              disabled={page >= pageCount - 1}
              onClick={() => setSampleIdx(Math.min(numSamples - 1, (page + 1) * PAGE))}
              style={{ ...btnStyle(false, page >= pageCount - 1), flexShrink: 0 }}
            >
              page ›
            </button>
          </>
        )}
        {batch && (
          <>
            <Input
              size="small"
              style={{ width: 80, flexShrink: 0 }}
              placeholder="jump"
              onPressEnter={e => {
                const el = e.target as HTMLInputElement;
                const v = parseInt(el.value, 10);
                if (Number.isFinite(v)) setSampleIdx(Math.max(0, Math.min(numSamples - 1, v)));
              }}
            />
          </>
        )}
        {/* batch/ has no per-sample mse — index plus, when the dump recorded an
            original prompt, the corruption dot. At most PAGE tiles so B=512 does
            not build 512 nodes. */}
        {batch
          ? Array.from({ length: pageEnd - pageStart }, (_, k) => {
              const i = pageStart + k;
              const sel = i === sampleIdx;
              const corrupted = !!view?.prompt_differs[i];
              return (
                <div
                  key={i}
                  onClick={() => setSampleIdx(i)}
                  onMouseEnter={e => {
                    if (!sel) e.currentTarget.style.background = 'var(--hover-bg)';
                  }}
                  onMouseLeave={e => {
                    if (!sel) e.currentTarget.style.background = 'transparent';
                  }}
                  style={{
                    flexShrink: 0,
                    minWidth: 34,
                    textAlign: 'center',
                    padding: '2px 4px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    border: '1px solid var(--border-color)',
                    borderRadius: 3,
                    background: sel ? 'var(--accent)' : 'transparent',
                    color: sel ? '#fff' : 'var(--text-primary)',
                  }}
                  title={corrupted ? `batch sample ${i} · prompt differs` : `batch sample ${i}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                    <span>{i}</span>
                    {corrupted && (
                      <span
                        style={{ width: 6, height: 6, borderRadius: 3, background: WARN, display: 'inline-block' }}
                        title="prompt differs"
                      />
                    )}
                  </div>
                </div>
              );
            })
          : Array.from({ length: numSamples }, (_, i) => {
              const mse = view?.per_sample_mse[i] ?? null;
              const sel = i === sampleIdx;
              const pct = mse != null && maxMse > 0 ? (mse / maxMse) * 100 : 0;
              return (
                <div
                  key={i}
                  onClick={() => setSampleIdx(i)}
                  onMouseEnter={e => {
                    if (!sel) e.currentTarget.style.background = 'var(--hover-bg)';
                  }}
                  onMouseLeave={e => {
                    if (!sel) e.currentTarget.style.background = 'transparent';
                  }}
                  style={{
                    flexShrink: 0,
                    minWidth: 52,
                    padding: '2px 6px 0',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    border: '1px solid var(--border-color)',
                    borderRadius: 3,
                    background: sel ? 'var(--accent)' : 'transparent',
                    color: sel ? '#fff' : 'var(--text-primary)',
                  }}
                  title={`sample ${i} · mse ${fmt(mse, 5)}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span>{i}</span>
                    {view?.prompt_differs[i] && (
                      <span
                        style={{ width: 6, height: 6, borderRadius: 3, background: WARN, display: 'inline-block' }}
                        title="prompt differs"
                      />
                    )}
                  </div>
                  <div style={{ opacity: sel ? 0.9 : 0.7 }}>{fmt(mse)}</div>
                  <div style={{ height: 3, marginTop: 2, background: 'var(--border-color)' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#4fc3f7' }} />
                  </div>
                </div>
              );
            })}
      </div>

      {/* body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* left: images + prompts */}
        <div
          style={{
            width: '46%',
            minWidth: 380,
            overflow: 'auto',
            borderRight: '1px solid var(--border-color)',
            opacity: sampleLoading ? 0.5 : 1,
          }}
        >
          {view && (
            <ImageGrid
              apiBase={apiBase}
              h5Path={h5Path}
              split={split}
              sampleIdx={sampleIdx}
              view={view}
            />
          )}
          {d && <PromptPanel d={d} view={view} cfg={info.config_kv} />}
        </div>

        {/* right: plots + state */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {sampleError && <div style={{ padding: 24, color: ERR }}>Error: {sampleError}</div>}
          {d && (
            <div style={{ opacity: sampleLoading ? 0.5 : 1 }}>
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  background: 'var(--bg-panel)',
                  zIndex: 1,
                  padding: '6px 12px',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => setUnits('raw')}
                    style={btnStyle(effUnits === 'raw', !rawAvailable)}
                    title={rawAvailable ? undefined : 'no norm_stats and no original/actions'}
                  >
                    raw
                  </button>
                  <button onClick={() => setUnits('normalized')} style={btnStyle(effUnits === 'normalized')}>
                    normalized
                  </button>
                </div>
                {predExists && (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: predAvailable ? 'pointer' : 'default',
                      color: predAvailable ? undefined : WARN,
                    }}
                    title={predAvailable ? undefined : 'pred needs norm_stats to plot in raw units'}
                  >
                    <input
                      type="checkbox"
                      checked={effShowPred}
                      disabled={!predAvailable}
                      onChange={e => setShowPred(e.target.checked)}
                    />
                    {predAvailable ? 'pred' : 'pred — needs norm_stats; switch to normalized'}
                  </label>
                )}
                {/* gated on the DATA: a batch-only dump does carry pred_actions
                    and per-sample mse, so the view kind must not decide this. */}
                {predExists ? (
                  <span style={{ fontFamily: 'monospace' }}>
                    mse {fmt(d.mse, 5)} ({d.dim_padded}d) · {fmt(d.mse_real_dims, 5)} ({d.dim_real}d)
                  </span>
                ) : (
                  <span>
                    no pred in this dump — {d.source === 'batch' ? 'batch/' : 'this split'} has inputs
                    and ground truth only
                  </span>
                )}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* action_dim_names order, never sorted: chip k IS action slot k. */}
                  <span title={d.dim_names_warning ?? undefined}>action slots:</span>
                  <button
                    onClick={() => setSelectedDims(Array.from({ length: dimCount }, (_, i) => i))}
                    style={btnStyle(false)}
                  >
                    All
                  </button>
                  <button onClick={() => setSelectedDims([])} style={btnStyle(false)}>
                    None
                  </button>
                  {d.action_dim_names.map((n, i) => {
                    const on = selectedDims.includes(i);
                    return (
                      <span
                        key={n + i}
                        title={`action slot ${i} · ${n}`}
                        onClick={() =>
                          setSelectedDims(prev =>
                            prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort((a, b) => a - b)
                          )
                        }
                        style={{
                          padding: '1px 5px',
                          fontSize: 11,
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                          borderRadius: 3,
                          border: '1px solid var(--border-color)',
                          background: on ? 'var(--accent)' : 'transparent',
                          color: on ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        {n}
                      </span>
                    );
                  })}
                </div>
              </div>

              {plotGt && (
                <LmActionPlot
                  gt={plotGt}
                  pred={plotPred}
                  dimNames={d.action_dim_names}
                  selectedDims={selectedDims}
                  startPose={plotStart}
                  unitsLabel={unitsLabel}
                  predNote={view?.pred_note ?? undefined}
                  orderLabel="action_dim_names order — panel title is the action slot index"
                  startPoseNote={startPoseNote}
                />
              )}

              {view?.skill && <LmSkillPanel batch={view.skill} sample={d.skill ?? null} />}

              <StatePanel d={d} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
