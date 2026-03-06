import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { wsClient } from '../lib/wsClient';
import { useRosTopic } from '../hooks/useRosTopic';

type CameraInfoData = {
  width: number;
  height: number;
  // K = [fx, 0, cx, 0, fy, cy, 0, 0, 1] (row-major 3×3)
  K: number[];
  distortion_model: string;
};

type MetadataData = {
  data: Record<string, number>;
};

const META_KEYS = {
  RS2_FRAME_METADATA_ACTUAL_EXPOSURE: { label: 'Exp', unit: 'µs' },
  RS2_FRAME_METADATA_GAIN_LEVEL: { label: 'Gain', unit: '' },
} as const;

function CameraFeed({
  cameraId,
  label,
  info,
  meta,
}: {
  cameraId: string;
  label: string;
  info: CameraInfoData | null;
  meta?: MetadataData | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasFrameRef = useRef(false);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const unsub = wsClient.subscribeFrame(cameraId, (jpeg) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const blob = new Blob([jpeg], { type: 'image/jpeg' });
      createImageBitmap(blob).then((bitmap) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) { bitmap.close(); return; }

        // Only resize the canvas when dimensions actually change — avoids clearing it mid-stream
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        if (!hasFrameRef.current) {
          hasFrameRef.current = true;
          setHasFrame(true); // one-time re-render to swap placeholder → canvas
        }
      }).catch((e) => console.error(`[Camera:${cameraId}] decode error`, e));
    });

    return () => unsub();
  }, [cameraId]);

  const fx = info?.K[0];
  const fy = info?.K[4];

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="stat-label">{label}</span>
        {info && (
          <span className="text-xs text-panel-muted font-mono">
            {info.width}×{info.height}
          </span>
        )}
      </div>

      <div className="relative bg-black rounded overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {!hasFrame && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Camera size={20} className="text-panel-border" />
            <span className="text-panel-muted text-xs font-mono">Waiting for stream…</span>
          </div>
        )}

        {/* Canvas is always mounted so it can receive draws before the first render */}
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain"
          style={{ display: hasFrame ? 'block' : 'none' }}
        />

        {/* Metadata overlay */}
        {meta && hasFrame && (
          <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-0.5">
            {Object.entries(META_KEYS).map(([key, { label: lbl, unit }]) => {
              const val = meta.data?.[key];
              if (val == null) return null;
              return (
                <span key={key} className="text-[10px] font-mono bg-black/60 text-gray-300 px-1 rounded">
                  {lbl} {val}{unit}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {info && fx != null && fy != null && (
        <div className="flex gap-3 mt-1 flex-wrap">
          <span className="text-[10px] text-panel-muted font-mono">fx {fx.toFixed(1)}</span>
          <span className="text-[10px] text-panel-muted font-mono">fy {fy.toFixed(1)}</span>
          <span className="text-[10px] text-panel-muted font-mono">{info.distortion_model}</span>
        </div>
      )}
    </div>
  );
}

export function CameraPanel() {
  const { data: colorInfo } = useRosTopic<CameraInfoData>(
    '/camera/camera/color/camera_info'
  );
  const { data: depthInfo } = useRosTopic<CameraInfoData>(
    '/camera/camera/aligned_depth_to_color/camera_info'
  );
  const { data: colorMeta } = useRosTopic<MetadataData>(
    '/camera/camera/color/metadata'
  );
  const { data: depthMeta } = useRosTopic<MetadataData>(
    '/camera/camera/depth/metadata'
  );

  return (
    <div className="panel-card">
      <div className="flex items-center gap-2 mb-4">
        <Camera size={16} className="text-panel-muted" />
        <span className="stat-label">RealSense D455</span>
        <span className="ml-auto text-xs text-panel-muted font-mono">≤15 fps</span>
      </div>

      <div className="flex gap-4">
        <CameraFeed cameraId="color" label="Color" info={colorInfo} meta={colorMeta} />
        <CameraFeed cameraId="aligned_depth" label="Depth (aligned)" info={depthInfo} meta={depthMeta} />
      </div>
    </div>
  );
}
