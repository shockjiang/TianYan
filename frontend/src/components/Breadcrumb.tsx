import { Breadcrumb as AntBreadcrumb } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

interface BreadcrumbProps {
  path?: string;
  rootDir: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumb({ path, rootDir, onNavigate }: BreadcrumbProps) {
  if (!path || !rootDir) return null;

  const relative = path.startsWith(rootDir) ? path.slice(rootDir.length) : path;
  const segments = relative.split('/').filter(Boolean);

  const items = [
    {
      title: (
        <span onClick={() => onNavigate(rootDir)} style={{ cursor: 'pointer' }}>
          <HomeOutlined /> {rootDir.split('/').pop() || rootDir}
        </span>
      ),
    },
    ...segments.map((seg, i) => {
      const fullPath = rootDir + '/' + segments.slice(0, i + 1).join('/');
      return {
        title: (
          <span onClick={() => onNavigate(fullPath)} style={{ cursor: 'pointer' }}>
            {seg}
          </span>
        ),
      };
    }),
  ];

  return (
    <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
      <AntBreadcrumb items={items} style={{ fontSize: 13 }} />
    </div>
  );
}
