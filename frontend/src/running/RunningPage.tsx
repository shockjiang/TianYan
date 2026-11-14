import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Checkbox, ConfigProvider, Empty, Segmented, Space, Spin, Switch, Table, Tag, Tooltip, Typography, theme as antdTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CaretRightOutlined, MoonOutlined, ReloadOutlined, SunOutlined } from '@ant-design/icons';
import { BASE } from '../base';
import { useTheme } from '../hooks/useTheme';
import { LineChart, type Series } from '../exps/LineChart';
import {
  ActiveFilters, Chat, Detail, EMPTY, PALETTE, STATUS_COLOR, STATUS_ZH, TagBar, hashHits, hashSuggestions, matches, num, rank,
  type Filters, type Row,
} from '../exps/ExpsPage';

// ---------------------------------------------------------------- data shapes (backend/api/running.py)
type Ckpt = 'last' | 'best';
interface Col { id: string; name: string; exp: string; step: number; ckpt: Ckpt | number; live: string | null; endpoint: string | null }
interface CmpRow { key: string; group: string; metric: string; note: string; [id: string]: string }
interface Bar { key: string; label: string; better?: 'lower' | 'higher'; ref?: number }
interface Cmp { cols: Col[]; rows: CmpRow[]; curves: Record<string, number | string | boolean>[]; bars: Bar[]; skipped: { exp: string; ckpt: string; why: string }[] }

/** Selection = which checkpoints of which runs are columns; kept in the URL (?sel=exp:last,exp:best). */
type Sel = Record<string, Ckpt[]>;
const readSel = (): Sel => {
  const out: Sel = {};
  (new URLSearchParams(window.location.search).get('sel') ?? '').split(',').filter(Boolean).forEach(s => {
    const [exp, k] = s.split(':');
    out[exp] = [...(out[exp] ?? []), (k === 'best' ? 'best' : 'last')];
  });
  return out;
};
const writeSel = (sel: Sel) => {
  const p = new URLSearchParams(window.location.search);
  const v = Object.entries(sel).flatMap(([e, ks]) => ks.map(k => `${e}:${k}`)).join(',');
  if (v) p.set('sel', v); else p.delete('sel');
  window.history.replaceState(null, '', window.location.pathname + (p.toString() ? `?${p}` : ''));
};

const LOWER = /^(L_(?!grad_norm).*|.*_err_.*|.*noise.*|.*mse.*|val_.*|.*eef_err.*)$/i;
const HIGHER = /(gain|rate)/i;
const leadNum = (s: string | undefined) => { const m = String(s ?? '').trim().match(/^(-?\d+(?:\.\d+)?(?:e-?\d+)?)/i); return m ? parseFloat(m[1]) : NaN; };
const isNum = (s: string | undefined) => /^-?[\d.]+(e-?\d+)?$/i.test(String(s ?? '').trim());
const liveColor = (v: string | null | undefined) => (/好|good/i.test(v ?? '') ? '#389e0d' : /差|bad/i.test(v ?? '') ? '#cf1322' : undefined);

// ---------------------------------------------------------------- page
export function RunningPage() {
  const [theme, toggleTheme] = useTheme();
  const dark = theme === 'dark';
  const [rows, setRows] = useState<Row[]>([]);
  const [facets, setFacets] = useState<Record<string, [string, number][]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sel, setSel] = useState<Sel>(readSel);
  const [detail, setDetail] = useState<string | null>(null);
  const [cmp, setCmp] = useState<Cmp | null>(null);
  const [cmpBusy, setCmpBusy] = useState(false);
  const [cmpErr, setCmpErr] = useState<string | null>(null);
  // the comparison runs on 「开始对比」 (or straight away when the URL already carries a selection),
  // then follows every change of the selection
  const [started, setStarted] = useState(() => Object.keys(readSel()).length > 0);
  const [filterOpen, setFilterOpen] = useState(() => Object.keys(readSel()).length === 0);
  const results = useRef<HTMLDivElement>(null);
  const curvesRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const jump = (r: React.RefObject<HTMLDivElement | null>) => r.current?.scrollIntoView({ block: 'start' });
  const scrollPending = useRef(false);
  // start: fold the filter away and scroll to the results once they have arrived
  const start = () => { setStarted(true); setFilterOpen(false); scrollPending.current = true; };
  useEffect(() => {
    if (cmp && scrollPending.current) { scrollPending.current = false; setTimeout(() => jump(results), 100); }
  }, [cmp]);

  const load = async () => {
    setLoading(true);
    try {
      const d = await (await fetch(`${BASE}/api/exps`)).json();
      setRows(d.rows); setFacets(d.facets);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => writeSel(sel), [sel]);
  // the page grows past #root's height; paint the body too so the gutters below the first screen match
  useEffect(() => { document.body.style.background = dark ? '#141414' : '#f5f6f8'; }, [dark]);

  // 1. filtering: versions + #tags + natural language narrow the candidates
  const candidates = useMemo(() => rank(rows.filter(r => matches(r, filters)), filters.hashtags), [rows, filters]);
  const byExp = useMemo(() => new Map(rows.map(r => [r.exp, r])), [rows]);
  const allTags = (facets?.tags ?? []).map(([t]) => t);
  const versions = (facets?.version ?? []).slice().sort((a, b) => Number(b[0].slice(1)) - Number(a[0].slice(1)));
  const toggleVersion = (v: string) => setFilters(f => ({ ...f, version: f.version.includes(v) ? f.version.filter(x => x !== v) : [...f.version, v] }));

  // 4. per-run checkpoint sub-filter: last and/or best
  const setCk = (exp: string, k: Ckpt, on: boolean) => setSel(s => {
    const ks = new Set(s[exp] ?? []);
    if (on) ks.add(k); else ks.delete(k);
    const next = { ...s, [exp]: (['last', 'best'] as Ckpt[]).filter(x => ks.has(x)) };
    if (!next[exp].length) delete next[exp];
    return next;
  });
  const addAll = (k: Ckpt) => setSel(s => {
    const next = { ...s };
    candidates.forEach(r => { if (k === 'last' || r.val_best) next[r.exp] = [...new Set([...(next[r.exp] ?? []), k])]; });
    return next;
  });
  const selKey = JSON.stringify(sel);

  // 2/3. comparison + visualization, rebuilt whenever the selection changes
  useEffect(() => {
    const cols = Object.entries(sel).flatMap(([exp, ks]) => ks.map(ckpt => ({ exp, ckpt })));
    if (!cols.length) { setCmp(null); return; }
    if (!started) return;
    let alive = true;
    const t = setTimeout(async () => {
      setCmpBusy(true);
      try {
        const r = await fetch(`${BASE}/api/running/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cols }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail ?? `HTTP ${r.status}`);
        if (alive) { setCmp(d); setCmpErr(null); }
      } catch (e) { if (alive) setCmpErr(String(e)); } finally { if (alive) setCmpBusy(false); }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [selKey, started]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ticking a row = its newest ckpt; unticking drops all its columns
  const onRowSelect = (keys: React.Key[]) => setSel(s => {
    const next: Sel = {};
    keys.map(String).forEach(e => { next[e] = s[e] ?? ['last']; });
    return next;
  });

  const columns: ColumnsType<Row> = [
    {
      title: <Tooltip title="勾选要对比的 ckpt：最新 = 最新保存的 ckpt；最佳 = val action MSE 最低的 ckpt（没有 val 结果的实验不可选）">对比</Tooltip>,
      key: 'pick', width: 128, fixed: 'left',
      render: (_, r) => (
        <Space size={4} direction="vertical">
          <Checkbox checked={sel[r.exp]?.includes('last')} onChange={e => setCk(r.exp, 'last', e.target.checked)}>
            最新{r.ckpt != null && <span style={{ opacity: 0.55, fontSize: 11 }}> @{r.ckpt}</span>}
          </Checkbox>
          <Checkbox disabled={!r.val_best} checked={sel[r.exp]?.includes('best')} onChange={e => setCk(r.exp, 'best', e.target.checked)}>
            最佳{r.val_best && <span style={{ opacity: 0.55, fontSize: 11 }}> @{r.val_best.step}</span>}
          </Checkbox>
        </Space>
      ),
    },
    {
      title: '标签', key: 'tags', width: 210,
      render: (_, r) => (
        <div>
          {filters.hashtags.length > 0 && <div style={{ fontSize: 11, color: '#1677ff' }}>命中 {hashHits(r, filters.hashtags)}/{filters.hashtags.length}</div>}
          <Space size={[0, 2]} wrap>{(r.tag_info ?? []).map(t => <Tag key={t.tag} color={t.by === 'claude' ? 'purple' : 'geekblue'} style={{ fontSize: 11 }}>{t.tag}</Tag>)}</Space>
        </div>
      ),
    },
    {
      title: '实验名', dataIndex: 'exp', width: 240,
      render: (e: string, r) => (
        <div style={{ lineHeight: 1.25, whiteSpace: 'normal' }}>
          <a onClick={() => setDetail(e)} style={{ fontSize: 11, wordBreak: 'break-all' }}>{e}</a>
          <div style={{ fontSize: 11, opacity: 0.65 }}>{r.version !== '-' && <Tag style={{ fontSize: 10 }}>{r.version}</Tag>}{r.parent && `← ${r.parent}`}</div>
        </div>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 76, render: (s: string) => <Tag color={STATUS_COLOR[s] ?? 'default'}>{STATUS_ZH[s] ?? s}</Tag> },
    { title: '迭代', key: 'step', width: 100, render: (_, r) => `${r.step ?? '-'}/${r.max_steps ?? '?'}` },
    { title: 'action loss', dataIndex: 'action_loss_mean5', width: 92, align: 'right', render: v => num(v) },
    { title: '最优 val MSE', key: 'vb', width: 110, render: (_, r) => (r.val_best ? `${r.val_best.mse.toFixed(4)} @${r.val_best.step}` : '-') },
  ];

  const nSel = Object.values(sel).reduce((n, ks) => n + ks.length, 0);
  const card = { padding: 12, borderRadius: 8, background: dark ? '#1f1f1f' : '#fff', border: `1px solid ${dark ? '#303030' : '#e5e5e5'}`, marginBottom: 12 } as const;
  return (
    <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { fontSize: 13 } }}>
      <div style={{ minHeight: '100vh', background: dark ? '#141414' : '#f5f6f8', color: dark ? '#e6e6e6' : '#1f1f1f', padding: '12px 16px' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 10 }} wrap>
          <Space align="center" wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>实验对比</Typography.Title>
            <span style={{ opacity: 0.6, fontSize: 12 }}>筛选 → 选 ckpt → 对比表 → 曲线与指标图；点实验名看详情</span>
          </Space>
          <Space>
            <a href={`${BASE}/exps`}>实验看板</a>
            <a href={`${BASE}/`}>文件浏览</a>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
            <Button size="small" icon={dark ? <SunOutlined /> : <MoonOutlined />} onClick={toggleTheme} />
          </Space>
        </Space>

        {/* 1. filtering */}
        <div style={card}>
          <Typography.Title level={5} style={{ margin: filterOpen ? '0 0 8px' : 0, cursor: 'pointer' }} onClick={() => setFilterOpen(o => !o)}>
            {filterOpen ? '▾' : '▸'} ① 筛选与选择 <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.6 }}>候选 {candidates.length} · 已选 {nSel} 列{filterOpen ? '' : ' · 点此展开'}</span>
          </Typography.Title>
          {filterOpen && <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 2px', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ opacity: 0.6, fontSize: 12, marginRight: 6 }}>版本（多选 = 任一）：</span>
            {versions.map(([v, n]) => (
              <Tag.CheckableTag key={v} checked={filters.version.includes(v)} onChange={() => toggleVersion(v)} style={{ border: '1px solid #8884', fontSize: 12 }}>
                {v} <span style={{ opacity: 0.6 }}>{n}</span>
              </Tag.CheckableTag>
            ))}
          </div>
          <TagBar facets={facets?.tags ?? []} rows={rows} selected={filters.hashtags}
            onToggle={t => setFilters(f => ({ ...f, hashtags: f.hashtags.includes(t) ? f.hashtags.filter(x => x !== t) : [...f.hashtags, t] }))} />
          <Chat dark={dark} suggestions={hashSuggestions(rows)} count={(f, names, hashtags) => rows.filter(r => matches(r, { ...EMPTY, ...f, names, hashtags })).length}
            onApply={(f, names, hashtags) => setFilters(cur => ({ ...EMPTY, version: cur.version, ...f, names, hashtags }))} onTagged={load} />
          <ActiveFilters f={filters} onChange={setFilters} />
          <Space style={{ marginBottom: 6 }} wrap>
            <span style={{ opacity: 0.6, fontSize: 12 }}>候选 {candidates.length} 个 · 已选 {nSel} 列</span>
            <Button size="small" onClick={() => addAll('last')}>候选全部加入（最新）</Button>
            <Button size="small" onClick={() => addAll('best')}>候选全部加入（最佳）</Button>
            <Button size="small" danger disabled={!nSel} onClick={() => setSel({})}>清空对比</Button>
            <Button type="primary" icon={<CaretRightOutlined />} disabled={!nSel} onClick={start}>开始对比与可视化（{nSel} 列）</Button>
          </Space>
          <Table<Row> rowKey="exp" size="small" columns={columns} dataSource={candidates} loading={loading && !rows.length}
            scroll={{ x: 960, y: 360 }} pagination={false}
            rowSelection={{ selectedRowKeys: Object.keys(sel), onChange: onRowSelect, columnWidth: 36, fixed: true }} />
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>勾选行首方框 = 选该实验（默认最新 ckpt）；「对比」列可改成最佳或两者都要；然后点「开始对比与可视化」</div>
          </>}
        </div>

        {/* 4. the chosen checkpoints, each removable (sub-filter of the comparison) */}
        {nSel > 0 && (
          <Space wrap size={[4, 4]} style={{ marginBottom: 12 }}>
            <span style={{ opacity: 0.6, fontSize: 12 }}>对比列：</span>
            {Object.entries(sel).flatMap(([exp, ks]) => ks.map(k => {
              const r = byExp.get(exp);
              const step = k === 'best' ? r?.val_best?.step : r?.ckpt;
              return (
                <Tag key={`${exp}:${k}`} closable onClose={e => { e.preventDefault(); setCk(exp, k, false); }} color={k === 'best' ? 'gold' : 'blue'}>
                  <a onClick={() => setDetail(exp)}>{(r?.recipe ?? exp).slice(0, 40)}</a> · {k === 'best' ? '最佳' : '最新'} @{step ?? '?'}
                </Tag>
              );
            }))}
          </Space>
        )}

        <div ref={results} style={{ scrollMarginTop: 8 }} />
        {!nSel || !started ? (
          <div style={card}>
            <Empty description={nSel ? `已选 ${nSel} 列` : '在上面勾选实验（行首方框，或「对比」列的最新 / 最佳）'}>
              <Button type="primary" icon={<CaretRightOutlined />} disabled={!nSel} onClick={start}>开始对比与可视化</Button>
            </Empty>
          </div>
        ) : (
          <Spin spinning={cmpBusy}>
            {cmpErr && <div style={{ ...card, color: '#ff4d4f' }}>对比失败：{cmpErr}</div>}
            {cmp?.skipped?.length ? (
              <div style={{ ...card, fontSize: 12 }}>未加入：{cmp.skipped.map(s => `${s.exp}（${s.ckpt === 'best' ? '最佳' : s.ckpt}）：${s.why}`).join('；')}</div>
            ) : null}
            {cmp && cmp.cols.length > 0 && (
              <>
                <Space style={{ position: 'sticky', top: 0, zIndex: 5, padding: '6px 10px', marginBottom: 8, borderRadius: 6, background: dark ? '#262626ee' : '#ffffffee', border: `1px solid ${dark ? '#303030' : '#e5e5e5'}` }} wrap>
                  <span style={{ opacity: 0.6, fontSize: 12 }}>跳到：</span>
                  <Button size="small" onClick={() => jump(results)}>② 逐项对比</Button>
                  <Button size="small" type="primary" onClick={() => jump(curvesRef)}>③ 训练曲线</Button>
                  <Button size="small" type="primary" onClick={() => jump(barsRef)}>③ 指标图</Button>
                  <Button size="small" onClick={() => { setFilterOpen(true); window.scrollTo({ top: 0 }); }}>① 改选择</Button>
                </Space>
                <CompareTable cmp={cmp} dark={dark} card={card} onOpen={setDetail} />
                <div ref={curvesRef} style={{ scrollMarginTop: 48 }}><Curves cmp={cmp} dark={dark} card={card} /></div>
                <div ref={barsRef} style={{ scrollMarginTop: 48 }}><Bars cmp={cmp} dark={dark} card={card} /></div>
              </>
            )}
          </Spin>
        )}

        <Detail row={detail ? byExp.get(detail) ?? null : null} dark={dark} allTags={allTags} onChanged={load} onClose={() => setDetail(null)} />
      </div>
    </ConfigProvider>
  );
}

// ---------------------------------------------------------------- 2. comparison table
function ColHead({ c, i, onOpen }: { c: Col; i: number; onOpen: (exp: string) => void }) {
  return (
    <div style={{ lineHeight: 1.3, whiteSpace: 'normal', minWidth: 130 }}>
      <span style={{ color: PALETTE[i % PALETTE.length] }}>■ </span>
      <a onClick={() => onOpen(c.exp)} style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</a>
      <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.75 }}>
        {c.ckpt === 'best' ? '最佳' : c.ckpt === 'last' ? '最新' : `@${c.ckpt}`}
        {c.live && <span style={{ color: liveColor(c.live), marginLeft: 6 }}>实机 {c.live}</span>}
        {c.endpoint && <span style={{ marginLeft: 6 }}>{c.endpoint}</span>}
      </div>
    </div>
  );
}

function CompareTable({ cmp, dark, card, onOpen }: { cmp: Cmp; dark: boolean; card: React.CSSProperties; onOpen: (exp: string) => void }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [folded, setFolded] = useState<Set<string>>(new Set(['训练配方']));
  const ids = cmp.cols.map(c => c.id);
  const groups = [...new Set(cmp.rows.map(r => r.group))];
  const line = dark ? '#303030' : '#eee';
  const differs = (r: CmpRow) => new Set(ids.map(i => r[i])).size > 1;
  const empty = (r: CmpRow) => ids.every(i => r[i] === '—');
  const best = (r: CmpRow) => {
    if (!(LOWER.test(r.key) || HIGHER.test(r.key)) || r.key === 'pick') return null;
    const v = ids.map(i => (isNum(r[i]) ? parseFloat(r[i]) : NaN)).filter(Number.isFinite);
    if (v.length < 2) return null;
    return HIGHER.test(r.key) ? Math.max(...v) : Math.min(...v);
  };
  const td: React.CSSProperties = { padding: '4px 8px', borderBottom: `1px solid ${line}`, verticalAlign: 'top', fontSize: 12 };
  return (
    <div style={card}>
      <Space style={{ marginBottom: 6 }} wrap>
        <Typography.Title level={5} style={{ margin: 0 }}>② 逐项对比</Typography.Title>
        <span><Switch size="small" checked={onlyDiff} onChange={setOnlyDiff} /> 只看有差异的行</span>
        <span style={{ opacity: 0.6, fontSize: 12 }}>每列一个 ckpt；下划线 = 该行最好；点组名折叠 / 展开；点列名看详情</span>
      </Space>
      <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ ...td, position: 'sticky', top: 0, left: 0, zIndex: 3, background: dark ? '#1f1f1f' : '#fff', textAlign: 'left', minWidth: 200 }}>指标</th>
              {cmp.cols.map((c, i) => (
                <th key={c.id} style={{ ...td, position: 'sticky', top: 0, zIndex: 2, background: dark ? '#1f1f1f' : '#fff', textAlign: 'left' }}>
                  <ColHead c={c} i={i} onOpen={onOpen} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const rs = cmp.rows.filter(r => r.group === g && !empty(r) && (!onlyDiff || differs(r) || r.group === '结果'));
              if (!rs.length) return null;
              const isFolded = folded.has(g);
              return [
                <tr key={`g:${g}`} onClick={() => setFolded(f => { const n = new Set(f); if (n.has(g)) n.delete(g); else n.add(g); return n; })} style={{ cursor: 'pointer' }}>
                  <td colSpan={ids.length + 1} style={{ ...td, fontWeight: 600, background: dark ? '#262626' : '#fafafa', position: 'sticky', left: 0 }}>
                    {isFolded ? '▸' : '▾'} {g} <span style={{ opacity: 0.55, fontWeight: 400 }}>（{rs.length} 行）</span>
                  </td>
                </tr>,
                ...(isFolded ? [] : rs.map(r => {
                  const b = best(r);
                  return (
                    <tr key={r.key}>
                      <td style={{ ...td, position: 'sticky', left: 0, background: dark ? '#1f1f1f' : '#fff', zIndex: 1 }}>
                        {r.note ? <Tooltip title={r.note}><span style={{ borderBottom: '1px dotted #8888' }}>{r.metric}</span></Tooltip> : r.metric}
                      </td>
                      {ids.map(i => (
                        <td key={i} style={{
                          ...td, whiteSpace: r.group === '训练配方' || r.key === 'tags' ? 'normal' : 'nowrap', maxWidth: 320,
                          color: r.key === 'live' ? liveColor(r[i]) : undefined,
                          fontWeight: b !== null && isNum(r[i]) && parseFloat(r[i]) === b ? 600 : undefined,
                          textDecoration: b !== null && isNum(r[i]) && parseFloat(r[i]) === b ? 'underline' : undefined,
                        }}>{r[i]}</td>
                      ))}
                    </tr>
                  );
                })),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 3. visualization: curves + bar small multiples
const CURVE_ZH: Record<string, string> = {
  action_loss: 'action loss', loss: '总 loss', skill_loss: 'skill loss', progress_loss: 'progress loss', inverse_loss: 'inverse loss', grad_norm: 'grad norm', lr: 'lr',
};

function Curves({ cmp, dark, card }: { cmp: Cmp; dark: boolean; card: React.CSSProperties }) {
  const keys = useMemo(() => {
    const ks = new Set(cmp.curves.flatMap(p => Object.keys(p)).filter(k => k === 'loss' || k.endsWith('_loss') || k === 'grad_norm' || k === 'lr'));
    return Object.keys(CURVE_ZH).filter(k => ks.has(k)).concat([...ks].filter(k => !(k in CURVE_ZH)));
  }, [cmp]);
  const [key, setKey] = useState('action_loss');
  const [cumulative, setCumulative] = useState(true);
  const [logY, setLogY] = useState(true);
  const k = keys.includes(key) ? key : keys[0];
  const series: Series[] = cmp.cols.flatMap((c, i) => {
    const pts = cmp.curves.filter(p => p.exp === c.id && typeof p[k] === 'number');
    const xy = (p: typeof pts[number]) => [Number(cumulative ? p.step : p.stage_step), Number(p[k])] as [number, number];
    const own = pts.filter(p => p.own).map(xy);
    const inherited = cumulative ? pts.filter(p => !p.own).map(xy) : [];
    const color = PALETTE[i % PALETTE.length];
    return [{ name: c.name, color, points: own }, ...(inherited.length ? [{ name: `${c.name}（祖先）`, color, dashed: true, points: inherited }] : [])];
  });
  return (
    <div style={card}>
      <Space style={{ marginBottom: 6 }} wrap>
        <Typography.Title level={5} style={{ margin: 0 }}>③ 训练曲线</Typography.Title>
        <Segmented size="small" value={k} onChange={v => setKey(String(v))} options={keys.map(x => ({ value: x, label: CURVE_ZH[x] ?? x }))} />
        <span><Switch size="small" checked={cumulative} onChange={setCumulative} /> 横轴：从 pi0.5 base 累计（虚线 = 祖先 run）</span>
        <span><Switch size="small" checked={logY} onChange={setLogY} /> 对数纵轴</span>
      </Space>
      <div style={{ color: dark ? '#ddd' : '#222' }}>
        <LineChart series={series} logY={logY && k !== 'grad_norm'} height={340} xLabel={cumulative ? '累计步数' : '本阶段步数'} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 11, marginTop: 4 }}>
        {cmp.cols.map((c, i) => <span key={c.id}><span style={{ color: PALETTE[i % PALETTE.length] }}>■</span> {c.name}</span>)}
      </div>
    </div>
  );
}

function Bars({ cmp, dark, card }: { cmp: Cmp; dark: boolean; card: React.CSSProperties }) {
  const items = cmp.bars.map(b => ({ b, r: cmp.rows.find(x => x.key === b.key) }))
    .filter((x): x is { b: Bar; r: CmpRow } => !!x.r && cmp.cols.some(c => Number.isFinite(leadNum(x.r![c.id]))));
  if (!items.length) return null;
  const fg = dark ? '#ddd' : '#222';
  return (
    <div style={card}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>指标一览 <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.6 }}>每格一个指标，每条一个 ckpt（颜色同曲线）；↓ 越小越好，↑ 越大越好</span></Typography.Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
        {items.map(({ b, r }) => {
          const v = cmp.cols.map(c => leadNum(r[c.id]));
          const fin = v.filter(Number.isFinite);
          const lo = Math.min(0, ...fin), hi = Math.max(0, ...fin) || 1;
          const W = 300, L = 130, R = 60, rowH = 22, H = cmp.cols.length * rowH + 4;
          const X = (x: number) => L + ((x - lo) / (hi - lo)) * (W - L - R);
          return (
            <div key={b.key} style={{ border: `1px solid ${dark ? '#303030' : '#eee'}`, borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{b.label}{b.better === 'lower' ? ' ↓' : b.better === 'higher' ? ' ↑' : ''}</div>
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
                {lo < 0 && <line x1={X(0)} x2={X(0)} y1={0} y2={H} stroke={fg} strokeOpacity={0.4} strokeDasharray="3 3" />}
                {cmp.cols.map((c, i) => {
                  const y = i * rowH + 2;
                  const name = c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name;
                  return (
                    <g key={c.id}>
                      <text x={0} y={y + 14} fontSize={11} fill={liveColor(c.live) ?? fg}>{name}</text>
                      {Number.isFinite(v[i]) ? (
                        <>
                          <rect x={X(Math.min(0, v[i]))} y={y + 4} width={Math.max(1, X(Math.max(0, v[i])) - X(Math.min(0, v[i])))} height={13} rx={3} fill={PALETTE[i % PALETTE.length]} />
                          <text x={Math.max(X(Math.max(0, v[i])), X(0)) + 4} y={y + 14} fontSize={11} fill={fg}>{String(r[c.id]).replace(/（.*$/, '')}</text>
                        </>
                      ) : <text x={L} y={y + 14} fontSize={11} fill={fg} opacity={0.5}>—</text>}
                    </g>
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>名字为绿色 / 红色 = 实机结论 好 / 差（来自 compare-exp spec 或 locating-good / real-good / *-bad 标签）</div>
    </div>
  );
}
