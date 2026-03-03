import { useRosTopic } from '../hooks/useRosTopic';
import { Move3d } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts';

type ImuData = {
  orientation: { x: number; y: number; z: number; w: number };
  angular_velocity: { x: number; y: number; z: number };
  linear_acceleration: { x: number; y: number; z: number };
};

export function ImuPanel() {
  const { data, history } = useRosTopic<ImuData>('/imu/data', 200);

  const accel = data?.linear_acceleration ?? { x: 0, y: 0, z: 0 };
  const gyro = data?.angular_velocity ?? { x: 0, y: 0, z: 0 };
  const orient = data?.orientation ?? { x: 0, y: 0, z: 0, w: 1 };

  // Convert quaternion to approximate roll/pitch/yaw (degrees)
  const toEuler = (q: { x: number; y: number; z: number; w: number }) => {
    const sinr = 2 * (q.w * q.x + q.y * q.z);
    const cosr = 1 - 2 * (q.x * q.x + q.y * q.y);
    const roll = Math.atan2(sinr, cosr) * (180 / Math.PI);

    const sinp = 2 * (q.w * q.y - q.z * q.x);
    const pitch =
      Math.abs(sinp) >= 1
        ? (Math.sign(sinp) * 90)
        : Math.asin(sinp) * (180 / Math.PI);

    const siny = 2 * (q.w * q.z + q.x * q.y);
    const cosy = 1 - 2 * (q.y * q.y + q.z * q.z);
    const yaw = Math.atan2(siny, cosy) * (180 / Math.PI);

    return { roll, pitch, yaw };
  };

  const euler = toEuler(orient);

  // Chart data — linear acceleration over time
  const chartData = history.map((h, i) => ({
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
        <span className="text-[10px] text-panel-muted font-mono ml-auto">/imu/data</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Orientation */}
        <div>
          <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">
            Orientation (°)
          </div>
          <div className="space-y-0.5 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-red-400">R</span>
              <span>{euler.roll.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-green-400">P</span>
              <span>{euler.pitch.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-blue-400">Y</span>
              <span>{euler.yaw.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Angular velocity */}
        <div>
          <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">
            Gyro (rad/s)
          </div>
          <div className="space-y-0.5 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-red-400">X</span>
              <span>{gyro.x.toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-green-400">Y</span>
              <span>{gyro.y.toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-blue-400">Z</span>
              <span>{gyro.z.toFixed(3)}</span>
            </div>
          </div>
        </div>

        {/* Linear acceleration */}
        <div>
          <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">
            Accel (m/s²)
          </div>
          <div className="space-y-0.5 font-mono text-sm">
            <div className="flex justify-between">
              <span className="text-red-400">X</span>
              <span>{accel.x.toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-green-400">Y</span>
              <span>{accel.y.toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-blue-400">Z</span>
              <span>{accel.z.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Acceleration chart */}
      {chartData.length > 5 && (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
              <XAxis dataKey="i" hide />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                width={35}
              />
              <Legend
                iconSize={8}
                wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace' }}
              />
              <Line
                type="monotone"
                dataKey="ax"
                stroke="#f87171"
                strokeWidth={1}
                dot={false}
                name="X"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="ay"
                stroke="#4ade80"
                strokeWidth={1}
                dot={false}
                name="Y"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="az"
                stroke="#60a5fa"
                strokeWidth={1}
                dot={false}
                name="Z"
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
