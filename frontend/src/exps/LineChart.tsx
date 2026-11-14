import { useMemo, useRef, useState } from 'react';

export interface Series {
  name: string;
  color: string;
  points: [number, number][]; // [x, y], x ascending
  dashed?: boolean;
  dots?: boolean;
}

interface Props {
  series: Series[];
  height?: number;
  logY?: boolean;
  xLabel?: string;
  title?: string;
}

const PAD = { l: 58, r: 12, t: 22, b: 30 };

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const step0 = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(v);
  return out;
}

const fmt = (v: number) =>
  Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3);

/** Hand-rolled SVG line chart (TianYan uses no charting library). Hover shows the nearest x. */
export function LineChart({ series, height = 220, logY = false, xLabel = 'step', title }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // track container width without a resize library
  const measure = (el: HTMLDivElement | null) => {
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (el && Math.abs(el.clientWidth - width) > 4) setWidth(el.clientWidth);
  };

  const ty = (v: number) => (logY ? Math.log10(Math.max(v, 1e-12)) : v);
  const { x0, x1, y0, y1 } = useMemo(() => {
    const xs = series.flatMap(s => s.points.map(p => p[0]));
    const ys = series.flatMap(s => s.points.map(p => ty(p[1]))).filter(Number.isFinite);
    if (!xs.length || !ys.length) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
    lo -= pad; hi += pad;
    const a = Math.min(...xs), b = Math.max(...xs);
    return { x0: a, x1: b > a ? b : a + 1, y0: lo, y1: hi };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, logY]);

  const W = width, H = height;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - ((ty(y) - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);

  const yTicks = logY
    ? niceTicks(y0, y1, 4).map(v => 10 ** v)
    : niceTicks(y0, y1, 4);
  const xTicks = niceTicks(x0, x1, 6);

  const nearest = (s: Series, x: number) => {
    let best: [number, number] | null = null;
    for (const p of s.points) if (!best || Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
    return best;
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < PAD.l || px > W - PAD.r) return setHoverX(null);
    setHoverX(x0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0));
  };

  const empty = !series.some(s => s.points.length);
  return (
    <div ref={measure} style={{ width: '100%', position: 'relative' }}>
      {title && <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.8, marginBottom: 2 }}>{title}</div>}
      {empty ? (
        <div style={{ height, display: 'grid', placeItems: 'center', opacity: 0.5, fontSize: 12 }}>无数据</div>
      ) : (
        <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHoverX(null)} style={{ display: 'block' }}>
          {yTicks.map(v => (
            <g key={`y${v}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="currentColor" strokeOpacity={0.12} />
              <text x={PAD.l - 6} y={sy(v) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>{fmt(v)}</text>
            </g>
          ))}
          {xTicks.map(v => (
            <text key={`x${v}`} x={sx(v)} y={H - 10} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>{fmt(v)}</text>
          ))}
          <text x={W - PAD.r} y={H - 10} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.45} dy={-12}>{xLabel}</text>
          {series.map(s => (
            <g key={s.name}>
              <polyline
                fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dashed ? '5 3' : undefined}
                points={s.points.filter(p => Number.isFinite(ty(p[1]))).map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}
              />
              {s.dots && s.points.map(p => <circle key={p[0]} cx={sx(p[0])} cy={sy(p[1])} r={2.8} fill={s.color} />)}
            </g>
          ))}
          {hoverX !== null && (
            <g>
              <line x1={sx(hoverX)} x2={sx(hoverX)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
              {series.map((s, i) => {
                const p = nearest(s, hoverX);
                if (!p) return null;
                return (
                  <g key={s.name}>
                    <circle cx={sx(p[0])} cy={sy(p[1])} r={3.5} fill={s.color} />
                    <text x={PAD.l + 6} y={PAD.t + 12 + i * 13} fontSize={11} fill={s.color}>
                      {s.name.length > 48 ? s.name.slice(0, 46) + '…' : s.name}: {fmt(p[1])} @ {p[0]}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
