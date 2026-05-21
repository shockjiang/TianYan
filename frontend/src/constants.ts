export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']);
export const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv']);
export const TEXT_EXTS = new Set([
  '.txt', '.log', '.csv', '.yaml', '.yml', '.xml', '.md',
  '.sh', '.bash', '.zsh', '.fish',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.css',
  '.c', '.cpp', '.h', '.hpp', '.java', '.go', '.rs', '.rb', '.php',
  '.toml', '.ini', '.cfg', '.conf', '.env',
  '.gitignore', '.dockerignore', '.editorconfig',
  '.makefile', '.cmake',
]);
export const TABULAR_EXTS = new Set(['.jsonl', '.jsonlines', '.parquet', '.pq']);
export const PLY_EXTS = new Set(['.ply']);
export const USD_EXTS = new Set(['.usd', '.usda', '.usdc', '.usdz']);
export const H5_EXTS = new Set(['.h5', '.hdf5']);
export const HTML_EXTS = new Set(['.html', '.htm']);
export const TEXT_NAMES = new Set([
  'makefile', 'dockerfile', 'readme', 'license', 'changelog',
  'authors', 'contributors', 'todo', 'notes',
  'gemfile', 'rakefile', 'vagrantfile', 'procfile',
]);
