import { useState, useEffect, useRef } from 'react';
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
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.json': 'json',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.css': 'css',
  '.html': 'markup',
  '.htm': 'markup',
  '.xml': 'markup',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.makefile': 'makefile',
};

const NAME_TO_LANG: Record<string, string> = {
  'makefile': 'makefile',
  'dockerfile': 'docker',
  'gemfile': 'ruby',
  'rakefile': 'ruby',
};

function getLanguage(name: string): string | undefined {
  const lower = name.toLowerCase();
  // Check by filename first
  const nameLang = NAME_TO_LANG[lower];
  if (nameLang) return nameLang;
  // Check by extension
  const dot = lower.lastIndexOf('.');
  if (dot >= 0) {
    const ext = lower.slice(dot);
    return EXT_TO_LANG[ext];
  }
  return undefined;
}

const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB

export function TextViewer({ src, name }: TextViewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch(src)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const size = parseInt(res.headers.get('content-length') || '0');
        if (size > MAX_TEXT_SIZE) throw new Error(`File too large to preview (${(size / 1024 / 1024).toFixed(1)} MB). Max: 10 MB`);
        return res.text();
      })
      .then(setText)
      .catch(e => setError(e.message));
  }, [src]);

  useEffect(() => {
    if (text !== null && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [text, name]);

  if (error) return <div style={{ padding: 24, color: '#f44' }}>Error: {error}</div>;
  if (text === null) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Loading...</div>;

  const lang = getLanguage(name);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 0 }}>
      <pre className="line-numbers" style={{
        margin: 0,
        padding: 16,
        fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: 13,
        lineHeight: 1.6,
        background: 'transparent',
        color: 'var(--text-primary)',
        tabSize: 4,
      }}>
        <code ref={codeRef} className={lang ? `language-${lang}` : ''}>
          {text}
        </code>
      </pre>
    </div>
  );
}
