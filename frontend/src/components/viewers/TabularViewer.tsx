import { useState, useEffect } from 'react';

interface TabularViewerProps {
  path: string;
  name: string;
  apiBase: string;
}

interface TabularData {
  total: number;
  columns: string[];
  head: Record<string, any>[];
  tail: Record<string, any>[];
  head_n: number;
  tail_n: number;
  format: string;
  num_row_groups?: number;
}

function CellValue({ value }: { value: any }) {
  if (value === null || value === undefined) {
    return <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>null</span>;
  }
  if (typeof value === 'boolean') {
    return <span style={{ color: '#ce9178' }}>{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span style={{ color: '#b5cea8' }}>{value}</span>;
  }
  if (typeof value === 'object') {
    const s = JSON.stringify(value);
    const display = s.length > 200 ? s.slice(0, 200) + '...' : s;
    return <span title={s.length > 200 ? s : undefined} style={{ color: '#9cdcfe', fontSize: 11 }}>{display}</span>;
  }
  const s = String(value);
  if (s.length > 200) {
    return <span title={s}>{s.slice(0, 200)}...</span>;
  }
  return <span>{s}</span>;
}

function FullValue({ value }: { value: any }) {
  if (value === null || value === undefined) {
    return <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>null</span>;
  }
  if (typeof value === 'boolean') {
    return <span style={{ color: '#ce9178' }}>{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span style={{ color: '#b5cea8' }}>{value}</span>;
  }
  if (typeof value === 'object') {
    return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#9cdcfe', fontSize: 11 }}>{JSON.stringify(value, null, 2)}</pre>;
  }
  return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{String(value)}</span>;
}

function ExpandedRow({ row, columns }: { row: Record<string, any>; columns: string[] }) {
  return (
    <div style={{
      padding: '8px 16px',
      background: 'var(--bg-secondary)',
      borderBottom: '2px solid var(--accent)',
      maxHeight: 400,
      overflow: 'auto',
    }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace', width: '100%' }}>
        <tbody>
          {columns.map(col => (
            <tr key={col} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{
                padding: '4px 12px 4px 0',
                color: 'var(--accent)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                verticalAlign: 'top',
                width: 1,
              }}>{col}</td>
              <td style={{ padding: '4px 0', verticalAlign: 'top' }}>
                <FullValue value={row[col]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataRow({ row, rowIdx, columns, expanded, onToggle }: {
  row: Record<string, any>;
  rowIdx: number;
  columns: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: expanded ? 'none' : '1px solid var(--border-color)',
          cursor: 'pointer',
          background: expanded ? 'var(--bg-secondary)' : undefined,
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--hover-bg)'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = ''; }}
      >
        <td style={{
          padding: '4px 10px',
          textAlign: 'right',
          color: 'var(--text-secondary)',
          fontSize: 11,
          borderRight: '1px solid var(--border-color)',
          background: 'var(--bg-panel)',
          position: 'sticky',
          left: 0,
        }}>
          <span style={{
            display: 'inline-block',
            width: 16,
            textAlign: 'center',
            color: expanded ? 'var(--accent)' : '#888',
            fontSize: 10,
            marginRight: 2,
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>▶</span>
          {rowIdx}
        </td>
        {columns.map(col => (
          <td key={col} style={{
            padding: '4px 10px',
            maxWidth: 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            borderRight: '1px solid var(--border-color)',
          }}>
            <CellValue value={row[col]} />
          </td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columns.length + 1} style={{ padding: 0 }}>
            <ExpandedRow row={row} columns={columns} />
          </td>
        </tr>
      )}
    </>
  );
}

export function TabularViewer({ path, name, apiBase }: TabularViewerProps) {
  const [data, setData] = useState<TabularData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [headN, setHeadN] = useState(10);
  const [tailN, setTailN] = useState(10);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedRows(new Set());
  }, [path, headN, tailN]);

  const toggleRow = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/api/tabular?path=${encodeURIComponent(path)}&head_n=${headN}&tail_n=${tailN}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed'); });
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, apiBase, headN, tailN]);

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading tabular data...</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: '#ff6b6b' }}>Error: {error}</div>;
  }
  if (!data) return null;

  const gapStart = data.head_n;
  const gapEnd = data.total - data.tail_n;
  const hasGap = gapEnd > gapStart;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontSize: 12,
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {data.total.toLocaleString()} records
        </span>
        <span>{data.columns.length} columns</span>
        <span style={{ textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 600 }}>{data.format}</span>
        {data.num_row_groups != null && <span>{data.num_row_groups} row groups</span>}
        <span style={{ fontSize: 11, opacity: 0.6 }}>Click row to expand</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Head:
            <select value={headN} onChange={e => setHeadN(Number(e.target.value))} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 4px' }}>
              {[10, 20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Tail:
            <select value={tailN} onChange={e => setTailN(Number(e.target.value))} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 4px' }}>
              {[0, 10, 20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{
          borderCollapse: 'collapse',
          fontSize: 12,
          fontFamily: 'monospace',
          width: '100%',
          minWidth: data.columns.length * 120,
        }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <th style={{
                padding: '6px 10px',
                textAlign: 'right',
                background: 'var(--bg-panel)',
                borderBottom: '2px solid var(--border-color)',
                borderRight: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontWeight: 400,
                fontSize: 11,
                position: 'sticky',
                left: 0,
                zIndex: 2,
                minWidth: 60,
              }}>#</th>
              {data.columns.map(col => (
                <th key={col} style={{
                  padding: '6px 10px',
                  textAlign: 'left',
                  background: 'var(--bg-panel)',
                  borderBottom: '2px solid var(--border-color)',
                  borderRight: '1px solid var(--border-color)',
                  color: 'var(--accent)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  maxWidth: 300,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Head rows */}
            {data.head.map((row, i) => (
              <DataRow
                key={`h${i}`}
                row={row}
                rowIdx={i}
                columns={data.columns}
                expanded={expandedRows.has(`h${i}`)}
                onToggle={() => toggleRow(`h${i}`)}
              />
            ))}

            {/* Gap indicator */}
            {hasGap && (
              <tr>
                <td
                  colSpan={data.columns.length + 1}
                  style={{
                    padding: '8px 16px',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-secondary)',
                    fontStyle: 'italic',
                    fontSize: 12,
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  ... {(gapEnd - gapStart).toLocaleString()} records omitted (rows {gapStart} - {gapEnd - 1}) ...
                </td>
              </tr>
            )}

            {/* Tail rows */}
            {data.tail.map((row, i) => {
              const rowIdx = data.total - data.tail_n + i;
              return (
                <DataRow
                  key={`t${i}`}
                  row={row}
                  rowIdx={rowIdx}
                  columns={data.columns}
                  expanded={expandedRows.has(`t${i}`)}
                  onToggle={() => toggleRow(`t${i}`)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
