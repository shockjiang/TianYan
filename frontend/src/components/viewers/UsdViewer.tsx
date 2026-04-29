import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface UsdViewerProps {
  src: string;
  name: string;
  apiBase?: string;
  path?: string;
}

interface Meta {
  is_time_sampled: boolean;
  prim_type: string;
  prim_path?: string;
  start_time: number;
  end_time: number;
  fps: number;
  up_axis: string;
  n_frames?: number;
  times?: number[];
  has_colors?: boolean;
  n_points_first_frame?: number;
  bbox_min?: [number, number, number];
  bbox_max?: [number, number, number];
}

interface FrameData {
  positions: Float32Array;
  colors: Uint8Array;
}

async function fetchFrame(apiBase: string, path: string, time: number): Promise<FrameData> {
  const r = await fetch(`${apiBase}/api/usd/frame?path=${encodeURIComponent(path)}&time=${time}`);
  if (!r.ok) throw new Error(`frame fetch failed: ${r.status}`);
  const buf = await r.arrayBuffer();
  const view = new DataView(buf);
  const n = view.getUint32(0, true);
  const positions = new Float32Array(buf.slice(4, 4 + n * 12));
  const colors = new Uint8Array(buf.slice(4 + n * 12, 4 + n * 12 + n * 3));
  return { positions, colors };
}

export function UsdViewer({ src, name: _name, apiBase, path }: UsdViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const cameraFittedRef = useRef(false);
  const frameCacheRef = useRef<Map<number, FrameData>>(new Map());
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const axesRef = useRef<THREE.AxesHelper | null>(null);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bgDark, setBgDark] = useState(true);
  const [pointSize, setPointSize] = useState(0.005);

  // Animation state
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [currentStats, setCurrentStats] = useState<{ n: number } | null>(null);

  // 1. Fetch meta first to decide which path to take
  useEffect(() => {
    if (apiBase === undefined || !path) return;
    setMetaError(null);
    fetch(`${apiBase}/api/usd/meta?path=${encodeURIComponent(path)}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({ detail: r.statusText }));
          throw new Error(j.detail || r.statusText);
        }
        return r.json();
      })
      .then((m: Meta) => setMeta(m))
      .catch((e) => setMetaError(e.message || String(e)));
  }, [apiBase, path]);

  // 2. Set up three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgDark ? 0x1a1a1a : 0xf5f5f5);
    sceneRef.current = scene;

    const w = container.clientWidth;
    const h = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.001, 10000);
    camera.position.set(0, 0, 2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-4, 2, -3);
    scene.add(amb, key, fill);

    const axes = new THREE.AxesHelper(0.3);
    scene.add(axes);
    axesRef.current = axes;

    let rafId = 0;
    let disposed = false;
    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    const handleResize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat.dispose();
        }
      });
      sceneRef.current = null;
      pointsRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      axesRef.current = null;
      cameraFittedRef.current = false;
      frameCacheRef.current.clear();
    };
  }, [src]);

  // 3a. Static path: once meta says not animated, run USDLoader
  useEffect(() => {
    if (!meta || meta.is_time_sampled) return;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    setLoading(true);
    setError(null);
    const loader = new USDLoader();
    loader.load(
      src,
      (group) => {
        let meshes = 0;
        group.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) meshes++;
        });
        const box = new THREE.Box3().setFromObject(group);
        if (!box.isEmpty()) {
          const sphere = new THREE.Sphere();
          box.getBoundingSphere(sphere);
          const radius = sphere.radius || 1;
          group.position.sub(sphere.center);
          const fov = camera.fov * (Math.PI / 180);
          const dist = radius / Math.sin(fov / 2);
          camera.position.set(dist * 0.7, dist * 0.5, dist * 0.9);
          camera.near = Math.max(radius / 1000, 0.0001);
          camera.far = dist * 100;
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
        }
        scene.add(group);
        if (meshes === 0) {
          setError('No mesh or point geometry found in this USD file.');
        }
        setLoading(false);
      },
      undefined,
      (err) => {
        setError(`USD load failed: ${err instanceof Error ? err.message : String(err)}`);
        setLoading(false);
      }
    );
  }, [meta, src]);

  // 3b. Animated path helpers
  const setFrameData = useCallback((data: FrameData) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls || !meta) return;

    // Float32 color 0..1 for three.js vertex colors
    const cn = data.colors.length;
    const colorF = new Float32Array(cn);
    for (let i = 0; i < cn; i++) colorF[i] = data.colors[i] / 255;

    let pts = pointsRef.current;
    if (!pts) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(colorF, 3));
      const mat = new THREE.PointsMaterial({
        size: pointSize,
        vertexColors: true,
        sizeAttenuation: true,
      });
      pts = new THREE.Points(geom, mat);
      pointsRef.current = pts;
      scene.add(pts);
    } else {
      // Reuse if same N, else replace buffers
      const posAttr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (posAttr.count === data.positions.length / 3) {
        (posAttr.array as Float32Array).set(data.positions);
        posAttr.needsUpdate = true;
        const colAttr = pts.geometry.getAttribute('color') as THREE.BufferAttribute;
        (colAttr.array as Float32Array).set(colorF);
        colAttr.needsUpdate = true;
      } else {
        pts.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
        pts.geometry.setAttribute('color', new THREE.BufferAttribute(colorF, 3));
      }
    }
    pts.geometry.computeBoundingSphere();

    if (!cameraFittedRef.current && meta.bbox_min && meta.bbox_max) {
      const min = new THREE.Vector3(...meta.bbox_min);
      const max = new THREE.Vector3(...meta.bbox_max);
      const center = min.clone().add(max).multiplyScalar(0.5);
      const radius = max.clone().sub(min).length() * 0.5 || 1;

      // Z-up (common in robotics) — rotate the scene so Y-up three.js shows it correctly
      if (meta.up_axis === 'Z' && pts) {
        pts.rotation.x = -Math.PI / 2;
      }

      const fov = camera.fov * (Math.PI / 180);
      const dist = radius / Math.sin(fov / 2);
      // Camera position respects Z-up remap
      const cx = center.x;
      const cy = meta.up_axis === 'Z' ? center.z : center.y;
      const cz = meta.up_axis === 'Z' ? -center.y : center.z;
      camera.position.set(cx + dist * 0.7, cy + dist * 0.5, cz + dist * 0.9);
      camera.near = Math.max(radius / 1000, 0.0001);
      camera.far = dist * 100;
      camera.updateProjectionMatrix();
      controls.target.set(cx, cy, cz);
      controls.update();

      // Scale axes helper to scene
      if (axesRef.current) {
        scene.remove(axesRef.current);
        const newAxes = new THREE.AxesHelper(radius * 0.2);
        scene.add(newAxes);
        axesRef.current = newAxes;
      }

      // Pick a reasonable default point size
      setPointSize(radius * 0.003);
      cameraFittedRef.current = true;
    }

    setCurrentStats({ n: data.positions.length / 3 });
  }, [meta, pointSize]);

  // 3c. Fetch current frame when animated + frame index changes
  useEffect(() => {
    if (!meta || !meta.is_time_sampled || apiBase === undefined || !path) return;
    const times = meta.times!;
    const t = times[Math.max(0, Math.min(frame, times.length - 1))];

    // Serve from cache if we have it
    const cached = frameCacheRef.current.get(t);
    if (cached) {
      setFrameData(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    fetchFrame(apiBase, path, t)
      .then((data) => {
        if (cancelled) return;
        frameCacheRef.current.set(t, data);
        // Cap cache (simple FIFO)
        if (frameCacheRef.current.size > 40) {
          const firstKey = frameCacheRef.current.keys().next().value;
          if (firstKey !== undefined) frameCacheRef.current.delete(firstKey);
        }
        setFrameData(data);
        setLoading(false);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(`Frame fetch failed: ${e.message || e}`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meta, frame, apiBase, path, setFrameData]);

  // 3d. Prefetch next few frames
  useEffect(() => {
    if (!meta || !meta.is_time_sampled || apiBase === undefined || !path) return;
    const times = meta.times!;
    for (let k = 1; k <= 3; k++) {
      const i = (frame + k) % times.length;
      const t = times[i];
      if (frameCacheRef.current.has(t)) continue;
      fetchFrame(apiBase, path, t)
        .then((data) => frameCacheRef.current.set(t, data))
        .catch(() => {});
    }
  }, [meta, frame, apiBase, path]);

  // 3e. Playback loop
  useEffect(() => {
    if (!playing || !meta || !meta.is_time_sampled) return;
    const n = meta.n_frames || 1;
    const fps = Math.max(1, Math.min(60, meta.fps || 20));
    const interval = setInterval(() => {
      setFrame((f) => {
        const next = f + 1;
        if (next >= n) return loop ? 0 : f;
        return next;
      });
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [playing, meta, loop]);

  // Live updates: bg, point size
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) scene.background = new THREE.Color(bgDark ? 0x1a1a1a : 0xf5f5f5);
  }, [bgDark]);

  useEffect(() => {
    const pts = pointsRef.current;
    if (pts) (pts.material as THREE.PointsMaterial).size = pointSize;
  }, [pointSize]);

  const isAnim = meta?.is_time_sampled;

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ flex: 1, position: 'relative' }} />

      {/* HUD */}
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--bg-panel)', padding: 8, borderRadius: 6,
        border: '1px solid var(--border-color)', fontSize: 11,
        color: 'var(--text-primary)', minWidth: 200,
      }}>
        {meta && (
          <>
            <div>Type: {meta.prim_type}{isAnim ? ' (animated)' : ''}</div>
            {meta.prim_path && <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{meta.prim_path}</div>}
            {isAnim && <div>Frames: {meta.n_frames} @ {meta.fps.toFixed(1)} fps</div>}
            {currentStats && <div>Points: {currentStats.n.toLocaleString()}</div>}
            <div>Up: {meta.up_axis}</div>
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          Size
          <input
            type="range" min={0.0001} max={pointSize * 10 || 0.1}
            step={pointSize / 100 || 0.0001} value={pointSize}
            onChange={(e) => setPointSize(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={bgDark} onChange={(e) => setBgDark(e.target.checked)} />
          Dark bg
        </label>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Drag: rotate · Right-drag: pan · Wheel: zoom
        </div>
      </div>

      {/* Playback controls (animated only) */}
      {isAnim && meta.n_frames && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8, right: 8, zIndex: 10,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
          borderRadius: 6, padding: 8, display: 'flex', alignItems: 'center', gap: 8,
          color: 'var(--text-primary)', fontSize: 12,
        }}>
          <button
            onClick={() => setPlaying((p) => !p)}
            style={{
              padding: '4px 12px', fontSize: 13, cursor: 'pointer',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: 4, minWidth: 60,
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            type="range" min={0} max={meta.n_frames - 1} step={1} value={frame}
            onChange={(e) => { setPlaying(false); setFrame(parseInt(e.target.value, 10)); }}
            style={{ flex: 1 }}
          />
          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>
            {frame + 1} / {meta.n_frames}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Loop
          </label>
        </div>
      )}

      {metaError && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#ff6b6b', fontSize: 13, padding: 16, textAlign: 'center',
        }}>
          USD meta failed: {metaError}
        </div>
      )}
      {loading && !metaError && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 10,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
          borderRadius: 4, padding: '4px 8px', fontSize: 11, color: 'var(--text-secondary)',
        }}>
          Loading{isAnim ? ` frame ${frame + 1}` : ' USD'}...
        </div>
      )}
      {error && !metaError && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
          background: 'var(--bg-panel)', border: '1px solid #ff6b6b',
          borderRadius: 4, padding: '4px 10px', fontSize: 11, color: '#ff6b6b',
          maxWidth: 400,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
