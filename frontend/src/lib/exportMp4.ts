import { message } from 'antd';

/**
 * Hit /api/export_mp4 for *path* (optionally inside dataset *key*) and trigger
 * a browser download. Shows a loading toast while ffmpeg encodes, and a
 * success / error toast on completion. Use from any viewer that knows
 * which sequence the user has selected.
 */
export async function exportSequenceToMp4(opts: {
  apiBase: string;
  path: string;
  key?: string;
  fps?: number;
}): Promise<void> {
  const { apiBase, path, key, fps = 10 } = opts;
  const params = new URLSearchParams({ path, fps: String(fps) });
  if (key) params.set('key', key);
  const url = `${apiBase}/api/export_mp4?${params.toString()}`;
  const hide = message.loading('Encoding mp4 — first time can take a while…', 0);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
      throw new Error(detail);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const filename = m?.[1] || (path.split('/').pop() || 'export') + '.mp4';
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
    hide();
    message.success(`Exported ${filename}`);
  } catch (e: any) {
    hide();
    message.error(`Export failed: ${e?.message || 'Unknown error'}`);
  }
}
