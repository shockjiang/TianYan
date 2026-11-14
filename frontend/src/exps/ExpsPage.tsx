import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, ConfigProvider, Collapse, message, Descriptions, Drawer, Empty, Mentions, Progress, Select, Space, Switch, Table, Tag,
  Tooltip, Typography, theme as antdTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FullscreenExitOutlined, FullscreenOutlined, MoonOutlined, ReloadOutlined, SendOutlined, SunOutlined } from '@ant-design/icons';
import { BASE } from '../base';
import { useTheme } from '../hooks/useTheme';
import { LineChart, type Series } from './LineChart';

// ---------------------------------------------------------------- data shapes (backend/api/exps.py)
interface ValSet { step: number; sets: [string, number, number | null][] }
export interface Row {
  exp: string; status: string; live: boolean; gpus: number | null; task: string | null;
  start: number | null; end: number | null; step: number | null; max_steps: number | null;
  loss: number | null; action_loss: number | null; action_loss_mean5: number | null;
  s_per_it: number | null; eta_h: number | null; ckpt: number | null; n_ckpt: number;
  log_age_s: number | null; val_newest: ValSet | null;
  val_best: { mse: number; step: number; set: string } | null;
  probe: Record<string, number> | null;
  version: string; ts: string | null; commit: string | null; recipe: string;
  datasets: string[]; dataset_paths?: string[]; data_tags: string[]; train_tags: string[];
  parent: string | null; lr?: number; batch_per_device?: number; work_dir?: string; config_path?: string;
  tags: string[]; tag_info: TagInfo[];
}
interface TagInfo { tag: string; by: 'user' | 'claude'; t: number; note?: string }
type Facets = Record<'version' | 'datasets' | 'data_tags' | 'train_tags' | 'tags' | 'status', [string, number][]>;
interface Curves {
  train: Record<string, number>[]; keys: string[];
  val: { step: number; set: string; mse: number; joint_raw: number | null }[];
  probe: Record<string, number>[]; checkpoints: number[];
}

export const PALETTE = ['#4c8dff', '#ff7a45', '#36cfc9', '#f759ab', '#ffc53d', '#73d13d', '#9254de', '#ff4d4f', '#40a9ff', '#bae637'];
export const STATUS_COLOR: Record<string, string> = {
  Running: 'green', Queue: 'gold', Staging: 'gold', Killing: 'orange', Success: 'cyan', Failed: 'red', Killed: 'default',
};
export const STATUS_ZH: Record<string, string> = {
  Running: '运行中', Queue: '排队', Staging: '准备中', Killing: '终止中', Success: '成功', Failed: '失败', Killed: '已终止',
  'n/a': '历史', Initialized: '初始化',
};

export const num = (v: number | null | undefined, d = 4) => (v == null ? '-' : v.toFixed(d));
const ago = (t: number | null | undefined) => {
  if (!t) return '-';
  const s = Date.now() / 1000 - t;
  return s < 3600 ? `${Math.round(s / 60)} 分钟前` : s < 172800 ? `${(s / 3600).toFixed(1)} 小时前` : `${Math.round(s / 86400)} 天前`;
};
const cmp = (a: number | null | undefined, b: number | null | undefined) => (a ?? Infinity) - (b ?? Infinity);

// ---------------------------------------------------------------- URL-backed filter state
export interface Filters { q: string; version: string[]; datasets: string[]; data_tags: string[]; train_tags: string[]; tags: string[]; status: string[]; live: boolean; names: string[]; hashtags: string[] }
export const EMPTY: Filters = { q: '', version: [], datasets: [], data_tags: [], train_tags: [], tags: [], status: [], live: false, names: [], hashtags: [] };
const FILTER_KEYS = ['version', 'datasets', 'data_tags', 'train_tags', 'tags', 'status', 'names', 'hashtags'] as const;

function readFilters(): Filters {
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => (p.get(k) ? p.get(k)!.split('|') : []);
  return {
    q: p.get('q') ?? '', version: list('version'), datasets: list('datasets'), data_tags: list('data_tags'),
    train_tags: list('train_tags'), status: list('status'), live: p.get('live') === '1', names: list('names'), tags: list('tags'), hashtags: list('hashtags'),
  };
}

function writeFilters(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  FILTER_KEYS.forEach(k => f[k].length && p.set(k, f[k].join('|')));
  if (f.live) p.set('live', '1');
  const qs = p.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
}

/** What a #word is matched against: user / Claude tags, config tags, version, datasets, status and the run
 *  name — each whole and split into words, so #ft matches a tag "ft" or "ft-box" but not "left". */
const hashHay = (r: Row) => [...(r.tags ?? []), ...(r.data_tags ?? []), ...(r.train_tags ?? []), r.version, ...(r.datasets ?? []), r.status, r.exp]
  .filter(Boolean).flatMap(t => { const l = t.toLowerCase(); return [l, ...l.split(/[^\p{L}\p{N}.]+/u)]; }).filter(Boolean);

/** How many of the #tags this run matches. */
export const hashHits = (r: Row, hashtags: string[]) => { const hay = hashHay(r); return hashtags.filter(h => hay.some(t => t.startsWith(h.toLowerCase()))).length; };
const versionNum = (r: Row) => (/^v(\d+)$/i.test(r.version) ? Number(r.version.slice(1)) : -1);

/** #tags active: most matched tags first, then highest version, then lowest loss. Otherwise newest first. */
export function rank(rows: Row[], hashtags: string[]) {
  if (!hashtags.length) return [...rows].sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  const hits = new Map(rows.map(r => [r.exp, hashHits(r, hashtags)]));
  return [...rows].sort((a, b) => hits.get(b.exp)! - hits.get(a.exp)! || versionNum(b) - versionNum(a) || cmp(a.loss, b.loss));
}

export function matches(r: Row, f: Filters) {
  const q = f.q.trim().toLowerCase();
  if (q && !q.split(/\s+/).every(w => r.exp.toLowerCase().includes(w))) return false;
  if (f.live && !r.live) return false;
  if (f.names.length && !f.names.includes(r.exp)) return false;      // explicit list from the chat
  if (!f.tags.every(t => r.tags?.includes(t))) return false;          // all chosen user / Claude tags
  if (f.hashtags.length && !hashHits(r, f.hashtags)) return false;    // any #tag
  if (f.version.length && !f.version.includes(r.version)) return false;   // any of the versions
  if (f.status.length && !f.status.includes(r.status)) return false;
  if (!f.datasets.every(d => r.datasets?.includes(d))) return false;     // all chosen datasets
  if (!f.data_tags.every(t => r.data_tags?.includes(t))) return false;   // all chosen tags
  if (!f.train_tags.every(t => r.train_tags?.includes(t))) return false;
  return true;
}

// ---------------------------------------------------------------- page
export function ExpsPage() {
  const [theme, toggleTheme] = useTheme();
  const [rows, setRows] = useState<Row[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [hidden, setHidden] = useState<{ patterns: string[]; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(readFilters);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [autotagging, setAutotagging] = useState(false);
  // full-screen the table box with the browser Fullscreen API; Esc exits and the event resyncs the state
  const tableBox = useRef<HTMLDivElement>(null);
  const [tableFull, setTableFull] = useState(false);
  useEffect(() => {
    const sync = () => setTableFull(document.fullscreenElement === tableBox.current && !!tableBox.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleTableFull = () => (document.fullscreenElement ? document.exitFullscreen() : tableBox.current?.requestFullscreen());
  const allTags = (facets?.tags ?? []).map(([t]) => t);
  const autotag = async () => {
    setAutotagging(true);
    try {
      const r = await fetch(`${BASE}/api/exps/autotag`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail ?? `HTTP ${r.status}`);
      message.success(d.message ?? `Claude 为 ${Object.keys(d.tagged).length} 个实验打了标签（${d.seconds}s · $${(d.cost_usd ?? 0).toFixed(2)}）`);
      load();
    } catch (e) { message.error(`自动打标签失败：${e}`); } finally { setAutotagging(false); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/exps`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setRows(d.rows); setFacets(d.facets); setUpdated(d.updated); setHidden(d.hidden ?? null); setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  useEffect(() => writeFilters(filters), [filters]);

  const shown = useMemo(() => rank(rows.filter(r => matches(r, filters)), filters.hashtags), [rows, filters]);

  const columns: ColumnsType<Row> = [
    {
      title: <Tooltip title="紫色 ✦ = Claude 添加，蓝色 = 用户添加；点 × 删除，点「+ 标签」添加">标签</Tooltip>,
      key: 'tags', width: 220, fixed: 'left',
      render: (_, r) => (
        <div>
          {filters.hashtags.length > 0 && <div style={{ fontSize: 11, color: '#1677ff' }}>命中 {hashHits(r, filters.hashtags)}/{filters.hashtags.length}</div>}
          <TagCell exp={r.exp} info={r.tag_info ?? []} allTags={allTags} onChanged={load} />
        </div>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 84, fixed: 'left',
      sorter: (a, b) => Number(b.live) - Number(a.live) || a.status.localeCompare(b.status),
      render: (s: string) => <Tag color={STATUS_COLOR[s] ?? 'default'}>{STATUS_ZH[s] ?? s}</Tag>,
    },
    {
      title: '实验名', dataIndex: 'exp', width: 230, fixed: 'left', sorter: (a, b) => a.exp.localeCompare(b.exp),
      render: (e: string, r) => (
        <div style={{ lineHeight: 1.25, whiteSpace: 'normal' }}>
          <a onClick={() => setDetail(r)} style={{ fontSize: 11, wordBreak: 'break-all' }}>{e}</a>
          <div style={{ fontSize: 11, opacity: 0.65 }}>
            {r.version !== '-' && <Tag style={{ fontSize: 10, marginRight: 4 }}>{r.version}</Tag>}
            {r.commit && <span style={{ marginRight: 8 }}>commit {r.commit}</span>}
            {r.parent && <span>← {r.parent}</span>}
          </div>
        </div>
      ),
    },
    {
      title: '迭代', key: 'step', width: 150, sorter: (a, b) => cmp(a.step, b.step),
      render: (_, r) => r.step == null ? '-' : (
        <Tooltip title={`${r.step} / ${r.max_steps ?? '?'}`}>
          <div style={{ fontSize: 12 }}>{r.step}/{r.max_steps ?? '?'}</div>
          {r.max_steps ? <Progress percent={Math.round((100 * r.step) / r.max_steps)} size="small" showInfo={false}
            status={r.status === 'Running' ? 'active' : r.status === 'Failed' ? 'exception' : 'normal'} /> : null}
        </Tooltip>
      ),
    },
    { title: 'loss', dataIndex: 'loss', width: 82, align: 'right', sorter: (a, b) => cmp(a.loss, b.loss), render: v => num(v) },
    {
      title: <Tooltip title="最后一次训练日志的 action_loss；括号内为最近 5 次日志的均值">action loss</Tooltip>,
      dataIndex: 'action_loss', width: 120, align: 'right', sorter: (a, b) => cmp(a.action_loss, b.action_loss),
      render: (v, r) => <span>{num(v)} <span style={{ opacity: 0.55, fontSize: 11 }}>({num(r.action_loss_mean5)})</span></span>,
    },
    {
      title: <Tooltip title="if_probe matched_mse（归一化动作空间），最新一个已验证 ckpt，取各验证集中的最小值">val action MSE</Tooltip>,
      key: 'val', width: 170, sorter: (a, b) => cmp(a.val_newest ? Math.min(...a.val_newest.sets.map(s => s[1])) : null,
        b.val_newest ? Math.min(...b.val_newest.sets.map(s => s[1])) : null),
      render: (_, r) => {
        if (!r.val_newest) return '-';
        const best = r.val_newest.sets.reduce((m, s) => (s[1] < m[1] ? s : m));
        return <Tooltip title={r.val_newest.sets.map(s => `${s[0]}: ${s[1].toFixed(4)}`).join('\n')}>
          {best[1].toFixed(4)} <span style={{ opacity: 0.55, fontSize: 11 }}>@{r.val_newest.step}</span>
        </Tooltip>;
      },
    },
    {
      title: '最优 MSE', key: 'best', width: 120, sorter: (a, b) => cmp(a.val_best?.mse, b.val_best?.mse),
      render: (_, r) => r.val_best ? <Tooltip title={r.val_best.set}>{r.val_best.mse.toFixed(4)} <span style={{ opacity: 0.55, fontSize: 11 }}>@{r.val_best.step}</span></Tooltip> : '-',
    },
    {
      title: <Tooltip title="watchdog-v1 探针（data/val/watchdog/&lt;exp&gt;.jsonl）">探针 MSE</Tooltip>, key: 'probe', width: 150,
      render: (_, r) => r.probe ? Object.entries(r.probe).filter(([k]) => k.endsWith('_mse')).map(([k, v]) => `${k.slice(0, -4)} ${v.toFixed(4)}`).join(' · ') + ` @${r.probe.step}` : '-',
    },
    { title: 'ckpt', key: 'ckpt', width: 80, sorter: (a, b) => cmp(a.ckpt, b.ckpt), render: (_, r) => (r.ckpt == null ? '-' : `${r.ckpt} (${r.n_ckpt})`) },
    { title: 's/it', dataIndex: 's_per_it', width: 60, align: 'right', render: v => num(v, 1) },
    { title: 'ETA', dataIndex: 'eta_h', width: 64, align: 'right', render: v => (v == null ? '-' : `${v.toFixed(1)}h`) },
    { title: 'GPU', dataIndex: 'gpus', width: 56, align: 'right', render: v => v ?? '-' },
    {
      title: '数据集', dataIndex: 'datasets', width: 220,
      render: (d: string[]) => <span style={{ fontSize: 11 }}>{d?.slice(0, 3).join(', ')}{d?.length > 3 ? ` +${d.length - 3}` : ''}</span>,
    },
    { title: '开始', dataIndex: 'start', width: 100, sorter: (a, b) => cmp(a.start, b.start), render: v => ago(v) },
    { title: '日志', dataIndex: 'log_age_s', width: 90, render: v => (v == null ? '-' : ago(Date.now() / 1000 - v)) },
  ];

  const dark = theme === 'dark';
  return (
    <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { fontSize: 13 } }}>
      <div style={{ minHeight: '100vh', background: dark ? '#141414' : '#f5f6f8', color: dark ? '#e6e6e6' : '#1f1f1f', padding: '12px 16px' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 10 }} wrap>
          <Space align="center" wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>实验看板</Typography.Title>
            <span style={{ opacity: 0.6, fontSize: 12 }}>
              manifold_model/work_dirs · {rows.filter(r => r.live).length} 运行中 / {rows.length} 总计 · 显示 {shown.length}
              {updated && ` · 更新于 ${new Date(updated * 1000).toLocaleTimeString('zh-CN', { hour12: false })}`}
              {hidden && hidden.count > 0 && <Tooltip title={`名称含 ${hidden.patterns.join(' / ')} 的实验不在本页显示（文件未删除；在 backend/exps_hidden.json 中修改）`}><span> · 已隐藏 {hidden.count}</span></Tooltip>}
              {error && <span style={{ color: '#ff4d4f' }}> · 加载失败 {error}</span>}
            </span>
          </Space>
          <Space>
            <a href={`${BASE}/`}>← 文件浏览</a>
            <Tooltip title="让 Claude Code 读快照、docs 和历史对话，为还没有 Claude 标签的实验各打 2–5 个标签（约几分钟）">
              <Button size="small" loading={autotagging} onClick={autotag}>✦ Claude 自动打标签</Button>
            </Tooltip>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
            <Button size="small" icon={dark ? <SunOutlined /> : <MoonOutlined />} onClick={toggleTheme} />
          </Space>
        </Space>

        <ActiveFilters f={filters} onChange={setFilters} />

        <TagBar facets={facets?.tags ?? []} rows={rows} selected={filters.hashtags}
          onToggle={t => setFilters(f => ({ ...f, hashtags: f.hashtags.includes(t) ? f.hashtags.filter(x => x !== t) : [...f.hashtags, t] }))} />
        <Chat dark={dark} suggestions={hashSuggestions(rows)} count={(f, names, hashtags) => rows.filter(r => matches(r, { ...EMPTY, ...f, names, hashtags })).length}
          onApply={(f, names, hashtags) => setFilters({ ...EMPTY, ...f, names, hashtags })} onTagged={load} />
        {selected.length > 0 && <BulkTags exps={selected} rows={rows} allTags={allTags} onChanged={load} />}

        {/* popups (tag dropdowns, tooltips, the detail drawer) render inside the box so they stay visible in full screen */}
        <ConfigProvider getPopupContainer={() => tableBox.current ?? document.body}>
        <div ref={tableBox} style={{ background: dark ? '#141414' : '#f5f6f8', padding: tableFull ? 12 : 0, position: 'relative' }}>
          <Space style={{ marginBottom: 6 }}>
            <Button size="small" icon={tableFull ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={toggleTableFull}>
              {tableFull ? '退出全屏（Esc）' : '全屏表格'}
            </Button>
            <span style={{ opacity: 0.6, fontSize: 12 }}>{shown.length} 个实验{filters.hashtags.length > 0 && ` · ${filters.hashtags.map(h => '#' + h).join(' ')}`}</span>
          </Space>
          <Table<Row>
            rowKey="exp" size="small" columns={columns} dataSource={shown} loading={loading && !rows.length}
            scroll={{ x: 1900, y: tableFull ? 'calc(100vh - 120px)' : selected.length ? '42vh' : 'calc(100vh - 210px)' }}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200] }}
            rowSelection={{ selectedRowKeys: selected, onChange: k => setSelected(k as string[]), columnWidth: 36, fixed: true }}
            onRow={r => ({ onDoubleClick: () => setDetail(r) })}
          />
          <Detail row={detail ? rows.find(r => r.exp === detail.exp) ?? detail : null} dark={dark} allTags={allTags} onChanged={load} onClose={() => setDetail(null)} />
        </div>
        </ConfigProvider>

        {selected.length > 0 && <Compare exps={selected} dark={dark} onClear={() => setSelected([])} />}
      </div>
    </ConfigProvider>
  );
}

// ---------------------------------------------------------------- curves
const curveCache = new Map<string, Promise<Curves>>();
function fetchCurves(exp: string): Promise<Curves> {
  if (!curveCache.has(exp)) {
    const p = fetch(`${BASE}/api/exps/${encodeURIComponent(exp)}/curves`).then(r => r.json());
    curveCache.set(exp, p);
    setTimeout(() => curveCache.delete(exp), 30000);
  }
  return curveCache.get(exp)!;
}

function useCurves(exps: string[]) {
  const [data, setData] = useState<Record<string, Curves>>({});
  const key = exps.join('\n');
  useEffect(() => {
    let alive = true;
    Promise.all(exps.map(e => fetchCurves(e).then(c => [e, c] as const))).then(pairs => alive && setData(Object.fromEntries(pairs)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

const trainSeries = (c: Curves | undefined, key: string): [number, number][] =>
  (c?.train ?? []).filter(r => typeof r[key] === 'number').map(r => [r.step, r[key]]);

function Compare({ exps, dark, onClear }: { exps: string[]; dark: boolean; onClear: () => void }) {
  const data = useCurves(exps);
  const keys = useMemo(() => [...new Set(Object.values(data).flatMap(c => c.keys))].sort(), [data]);
  const [metric, setMetric] = useState('action_loss');
  const [logY, setLogY] = useState(true);
  const series: Series[] = exps.map((e, i) => ({ name: e, color: PALETTE[i % PALETTE.length], points: trainSeries(data[e], metric) }));
  const valSeries: Series[] = exps.map((e, i) => {
    const byStep = new Map<number, number>();
    (data[e]?.val ?? []).forEach(v => byStep.set(v.step, Math.min(byStep.get(v.step) ?? Infinity, v.mse)));
    return { name: e, color: PALETTE[i % PALETTE.length], dots: true, points: [...byStep].sort((a, b) => a[0] - b[0]) };
  });
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: dark ? '#1f1f1f' : '#fff', border: `1px solid ${dark ? '#303030' : '#e5e5e5'}` }}>
      <Space wrap style={{ marginBottom: 6 }}>
        <b>对比 {exps.length} 个实验</b>
        <Select size="small" style={{ width: 180 }} value={metric} onChange={setMetric} options={keys.map(k => ({ value: k, label: k }))} />
        <span><Switch size="small" checked={logY} onChange={setLogY} /> 对数纵轴</span>
        <Button size="small" onClick={onClear}>取消选择</Button>
      </Space>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
        <LineChart title={`训练 ${metric}`} series={series} logY={logY} />
        <LineChart title="val action MSE（每个 ckpt 取各验证集最小值）" series={valSeries} logY={logY} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 11, marginTop: 4 }}>
        {exps.map((e, i) => <span key={e}><span style={{ color: PALETTE[i % PALETTE.length] }}>■</span> {e}</span>)}
      </div>
    </div>
  );
}

export function Detail({ row, dark, allTags, onChanged, onClose }: { row: Row | null; dark: boolean; allTags: string[]; onChanged: () => void; onClose: () => void }) {
  const exps = useMemo(() => (row ? [row.exp] : []), [row]);
  const c = useCurves(exps)[row?.exp ?? ''];
  const lossKeys = (c?.keys ?? []).filter(k => k.endsWith('loss'));
  const otherKeys = (c?.keys ?? []).filter(k => !k.endsWith('loss'));
  const sets = [...new Set((c?.val ?? []).map(v => v.set))];
  const probeKeys = [...new Set((c?.probe ?? []).flatMap(p => Object.keys(p).filter(k => k.endsWith('_mse') || k.endsWith('_loss'))))];
  return (
    <Drawer open={!!row} onClose={onClose} width="min(1100px, 96vw)" title={row?.exp} destroyOnHidden
      getContainer={() => (document.fullscreenElement as HTMLElement | null) ?? document.body}>
      {row && (
        <>
          <Descriptions size="small" column={{ xs: 1, md: 2, xl: 3 }} bordered style={{ marginBottom: 14 }}>
            <Descriptions.Item label="状态"><Tag color={STATUS_COLOR[row.status] ?? 'default'}>{STATUS_ZH[row.status] ?? row.status}</Tag>{row.task}</Descriptions.Item>
            <Descriptions.Item label="版本 / commit / TS">{row.version} / {row.commit ?? '-'} / {row.ts ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="迭代">{row.step ?? '-'} / {row.max_steps ?? '?'}{row.eta_h != null && `（剩余 ${row.eta_h.toFixed(1)} h）`}</Descriptions.Item>
            <Descriptions.Item label="loss / action loss">{num(row.loss)} / {num(row.action_loss)}（近 5 次均值 {num(row.action_loss_mean5)}）</Descriptions.Item>
            <Descriptions.Item label="最优 val MSE">{row.val_best ? `${row.val_best.mse.toFixed(4)} @${row.val_best.step} [${row.val_best.set}]` : '-'}</Descriptions.Item>
            <Descriptions.Item label="ckpt">{c?.checkpoints?.join(', ') || '-'}</Descriptions.Item>
            <Descriptions.Item label="初始化">{row.parent ?? 'base（预训练权重）'}</Descriptions.Item>
            <Descriptions.Item label="lr / bs 每卡 / GPU">{row.lr ?? '-'} / {row.batch_per_device ?? '-'} / {row.gpus ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="s/it">{num(row.s_per_it, 2)}</Descriptions.Item>
            <Descriptions.Item label="数据集" span={3}>{(row.dataset_paths ?? row.datasets).map(d => <div key={d} style={{ fontSize: 12 }}>{d}</div>)}</Descriptions.Item>
            <Descriptions.Item label="数据处理标签" span={3}>{row.data_tags.map(t => <Tag key={t}>{t}</Tag>)}</Descriptions.Item>
            <Descriptions.Item label="标签" span={3}><TagCell exp={row.exp} info={row.tag_info ?? []} allTags={allTags} onChanged={onChanged} /></Descriptions.Item>
            <Descriptions.Item label="训练标签" span={3}>{row.train_tags.map(t => <Tag key={t} color="blue">{t}</Tag>)}</Descriptions.Item>
            <Descriptions.Item label="目录" span={3}>
              <a href={`${BASE}/?root=${encodeURIComponent(row.work_dir ?? '')}`} target="_blank" rel="noreferrer">{row.work_dir}</a>
            </Descriptions.Item>
          </Descriptions>
          {!c ? <Empty description="加载曲线中…" /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, color: dark ? '#ddd' : '#222' }}>
              {lossKeys.map(k => <LineChart key={k} title={k} logY series={[{ name: k, color: k === 'action_loss' ? '#ff7a45' : '#4c8dff', points: trainSeries(c, k) }]} />)}
              {sets.length > 0 && (
                <LineChart title="val action MSE（matched_mse，归一化）" series={sets.map((s, i) => ({
                  name: s, color: PALETTE[i % PALETTE.length], dots: true,
                  points: c.val.filter(v => v.set === s).map(v => [v.step, v.mse] as [number, number]).sort((a, b) => a[0] - b[0]),
                }))} />
              )}
              {probeKeys.length > 0 && (
                <LineChart title="watchdog-v1 探针" series={probeKeys.map((k, i) => ({
                  name: k, color: PALETTE[i % PALETTE.length], dots: true, dashed: k.endsWith('_loss'),
                  points: c.probe.filter(p => typeof p[k] === 'number').map(p => [p.step, p[k]] as [number, number]),
                }))} />
              )}
              {otherKeys.map(k => <LineChart key={k} title={k} series={[{ name: k, color: '#8c8c8c', points: trainSeries(c, k) }]} logY={k === 'lr'} />)}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- natural-language filter (backend/api/exps_chat.py)
interface ChatMsg { role: 'user' | 'ai' | 'error'; text: string; filters?: Partial<Filters>; exps?: string[]; hashtags?: string[]; meta?: string }

function filterSummary(f: Partial<Filters> = {}, exps: string[] = [], hashtags: string[] = []) {
  const parts: string[] = hashtags.map(h => `#${h}`);
  if (f.q) parts.push(`名称: ${f.q}`);
  (['version', 'datasets', 'data_tags', 'train_tags', 'status'] as const).forEach(k => f[k]?.length && parts.push(`${k}: ${f[k]!.join(', ')}`));
  if (f.tags?.length) parts.push(`标签: ${f.tags.join(', ')}`);
  if (f.live) parts.push('仅运行中');
  if (exps.length) parts.push(`指定 ${exps.length} 个实验`);
  return parts.length ? parts.join(' · ') : '清空筛选';
}

type Apply = (f: Partial<Filters>, names: string[], hashtags: string[]) => void;
export function Chat({ dark, suggestions, count, onApply, onTagged }: {
  dark: boolean; suggestions: string[]; count: (f: Partial<Filters>, names: string[], hashtags: string[]) => number; onApply: Apply; onTagged: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<string | null>(null);

  const send = async () => {
    const m = text.trim();
    if (!m || busy) return;
    const { hashtags, rest } = splitHashtags(m);
    setMsgs(x => [...x, { role: 'user', text: m }]); setText('');
    if (!rest) {  // only #tags: filter locally, no Claude call
      onApply({}, [], hashtags);
      setMsgs(x => [...x, { role: 'ai', text: `按标签筛选，命中 ${count({}, [], hashtags)} 个实验`, filters: {}, exps: [], hashtags, meta: '本地' }]);
      return;
    }
    onApply({}, [], hashtags);  // the #tags apply at once; Claude refines with the rest
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/api/exps/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m, session_id: session }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail ?? `HTTP ${r.status}`);
      setSession(d.session_id);
      setMsgs(x => [...x, { role: 'ai', text: d.answer, filters: d.filters, exps: d.exps, hashtags, meta: `${d.seconds}s · $${(d.cost_usd ?? 0).toFixed(2)}` }]);
      onApply(d.filters ?? {}, d.exps ?? [], hashtags);
      if (d.tag_ops?.length) onTagged();
    } catch (e) {
      setMsgs(x => [...x, { role: 'error', text: String(e) }]);
    } finally {
      setBusy(false);
    }
  };

  const bubble = (m: ChatMsg) => ({
    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '6px 10px', borderRadius: 8, fontSize: 13,
    background: m.role === 'user' ? (dark ? '#15325b' : '#e6f0ff') : m.role === 'error' ? (dark ? '#3a1414' : '#fff1f0') : (dark ? '#262626' : '#f5f5f5'),
  } as const);

  return (
    <Collapse size="small" style={{ marginBottom: 10 }} defaultActiveKey={['chat']} items={[{
      key: 'chat', label: <span>用自然语言筛选 <span style={{ opacity: 0.55, fontSize: 12 }}>（Claude Code 作为后端，可读快照、docs 以及所有 Claude Code 对话与记忆；每次约 10–30 s）</span></span>,
      extra: session ? <a onClick={e => { e.stopPropagation(); setSession(null); setMsgs([]); }}>新对话</a> : null,
      children: (
        <div>
          {msgs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto', marginBottom: 8 }}>
              {msgs.map((m, i) => (
                <div key={i} style={bubble(m)}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  {m.role === 'ai' && (
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 3 }}>
                      已应用：{filterSummary(m.filters, m.exps, m.hashtags)} · {m.meta} · <a onClick={() => onApply(m.filters ?? {}, m.exps ?? [], m.hashtags ?? [])}>重新应用</a>
                    </div>
                  )}
                </div>
              ))}
              {busy && <div style={{ ...bubble({ role: 'ai', text: '' }), opacity: 0.6 }}>Claude 正在查找…</div>}
            </div>
          )}
          <Space.Compact style={{ width: '100%' }}>
            <Mentions
              prefix="#" value={text} onChange={setText} autoSize={{ minRows: 1, maxRows: 4 }} disabled={busy}
              options={suggestions.map(t => ({ value: t, label: t }))}
              filterOption={(input, o) => String(o.value ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="例：#best #v15 / #ft action loss 最低的两个 / 昨天讨论 shake 的那几个实验（#标签 本地即时筛选，命中任一即显示，按命中数→版本→loss 排序；其余文字交给 Claude；Enter 发送，Shift+Enter 换行）"
              onKeyDown={e => {
                if (e.key !== 'Enter' || e.shiftKey) return;
                // while a #word with suggestions is being typed, Enter picks the suggestion (Mentions handles it)
                const el = e.target as HTMLTextAreaElement;
                const word = el.value.slice(0, el.selectionStart ?? el.value.length).split(/\s/).pop() ?? '';
                if (word.startsWith('#') && suggestions.some(t => t.toLowerCase().includes(word.slice(1).toLowerCase()))) return;
                e.preventDefault(); send();
              }}
            />
            <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={send} style={{ height: 'auto' }}>发送</Button>
          </Space.Compact>
        </div>
      ),
    }]} />
  );
}

// ---------------------------------------------------------------- user / Claude tags (backend/api/exp_tags.py)
async function editTags(exps: string[], add: string[], remove: string[] = []) {
  const r = await fetch(`${BASE}/api/exps/tags`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exps, add, remove }),
  });
  if (!r.ok) message.error(`标签保存失败：HTTP ${r.status}`);
}

export function TagCell({ exp, info, allTags, onChanged }: { exp: string; info: TagInfo[]; allTags: string[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState<string[]>([]);
  const commit = async (add: string[], remove: string[] = []) => {
    if (!add.length && !remove.length) return;
    await editTags([exp], add, remove);
    onChanged();
  };
  return (
    <Space size={[0, 4]} wrap>
      {info.map(t => (
        <Tooltip key={t.tag} title={`${t.by === 'claude' ? 'Claude' : '用户'}添加 · ${new Date(t.t * 1000).toLocaleString('zh-CN', { hour12: false })}${t.note ? `\n${t.note}` : ''}`}>
          <Tag color={t.by === 'claude' ? 'purple' : 'geekblue'} closable onClose={e => { e.preventDefault(); commit([], [t.tag]); }}>
            {t.by === 'claude' ? '✦ ' : ''}{t.tag}
          </Tag>
        </Tooltip>
      ))}
      {adding ? (
        <Select
          mode="tags" size="small" autoFocus defaultOpen style={{ minWidth: 140 }} value={val} onChange={setVal}
          tokenSeparators={[',', '，']} placeholder="输入或选择" options={allTags.filter(t => !info.some(i => i.tag === t)).map(t => ({ value: t, label: t }))}
          onBlur={() => { commit(val); setVal([]); setAdding(false); }}
        />
      ) : (
        <Tag onClick={e => { e.stopPropagation(); setAdding(true); }} style={{ borderStyle: 'dashed', cursor: 'pointer', background: 'transparent' }}>+ 标签</Tag>
      )}
    </Space>
  );
}

function BulkTags({ exps, rows, allTags, onChanged }: { exps: string[]; rows: Row[]; allTags: string[]; onChanged: () => void }) {
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const present = [...new Set(rows.filter(r => exps.includes(r.exp)).flatMap(r => r.tags ?? []))];
  const apply = async () => {
    await editTags(exps, add, remove);
    setAdd([]); setRemove([]); onChanged();
  };
  return (
    <Space wrap style={{ marginBottom: 8 }}>
      <b>已选 {exps.length} 个实验：</b>
      <Select mode="tags" size="small" style={{ minWidth: 220 }} placeholder="批量添加标签" value={add} onChange={setAdd}
        tokenSeparators={[',', '，']} options={allTags.map(t => ({ value: t, label: t }))} />
      <Select mode="multiple" size="small" style={{ minWidth: 180 }} placeholder="批量移除标签" value={remove} onChange={setRemove}
        options={present.map(t => ({ value: t, label: t }))} />
      <Button size="small" type="primary" disabled={!add.length && !remove.length} onClick={apply}>应用</Button>
    </Space>
  );
}

// ---------------------------------------------------------------- #tag input
/** "#best #v15 lowest loss" -> hashtags ['best', 'v15'], rest 'lowest loss'. */
function splitHashtags(m: string) {
  const hashtags = [...m.matchAll(/#([^\s#]+)/g)].map(x => x[1]);
  return { hashtags, rest: m.replace(/#[^\s#]+/g, ' ').replace(/\s+/g, ' ').trim() };
}

/** Suggestion list for '#': every tag-like value, most used first. */
export function hashSuggestions(rows: Row[]) {
  const n = new Map<string, number>();
  rows.forEach(r => [...(r.tags ?? []), r.version, ...(r.data_tags ?? []), ...(r.train_tags ?? []), ...(r.datasets ?? [])]
    .filter(t => t && t !== '-').forEach(t => n.set(t, (n.get(t) ?? 0) + 1)));
  return [...n].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** Read-only view of what is applied (set by the chat or #tags), each part removable. */
export function ActiveFilters({ f, onChange }: { f: Filters; onChange: (f: Filters) => void }) {
  const chips: { key: string; label: string; clear: () => Filters }[] = [];
  f.hashtags.forEach(h => chips.push({ key: `#${h}`, label: `#${h}`, clear: () => ({ ...f, hashtags: f.hashtags.filter(x => x !== h) }) }));
  if (f.q) chips.push({ key: 'q', label: `名称: ${f.q}`, clear: () => ({ ...f, q: '' }) });
  (['version', 'datasets', 'data_tags', 'train_tags', 'tags', 'status'] as const).forEach(k => f[k].forEach(v =>
    chips.push({ key: `${k}:${v}`, label: `${k}: ${v}`, clear: () => ({ ...f, [k]: f[k].filter(x => x !== v) }) })));
  if (f.live) chips.push({ key: 'live', label: '仅运行中', clear: () => ({ ...f, live: false }) });
  if (f.names.length) chips.push({ key: 'names', label: `AI 选定 ${f.names.length} 个实验`, clear: () => ({ ...f, names: [] }) });
  if (!chips.length) return null;
  return (
    <Space wrap size={[4, 4]} style={{ marginBottom: 8 }}>
      <span style={{ opacity: 0.6, fontSize: 12 }}>当前筛选：</span>
      {chips.map(c => <Tag key={c.key} color={c.key.startsWith('#') ? 'blue' : c.key === 'names' ? 'purple' : 'default'} closable onClose={e => { e.preventDefault(); onChange(c.clear()); }}>{c.label}</Tag>)}
      <a onClick={() => onChange(EMPTY)}>清空</a>
    </Space>
  );
}

/** Every user / Claude tag with its run count; click to add or drop it as a #tag filter (several = all of). */
export function TagBar({ facets, rows, selected, onToggle }: { facets: [string, number][]; rows: Row[]; selected: string[]; onToggle: (t: string) => void }) {
  const byUser = new Set(rows.flatMap(r => (r.tag_info ?? []).filter(t => t.by === 'user').map(t => t.tag)));
  if (!facets.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 2px', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ opacity: 0.6, fontSize: 12, marginRight: 6 }}>标签（点击筛选；命中任一即显示，按命中数→版本→loss 排序）：</span>
      {facets.map(([t, n]) => (
        <Tag.CheckableTag key={t} checked={selected.includes(t)} onChange={() => onToggle(t)}
          style={{ border: '1px solid', borderColor: byUser.has(t) ? '#2f54eb' : '#9254de55', fontSize: 12 }}>
          {byUser.has(t) ? '' : '✦ '}#{t} <span style={{ opacity: 0.6 }}>{n}</span>
        </Tag.CheckableTag>
      ))}
    </div>
  );
}
