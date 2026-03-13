import { useEffect, useRef } from 'react';
import { Navigation } from 'lucide-react';
import { useRosTopic } from '../hooks/useRosTopic';

type OdomData = {
  position: { x: number; y: number; z: number };
  yaw: number;
  linear_velocity: { x: number };
  angular_velocity: { z: number };
};

/** Mini top-down trajectory trail drawn on a canvas. */
function TrajectoryCanvas({ history }: { history: { timestamp: number; data: OdomData }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const xs = history.map(h => h.data.position.x);
    const ys = history.map(h => h.data.position.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 0.5);
    const pad = 10;
    const scale = (Math.min(W, H) - pad * 2) / span;
    const cx = W / 2 - ((minX + maxX) / 2) * scale;
    const cy = H / 2 + ((minY + maxY) / 2) * scale;

    const toScreen = (x: number, y: number) => ({
      sx: cx + x * scale,
      sy: cy - y * scale,  // flip Y (ROS Y+ = up, canvas Y+ = down)
    });

    // Trail
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    history.forEach(({ data: d }, i) => {
      const { sx, sy } = toScreen(d.position.x, d.position.y);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.stroke();

    // Current position dot
    const last = history[history.length - 1].data;
    const { sx, sy } = toScreen(last.position.x, last.position.y);
    const yaw = last.yaw;
    const arrowLen = 6;
    ctx.beginPath();
    ctx.fillStyle = '#22c55e';
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
    // Heading arrow
    ctx.beginPath();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + arrowLen * Math.cos(yaw), sy - arrowLen * Math.sin(yaw));
    ctx.stroke();
  }, [history]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={140}
      className="w-full rounded bg-black/30"
    />
  );
}

export function OdometryPanel() {
  const { data, history, lastUpdate } = useRosTopic<OdomData>('/odometry/filtered', 200);

  const pos = data?.position;
  const vx = data?.linear_velocity.x ?? 0;
  const wz = data?.angular_velocity.z ?? 0;
  const yawDeg = data ? (data.yaw * 180 / Math.PI).toFixed(1) : '—';

  return (
    <div className="panel-card">
      <div className="flex items-center gap-2 mb-3">
        <Navigation size={16} className="text-panel-muted" />
        <span className="stat-label">Odometry</span>
        <span className="ml-auto text-xs text-panel-muted font-mono">
          {lastUpdate ? new Date(lastUpdate * 1000).toLocaleTimeString() : '—'}
        </span>
      </div>

      {/* Position + velocity numbers */}
      <div className="grid grid-cols-6 gap-x-2 gap-y-1 mb-3 font-mono text-sm">
        {(['x', 'y', 'z'] as const).map(axis => (
          <div key={axis}>
            <div className="text-[10px] text-panel-muted uppercase">{axis}</div>
            <div className="text-gray-200 tabular-nums">{pos ? pos[axis].toFixed(2) : '—'}</div>
          </div>
        ))}
        <div>
          <div className="text-[10px] text-panel-muted">Yaw</div>
          <div className="text-gray-200 tabular-nums">{yawDeg}°</div>
        </div>
        <div>
          <div className="text-[10px] text-panel-muted">v_x</div>
          <div className="text-gray-200 tabular-nums">{vx.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-panel-muted">ω_z</div>
          <div className="text-gray-200 tabular-nums">{wz.toFixed(2)}</div>
        </div>
      </div>

      {/* Trajectory canvas — full width */}
      <TrajectoryCanvas history={history} />
    </div>
  );
}
