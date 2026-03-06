import { useRosTopic } from '../hooks/useRosTopic';
import { Cog } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, ReferenceLine } from 'recharts';

type SpeedData = { value: number };
type DiagData  = {
  motor_ok:  boolean;
  enc_ok:    boolean;
  imu_ok:    boolean;
  mag_ok:    boolean;
  lpwm:      number;
  cmd_count: number;
};

const MAX_SPEED = 1.0; // m/s — firmware max_velocity

function SpeedBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const pct = Math.min(Math.abs(v) / MAX_SPEED, 1) * 100;
  const fwd = v >= 0;

  return (
    <div className="flex-1">
      <div className="text-[10px] font-mono text-panel-muted uppercase tracking-wider mb-1 text-center">
        {label}
      </div>

      {/* Vertical bar — grows from center (zero line) */}
      <div className="h-20 w-full bg-panel-bg rounded relative overflow-hidden">
        <div className="absolute left-0 right-0 bottom-1/2 h-px bg-panel-border" />
        <div
          className={`absolute left-0 right-0 transition-all duration-100 ${fwd ? 'bg-panel-accent/70' : 'bg-panel-warn/70'}`}
          style={{
            bottom: fwd ? '50%' : `${50 - pct}%`,
            height: `${pct}%`,
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-xs font-semibold text-gray-200 tabular-nums">
            {value !== null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : '—'}
          </span>
        </div>
      </div>

      <div className="text-[10px] font-mono text-panel-muted text-center mt-0.5">m/s</div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean | undefined }) {
  return (
    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
      ok === undefined ? 'bg-panel-border' :
      ok              ? 'bg-panel-success' : 'bg-panel-danger'
    }`} />
  );
}

export function MotorsPanel() {
  const { data: leftData,  history: leftHist  } = useRosTopic<SpeedData>('/wheel_speed_left',  60);
  const { data: rightData, history: rightHist } = useRosTopic<SpeedData>('/wheel_speed_right', 60);
  const { data: diag } = useRosTopic<DiagData>('/freertos_int32_publisher');

  const leftVal  = leftData?.value  ?? null;
  const rightVal = rightData?.value ?? null;

  const sparkData = leftHist.map((h, i) => ({
    i,
    L: h.data.value,
    R: rightHist[i]?.data.value ?? 0,
  }));

  const subsystems: [boolean | undefined, string][] = [
    [diag?.motor_ok, 'Motor driver'],
    [diag?.enc_ok,   'Encoders'],
    [diag?.imu_ok,   'ICM-20948'],
    [diag?.mag_ok,   'AK09916'],
  ];

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cog size={16} className="text-panel-muted" />
          <span className="stat-label">Motors</span>
        </div>
        {diag !== null && (
          <span className="text-[10px] font-mono text-panel-muted tabular-nums">
            cmd #{diag.cmd_count}
          </span>
        )}
      </div>

      {/* L / R speed bars */}
      <div className="flex gap-3 mb-3">
        <SpeedBar label="Left"  value={leftVal}  />
        <SpeedBar label="Right" value={rightVal} />
      </div>

      {/* Speed history sparkline — L=blue, R=green */}
      {sparkData.length > 4 && (
        <div className="h-10 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <YAxis domain={[-MAX_SPEED, MAX_SPEED]} hide />
              <ReferenceLine y={0} stroke="#2a2d3a" strokeWidth={1} />
              <Line type="monotone" dataKey="L" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="R" stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ESP32 subsystem init status */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-2 border-t border-panel-border">
        {subsystems.map(([ok, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <StatusDot ok={ok} />
            <span className="text-[10px] font-mono text-panel-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
