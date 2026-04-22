import { useState, useEffect, useRef, useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-xml-doc';
import 'prismjs/plugins/line-numbers/prism-line-numbers';
import 'prismjs/plugins/line-numbers/prism-line-numbers.css';

interface TextViewerProps {
  src: string;
  name: string;
}

const EXT_TO_LANG: Record<string, string> = {
  '.py': 'python', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.json': 'json', '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
  '.css': 'css', '.html': 'markup', '.htm': 'markup', '.xml': 'markup',
  '.yaml': 'yaml', '.yml': 'yaml', '.md': 'markdown',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
  '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.toml': 'toml', '.ini': 'ini', '.cfg': 'ini', '.makefile': 'makefile',
  '.log': '', '.csv': '', '.txt': '',
};

const NAME_TO_LANG: Record<string, string> = {
  'makefile': 'makefile', 'dockerfile': 'docker', 'gemfile': 'ruby', 'rakefile': 'ruby',
};

function getLanguage(name: string): string | undefined {
  const lower = name.toLowerCase();
  const nameLang = NAME_TO_LANG[lower];
  if (nameLang) return nameLang;
  const dot = lower.lastIndexOf('.');
  if (dot >= 0) {
    const ext = lower.slice(dot);
    return EXT_TO_LANG[ext];
  }
  return undefined;
}

interface PreviewData {
  total_lines: number;
  head: string[];
  tail: string[];
  head_n: number;
  tail_n: number;
  gap: number;
  full: boolean;
  file_size: number;
}

const DEFAULT_HEAD = 10;
const DEFAULT_TAIL = 10;
const MAX_FULL_SIZE = 10 * 1024 * 1024; // 10MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function HighlightedCode({ text, lang, startLine }: { text: string; lang?: string; startLine: number }) {
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current && lang) {
      Prism.highlightElement(codeRef.current);
    }
  }, [text, lang]);

  return (
    <pre style={{
      margin: 0, padding: 0,
      fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      fontSize: 13, lineHeight: 1.6,
      background: 'transparent', color: 'var(--text-primary)', tabSize: 4,
      counterReset: `linenumber ${startLine - 1}`,
    }}>
      <code ref={codeRef} className={lang ? `language-${lang}` : ''}>
        {text}
      </code>
    </pre>
  );
}

export function TextViewer({ src, name }: TextViewerProps) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headN, setHeadN] = useState(DEFAULT_HEAD);
  const [tailN, setTailN] = useState(DEFAULT_TAIL);

  // Extract path from src URL
  const filePath = useMemo(() => {
    try {
      const url = new URL(src, window.location.origin);
      return url.searchParams.get('path') || '';
    } catch {
      return '';
    }
  }, [src]);

  // Fetch head/tail preview
  useEffect(() => {
    setPreview(null);
    setFullText(null);
    setError(null);
    if (!filePath) return;
    fetch(`/api/text-preview?path=${encodeURIComponent(filePath)}&head_n=${headN}&tail_n=${tailN}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed'); });
        return r.json();
      })
      .then((data: PreviewData) => {
        setPreview(data);
        // If the backend returned the full file, use it directly
        if (data.full) {
          setFullText(data.head.join('\n'));
        }
      })
      .catch(e => setError(e.message));
  }, [filePath, headN, tailN]);

  const loadFullFile = () => {
    if (loadingFull || fullText !== null) return;
    setLoadingFull(true);
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const size = parseInt(res.headers.get('content-length') || '0');
        if (size > MAX_FULL_SIZE) throw new Error(`File too large (${formatSize(size)}). Max: 10 MB`);
        return res.text();
      })
      .then(text => { setFullText(text); })
      .catch(e => setError(e.message))
      .finally(() => setLoadingFull(false));
  };

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;
  if (!preview) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading...</div>;

  const lang = getLanguage(name);
  const showingFull = fullText !== null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Info bar */}
      <div style={{
        padding: '4px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        fontSize: 12, color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {preview.total_lines.toLocaleString()} lines
        </span>
        <span>{formatSize(preview.file_size)}</span>
        {!showingFull && preview.gap > 0 && (
          <span>showing first {preview.head_n} + last {preview.tail_n}</span>
        )}
        {showingFull && <span style={{ color: 'var(--accent)' }}>full file</span>}
        {!showingFull && preview.gap > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Head:
              <select value={headN} onChange={e => { setHeadN(Number(e.target.value)); setFullText(null); }}
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 4px' }}>
                {[10, 20, 50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Tail:
              <select value={tailN} onChange={e => { setTailN(Number(e.target.value)); setFullText(null); }}
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 4px' }}>
                {[0, 10, 20, 50, 100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        {showingFull ? (
          <HighlightedCode text={fullText!} lang={lang} startLine={1} />
        ) : (
          <>
            {/* Head lines */}
            <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 0 }}>
              {preview.head.map((line, i) => (
                <div key={`h${i}`} style={{ display: 'flex', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}>
                  <span style={{
                    width: 55, minWidth: 55, textAlign: 'right', paddingRight: 12,
                    color: 'var(--text-secondary)', fontSize: 11, userSelect: 'none',
                    opacity: 0.5,
                  }}>{i + 1}</span>
                  <span style={{ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</span>
                </div>
              ))}
            </div>

            {/* Gap / expand button */}
            {preview.gap > 0 && (
              <div
                onClick={loadFullFile}
                style={{
                  padding: '10px 16px',
                  textAlign: 'center',
                  color: 'var(--accent)',
                  background: 'var(--bg-secondary)',
                  cursor: loadingFull ? 'wait' : 'pointer',
                  fontSize: 12,
                  borderTop: '1px dashed var(--border-color)',
                  borderBottom: '1px dashed var(--border-color)',
                }}
              >
                {loadingFull
                  ? 'Loading full file...'
                  : `... ${preview.gap.toLocaleString()} lines hidden — click to load full file (${formatSize(preview.file_size)})`}
              </div>
            )}

            {/* Tail lines */}
            {preview.tail.length > 0 && (
              <div style={{ borderLeft: '3px solid #ce93d8', paddingLeft: 0 }}>
                {preview.tail.map((line, i) => {
                  const lineNum = preview.total_lines - preview.tail_n + i + 1;
                  return (
                    <div key={`t${i}`} style={{ display: 'flex', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}>
                      <span style={{
                        width: 55, minWidth: 55, textAlign: 'right', paddingRight: 12,
                        color: 'var(--text-secondary)', fontSize: 11, userSelect: 'none',
                        opacity: 0.5,
                      }}>{lineNum}</span>
                      <span style={{ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
