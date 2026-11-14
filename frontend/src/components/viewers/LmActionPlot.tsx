import { useState } from 'react';
import type { MouseEvent } from 'react';

/** Row-major [t][dim]; null = a non-finite value the backend scrubbed. */
export type LmSeries = (number | null)[][];

export interface LmActionPlotProps {
  /** Ground-truth actions, [horizon][dim]. Required. Horizon = gt.length. */
  gt: LmSeries;
  /** Predicted actions, same shape as gt. undefined/null => no output group: draw gt only. */
  pred?: LmSeries | null;
  /** One name per dim, length = dim_real, in action_dim_names order. Panel titles. */
  dimNames: string[];
  /** Dim indices to render, in this order. Empty => "no dimensions selected" placeholder. */
  selectedDims: number[];
  /** t=0 starting pose, ALREADY permuted into dim order by the backend; may contain nulls.
   *  undefined/null => no start marker. Length must equal dimNames.length. */
  startPose?: (number | null)[] | null;
  /** Units caption shown once in the legend, e.g. "raw units (rad, m/s)". */
  unitsLabel: string;
  /** Panel size in px. Defaults: 220 x 120. */
  panelWidth?: number;
  panelHeight?: number;
  /** Show the gt/pred/start legend row. Default true. */
  showLegend?: boolean;
  /** Short caption rendered after the `pred` legend chip, e.g.
   *  "pred was sampled from the pre-aug frames". Omitted/null => nothing rendered. */
  predNote?: string | null;
  /** Rendered in the legend row, e.g.
   *  "action_dim_names order — panel title is the action slot index".
   *  Omitted/null => nothing rendered. */
  orderLabel?: string | null;
  /** Why the t=0 marker is missing. Rendered in the legend ONLY when startPose is
   *  null/absent. Omitted/null => nothing rendered. */
  startPoseNote?: string | null;
}

// Palette borrowed verbatim from RgbJson.tsx's COLORS — legible on both
// --bg-panel values (#0f3460 dark / #fafafa light). Everything else is a CSS var.
const GT_COLOR = '#4fc3f7';
const PRED_COLOR = '#f06292';
const START_COLOR = '#aed581';

const CH = 5.4;           // px per char at fontSize 10
const RANGE_RESERVE = 64; // px reserved for the right-aligned "lo…hi" readout at fontSize 9

const PAD_X = 5;   // horizontal breathing room inside a panel
const HEAD_H = 14; // title + y-range readout band
const FOOT_H = 12; // hover readout band (always reserved: no layout jump on hover)

/** 3-decimal readout; '–' for the nulls the backend scrubs non-finite values into. */
function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e4)) return v.toExponential(1);
  return v.toFixed(3);
}

/** Pull dim `d` out of a row-major series; anything missing or non-finite becomes null. */
function column(series: LmSeries | null | undefined, d: number, horizon: number): (number | null)[] {
  const out: (number | null)[] = new Array(horizon);
  for (let t = 0; t < horizon; t++) {
    const row = series ? series[t] : undefined;
    const v = row ? row[d] : undefined;
    out[t] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

/** Maximal runs of finite samples, so a null breaks the line instead of bridging it. */
function runs(col: (number | null)[]): number[][] {
  const res: number[][] = [];
  let cur: number[] = [];
  for (let t = 0; t < col.length; t++) {
    if (col[t] === null) {
      if (cur.length) { res.push(cur); cur = []; }
    } else {
      cur.push(t);
    }
  }
  if (cur.length) res.push(cur);
  return res;
}

interface PanelProps {
  /** The ACTION SLOT index — what the panel title prints, and what the user reads
   *  off the screen as the dim's position in the file. */
  index: number;
  name: string;
  gtCol: (number | null)[];
  predCol: (number | null)[] | null;
  start: number | null;
  width: number;
  height: number;
  hoverT: number | null;
  onHoverT: (t: number | null) => void;
}

function Panel({ index, name, gtCol, predCol, start, width, height, hoverT, onHoverT }: PanelProps) {
  const horizon = gtCol.length;
  const top = HEAD_H;
  const bottom = height - FOOT_H;
  const innerW = width - PAD_X * 2;
  // Budget the title against the actual panel width, not a fixed 13 chars: the real
  // ti5 names are up to 16 chars and a fixed cut collapsed left_shoulder_p/r/y into
  // three identical titles.
  const prefix = `${index} · `;
  const budget = Math.max(8, Math.floor((width - PAD_X * 2 - RANGE_RESERVE - 6) / CH) - prefix.length);
  const label = prefix + (name.length > budget ? name.slice(0, budget - 1) + '…' : name);

  const frame = (
    <rect
      x={0.5}
      y={0.5}
      width={width - 1}
      height={height - 1}
      rx={3}
      fill="var(--bg-secondary)"
      stroke="var(--border-color)"
    />
  );
  const title = (
    <text x={PAD_X} y={10} fontSize={10} fill="var(--text-primary)">
      {label}
      <title>{name}</title>
    </text>
  );

  // A dim with no ground truth at all (all-null column) has nothing to scale to.
  if (!gtCol.some(v => v !== null)) {
    return (
      <svg width={width} height={height}>
        {frame}
        {title}
        <text
          x={width / 2}
          y={(top + bottom) / 2}
          fontSize={10}
          textAnchor="middle"
          fill="var(--text-secondary)"
        >
          n/a
        </text>
      </svg>
    );
  }

  // Per-panel y domain over gt + pred + start together. Never a fixed [-1,1]:
  // normalized actions provably leave it.
  let lo = Infinity;
  let hi = -Infinity;
  const acc = (v: number | null) => {
    if (v !== null) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  };
  gtCol.forEach(acc);
  if (predCol) predCol.forEach(acc);
  acc(start);

  const dataLo = lo;
  const dataHi = hi;
  let aLo = lo;
  let aHi = hi;
  if (aHi === aLo) {
    // Constant series (e.g. torso_pad0 ≡ 0): a ±0.5 window, never a zero divide.
    aLo -= 0.5;
    aHi += 0.5;
  } else {
    const pad = (aHi - aLo) * 0.05;
    aLo -= pad;
    aHi += pad;
  }

  const xAt = (t: number) => (horizon > 1 ? PAD_X + (t / (horizon - 1)) * innerW : PAD_X + innerW / 2);
  const yAt = (v: number) => bottom - ((v - aLo) / (aHi - aLo)) * (bottom - top);

  const series = (col: (number | null)[], color: string, dash?: string) =>
    runs(col).map((run, k) => {
      if (run.length === 1) {
        const t = run[0];
        return <circle key={k} cx={xAt(t)} cy={yAt(col[t] as number)} r={2} fill={color} />;
      }
      const pts = run
        .map(t => `${xAt(t).toFixed(1)},${yAt(col[t] as number).toFixed(1)}`)
        .join(' ');
      return (
        <polyline
          key={k}
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={dash}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      );
    });

  const zeroVisible = aLo <= 0 && aHi >= 0;
  const hovering = hoverT !== null && hoverT >= 0 && hoverT < horizon;
  const hoverGt = hovering ? gtCol[hoverT as number] : null;
  const hoverPred = hovering && predCol ? predCol[hoverT as number] : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rx = ((e.clientX - rect.left) * width) / rect.width;
    const t = horizon > 1 ? Math.round(((rx - PAD_X) / innerW) * (horizon - 1)) : 0;
    onHoverT(Math.max(0, Math.min(horizon - 1, t)));
  };

  return (
    <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => onHoverT(null)}>
      {frame}
      {title}
      <text x={width - PAD_X} y={10} fontSize={9} textAnchor="end" fill="var(--text-secondary)">
        {fmt(dataLo)}…{fmt(dataHi)}
      </text>

      {zeroVisible && (
        <line
          x1={PAD_X}
          y1={yAt(0)}
          x2={width - PAD_X}
          y2={yAt(0)}
          stroke="var(--border-color)"
          strokeDasharray="2 3"
        />
      )}

      {start !== null && (
        <line
          x1={PAD_X}
          y1={yAt(start)}
          x2={width - PAD_X}
          y2={yAt(start)}
          stroke={START_COLOR}
          strokeOpacity={0.35}
          strokeDasharray="1 4"
        />
      )}

      {series(gtCol, GT_COLOR)}
      {predCol && series(predCol, PRED_COLOR, '4 3')}

      {start !== null && <circle cx={xAt(0)} cy={yAt(start)} r={3} fill={START_COLOR} />}

      {hovering && (
        <>
          <line
            x1={xAt(hoverT as number)}
            y1={top}
            x2={xAt(hoverT as number)}
            y2={bottom}
            stroke="var(--text-secondary)"
            strokeOpacity={0.5}
          />
          {hoverGt !== null && (
            <circle cx={xAt(hoverT as number)} cy={yAt(hoverGt)} r={2} fill={GT_COLOR} />
          )}
          {hoverPred !== null && (
            <circle cx={xAt(hoverT as number)} cy={yAt(hoverPred)} r={2} fill={PRED_COLOR} />
          )}
          <text
            x={PAD_X}
            y={height - 3}
            fontSize={9}
            fontFamily="monospace"
            fill="var(--text-secondary)"
          >
            t={hoverT} gt={fmt(hoverGt)}
            {predCol ? ` pred=${fmt(hoverPred)}` : ''}
          </text>
        </>
      )}
    </svg>
  );
}

function LegendMark({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width={18} height={8} style={{ flexShrink: 0 }}>
      <line x1={0} y1={4} x2={18} y2={4} stroke={color} strokeWidth={1.5} strokeDasharray={dash} />
    </svg>
  );
}

export function LmActionPlot({
  gt,
  pred,
  dimNames,
  selectedDims,
  startPose,
  unitsLabel,
  panelWidth = 220,
  panelHeight = 120,
  showLegend = true,
  predNote,
  orderLabel,
  startPoseNote,
}: LmActionPlotProps) {
  const [hoverT, setHoverT] = useState<number | null>(null);

  if (gt.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 12 }}>No action data</div>;
  }

  const horizon = gt.length;
  // Panel count is bounded by BOTH the names and the actual width of a gt row.
  const nDims = Math.min(dimNames.length, gt[0] ? gt[0].length : 0);
  const dims = selectedDims.filter(d => Number.isInteger(d) && d >= 0 && d < nDims);

  if (dims.length === 0) {
    return (
      <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 12 }}>
        No dimensions selected
      </div>
    );
  }

  const hover = hoverT !== null && hoverT < horizon ? hoverT : null;

  return (
    <div style={{ padding: 8 }}>
      {showLegend && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 11,
            color: 'var(--text-primary)',
            paddingBottom: 6,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <LegendMark color={GT_COLOR} /> gt
          </span>
          {pred && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <LegendMark color={PRED_COLOR} dash="4 3" /> pred
            </span>
          )}
          {pred && predNote && (
            <span style={{ color: 'var(--text-secondary)' }}>{predNote}</span>
          )}
          {startPose ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width={18} height={8} style={{ flexShrink: 0 }}>
                <circle cx={9} cy={4} r={3} fill={START_COLOR} />
              </svg>
              state t=0
            </span>
          ) : startPoseNote ? (
            <span style={{ color: 'var(--text-secondary)' }}>{startPoseNote}</span>
          ) : null}
          <span style={{ color: 'var(--text-secondary)' }}>{unitsLabel}</span>
          {orderLabel && <span style={{ color: 'var(--text-secondary)' }}>{orderLabel}</span>}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {dims.map(d => {
          const sv = startPose ? startPose[d] : undefined;
          return (
            <Panel
              key={d}
              index={d}
              name={dimNames[d]}
              gtCol={column(gt, d, horizon)}
              predCol={pred ? column(pred, d, horizon) : null}
              start={typeof sv === 'number' && Number.isFinite(sv) ? sv : null}
              width={panelWidth}
              height={panelHeight}
              hoverT={hover}
              onHoverT={setHoverT}
            />
          );
        })}
      </div>
    </div>
  );
}
