import { useRosTopic } from '../hooks/useRosTopic';
import { Move3d } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, ReferenceLine } from 'recharts';

type ImuData = {
  angular_velocity:   { x: number; y: number; z: number };
  linear_acceleration: { x: number; y: number; z: number };
};

type MagData = { x: number; y: number; z: number };

const AXIS_COLORS = ['text-red-400', 'text-green-400', 'text-blue-400'] as const;

function Vec3({
  label,
  data,
  unit,
  decimals = 3,
  scale = 1,
}: {
  label: string;
  data: { x: number; y: number; z: number } | null;
  unit: string;
  decimals?: number;
  scale?: number;
}) {
  return (
    <div>
      <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="font-mono text-xs space-y-px">
        {(['x', 'y', 'z'] as const).map((axis, i) => {
          const v = data ? data[axis] * scale : null;
          return (
            <div key={axis} className="flex justify-between gap-1">
              <span className={AXIS_COLORS[i]}>{axis.toUpperCase()}</span>
              <span className="tabular-nums text-gray-200">
                {v !== null ? v.toFixed(decimals) : '—'}
              </span>
            </div>
          );
        })}
        <div className="text-[9px] text-panel-border pt-0.5">{unit}</div>
      </div>
    </div>
  );
}

export function ImuPanel() {
  const { data, history } = useRosTopic<ImuData>('/imu', 100);
  const { data: magData }  = useRosTopic<MagData>('/imu/mag');

  const accel = data?.linear_acceleration ?? null;
  const gyro  = data?.angular_velocity   ?? null;

  const sparkData = history.map((h, i) => ({
    i,
    ax: h.data.linear_acceleration.x,
    ay: h.data.linear_acceleration.y,
    az: h.data.linear_acceleration.z,
  }));

  return (
    <div className="panel-card">
      <div className="flex items-center gap-2 mb-3">
        <Move3d size={16} className="text-panel-muted" />
        <span className="stat-label">IMU</span>
        <span className="text-[10px] text-panel-muted font-mono ml-auto">ICM-20948 + AK09916</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <Vec3 label="Gyro"  data={gyro}    unit="rad/s" decimals={3} />
        <Vec3 label="Accel" data={accel}   unit="m/s²"  decimals={2} />
        <Vec3 label="Mag"   data={magData} unit="µT"    decimals={1} scale={1e6} />
      </div>

      {/* Accel sparkline — X/Y/Z color-coded */}
      {sparkData.length > 5 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-panel-muted uppercase tracking-wider">Accel history</span>
            <div className="flex gap-2">
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <span key={axis} className={`text-[9px] font-mono ${AXIS_COLORS[i]}`}>{axis}</span>
              ))}
            </div>
          </div>
          <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <ReferenceLine y={0} stroke="#2a2d3a" strokeWidth={1} />
                <Line type="monotone" dataKey="ax" stroke="#f87171" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="ay" stroke="#4ade80" strokeWidth={1} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="az" stroke="#60a5fa" strokeWidth={1} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
