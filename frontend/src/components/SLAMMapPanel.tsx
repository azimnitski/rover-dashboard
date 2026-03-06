import { useEffect, useRef, useState } from 'react';
import { Map, CheckCircle, Circle } from 'lucide-react';
import { wsClient } from '../lib/wsClient';
import { useRosTopic } from '../hooks/useRosTopic';

type GoalData = { value: boolean };
type OdomData = { position: { x: number; y: number }; yaw: number };

function MapCanvas({ cameraId }: { cameraId: string }) {
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
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        if (!hasFrameRef.current) {
          hasFrameRef.current = true;
          setHasFrame(true);
        }
      });
    });
    return () => unsub();
  }, [cameraId]);

  return (
    <div className="relative bg-black rounded overflow-hidden flex-1" style={{ minHeight: 200 }}>
      {!hasFrame && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Map size={20} className="text-panel-border" />
          <span className="text-panel-muted text-xs font-mono">Waiting for map…</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain"
        style={{ display: hasFrame ? 'block' : 'none' }}
      />
    </div>
  );
}

export function SLAMMapPanel() {
  const { data: goalData } = useRosTopic<GoalData>('/rtabmap/goal_reached');
  const { data: odom } = useRosTopic<OdomData>('/rtabmap/localization_pose');

  const goalReached = goalData?.value ?? false;

  return (
    <div className="panel-card flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Map size={16} className="text-panel-muted" />
        <span className="stat-label">SLAM Map</span>
        <span className="ml-auto text-xs text-panel-muted font-mono">RTABMAP</span>
        {goalData !== null && (
          <div className="flex items-center gap-1">
            {goalReached
              ? <CheckCircle size={14} className="text-panel-success" />
              : <Circle size={14} className="text-panel-muted" />}
            <span className={`text-xs font-mono ${goalReached ? 'text-panel-success' : 'text-panel-muted'}`}>
              {goalReached ? 'Goal reached' : 'Navigating'}
            </span>
          </div>
        )}
      </div>

      {/* Pose summary strip */}
      {odom && (
        <div className="flex gap-4 text-[10px] font-mono text-panel-muted">
          <span>x {odom.position.x.toFixed(2)}</span>
          <span>y {odom.position.y.toFixed(2)}</span>
          <span>yaw {(odom.yaw * 180 / Math.PI).toFixed(1)}°</span>
        </div>
      )}

      {/* Map tabs: occupancy vs. probability */}
      <div className="flex gap-3 flex-1">
        <div className="flex flex-col flex-1 gap-1">
          <span className="text-[10px] text-panel-muted font-mono uppercase tracking-wider">Occupancy</span>
          <MapCanvas cameraId="slam_map" />
        </div>
        <div className="flex flex-col flex-1 gap-1">
          <span className="text-[10px] text-panel-muted font-mono uppercase tracking-wider">Probability</span>
          <MapCanvas cameraId="slam_prob_map" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[10px] font-mono text-panel-muted">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#b4b4b4]" />free</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#141414]" />occupied</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#323232]" />unknown</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#ff6400]" />global path</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[#00c800]" />robot</span>
      </div>
    </div>
  );
}
