import { useEffect, useRef, useState } from 'react';
import { Box } from 'lucide-react';
import { wsClient } from '../lib/wsClient';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const CAMERA_ID = 'pointcloud3d';

/**
 * Binary format from backend:
 *   64-byte header (camera_id)  — already stripped by wsClient
 *   4 bytes: uint32 point_count (little-endian)
 *   4 bytes: uint8 has_color flag + 3 reserved
 *   point_count * 12 bytes: Float32[x, y, z] positions
 *   if has_color: point_count * 3 bytes: Uint8[r, g, b] colors
 */
function parsePointCloud(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const hasColor = view.getUint8(4) === 1;
  const posOffset = 8;
  const positions = new Float32Array(data.buffer, data.byteOffset + posOffset, count * 3);
  let colors: Uint8Array | null = null;
  if (hasColor) {
    const colOffset = posOffset + count * 12;
    colors = new Uint8Array(data.buffer, data.byteOffset + colOffset, count * 3);
  }
  return { count, positions, colors };
}

export function PointCloud3DPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    points: THREE.Points | null;
    animId: number;
  } | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<string>('—');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 400;
    const height = 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1117);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 100);
    camera.position.set(0, 2, 3);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);

    const gridHelper = new THREE.GridHelper(10, 20, 0x333333, 0x222222);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(0.5);
    scene.add(axesHelper);

    const ctx = { scene, camera, renderer, controls, points: null as THREE.Points | null, animId: 0 };

    function animate() {
      ctx.animId = requestAnimationFrame(animate);
      ctx.controls.update();
      ctx.renderer.render(ctx.scene, ctx.camera);
    }
    animate();

    sceneRef.current = ctx;

    const onResize = () => {
      const w = container.clientWidth || 400;
      const h = 400;
      ctx.camera.aspect = w / h;
      ctx.camera.updateProjectionMatrix();
      ctx.renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(ctx.animId);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const unsub = wsClient.subscribeFrame(CAMERA_ID, (data: Uint8Array) => {
      const ctx = sceneRef.current;
      if (!ctx) return;

      try {
        const { count, positions, colors } = parsePointCloud(data);
        if (count === 0) return;

        if (ctx.points) {
          ctx.scene.remove(ctx.points);
          ctx.points.geometry.dispose();
          (ctx.points.material as THREE.PointsMaterial).dispose();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        let material: THREE.PointsMaterial;
        if (colors) {
          const floatColors = new Float32Array(count * 3);
          for (let i = 0; i < count * 3; i++) {
            floatColors[i] = colors[i] / 255.0;
          }
          geometry.setAttribute('color', new THREE.Float32BufferAttribute(floatColors, 3));
          material = new THREE.PointsMaterial({ size: 0.02, vertexColors: true, sizeAttenuation: true });
        } else {
          material = new THREE.PointsMaterial({ size: 0.02, color: 0x3b82f6, sizeAttenuation: true });
        }

        const points = new THREE.Points(geometry, material);
        // ROS: X=forward, Y=left, Z=up → Three.js: X=right, Y=up, Z=forward
        points.rotation.x = -Math.PI / 2;
        ctx.scene.add(points);
        ctx.points = points;

        geometry.computeBoundingSphere();
        if (geometry.boundingSphere) {
          const center = geometry.boundingSphere.center.clone();
          center.applyMatrix4(points.matrixWorld);
          ctx.controls.target.copy(center);
        }

        setPointCount(count);
        setLastUpdate(new Date().toLocaleTimeString());
      } catch (e) {
        console.error('[PointCloud3D] Parse error:', e);
      }
    });

    return () => unsub();
  }, []);

  return (
    <div className="panel-card flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Box size={16} className="text-panel-muted" />
        <span className="stat-label">3D Point Cloud</span>
        <span className="ml-auto text-xs text-panel-muted font-mono">RTABMAP</span>
      </div>

      <div className="flex gap-4 text-[10px] font-mono text-panel-muted">
        <span>{pointCount.toLocaleString()} points</span>
        <span>updated {lastUpdate}</span>
        <span className="ml-auto">scroll to zoom, drag to rotate</span>
      </div>

      <div ref={containerRef} className="relative bg-black rounded overflow-hidden" style={{ minHeight: 400 }} />
    </div>
  );
}
