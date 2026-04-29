import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface PlyViewerProps {
  src: string;
  name: string;
}

interface Stats {
  vertices: number;
  hasColor: boolean;
  hasNormals: boolean;
  isMesh: boolean;
}

export function PlyViewer({ src, name: _name }: PlyViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pointSize, setPointSize] = useState(0.01);
  const pointsRef = useRef<THREE.Points | null>(null);
  const [bgDark, setBgDark] = useState(true);
  const sceneRef = useRef<THREE.Scene | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgDark ? 0x1a1a1a : 0xf5f5f5);
    sceneRef.current = scene;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.001, 10000);
    camera.position.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const axes = new THREE.AxesHelper(0.5);
    scene.add(axes);

    let rafId = 0;
    let disposed = false;

    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    // Load PLY
    setLoading(true);
    setError(null);
    const loader = new PLYLoader();
    loader.load(
      src,
      (geometry) => {
        if (disposed) return;
        const hasColor = !!geometry.getAttribute('color');
        const hasNormals = !!geometry.getAttribute('normal');
        const isMesh = geometry.getIndex() != null;
        const vertices = geometry.getAttribute('position').count;

        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        // Center and scale to fit
        const bbox = geometry.boundingBox!;
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        geometry.translate(-center.x, -center.y, -center.z);

        const sphere = geometry.boundingSphere!;
        const radius = sphere.radius || 1;

        // Fit camera
        const fov = camera.fov * (Math.PI / 180);
        const dist = radius / Math.sin(fov / 2);
        camera.position.set(dist * 0.7, dist * 0.5, dist * 0.9);
        camera.near = Math.max(radius / 1000, 0.0001);
        camera.far = dist * 100;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();

        // Scale axes helper to ~20% of radius
        scene.remove(axes);
        const newAxes = new THREE.AxesHelper(radius * 0.2);
        scene.add(newAxes);

        let object: THREE.Object3D;
        if (isMesh) {
          if (!hasNormals) geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            vertexColors: hasColor,
            color: hasColor ? 0xffffff : 0xaaaaaa,
            side: THREE.DoubleSide,
            flatShading: true,
          });
          object = new THREE.Mesh(geometry, material);
          // Add lights for mesh
          const amb = new THREE.AmbientLight(0xffffff, 0.5);
          const dir = new THREE.DirectionalLight(0xffffff, 0.8);
          dir.position.set(1, 1, 1);
          scene.add(amb, dir);
        } else {
          const material = new THREE.PointsMaterial({
            size: radius * 0.003,
            vertexColors: hasColor,
            color: hasColor ? 0xffffff : 0x88ccff,
            sizeAttenuation: true,
          });
          const points = new THREE.Points(geometry, material);
          pointsRef.current = points;
          setPointSize(radius * 0.003);
          object = points;
        }
        scene.add(object);

        setStats({ vertices, hasColor, hasNormals, isMesh });
        setLoading(false);
      },
      undefined,
      (err) => {
        if (disposed) return;
        console.error('PLY load error:', err);
        setError('Failed to load PLY file');
        setLoading(false);
      }
    );

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
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
        const mat = (obj as THREE.Mesh).material;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      pointsRef.current = null;
      sceneRef.current = null;
    };
  }, [src]);

  // Update point size live
  useEffect(() => {
    const pts = pointsRef.current;
    if (pts) {
      (pts.material as THREE.PointsMaterial).size = pointSize;
    }
  }, [pointSize]);

  // Update background live
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) scene.background = new THREE.Color(bgDark ? 0x1a1a1a : 0xf5f5f5);
  }, [bgDark]);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--bg-panel)', padding: 8, borderRadius: 6,
        border: '1px solid var(--border-color)', fontSize: 11,
        color: 'var(--text-primary)', minWidth: 180,
      }}>
        {stats && (
          <>
            <div>Vertices: {stats.vertices.toLocaleString()}</div>
            <div>Type: {stats.isMesh ? 'Mesh' : 'Point Cloud'}</div>
            <div>Color: {stats.hasColor ? 'yes' : 'no'} · Normals: {stats.hasNormals ? 'yes' : 'no'}</div>
          </>
        )}
        {!stats?.isMesh && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            Size:
            <input
              type="range"
              min={0.0001}
              max={pointSize * 10 || 0.1}
              step={pointSize / 100 || 0.0001}
              value={pointSize}
              onChange={(e) => setPointSize(parseFloat(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={bgDark} onChange={(e) => setBgDark(e.target.checked)} />
          Dark background
        </label>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Drag: rotate · Right-drag: pan · Wheel: zoom
        </div>
      </div>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)', fontSize: 13,
        }}>
          Loading PLY...
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#ff6b6b', fontSize: 13,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
