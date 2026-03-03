import { useRosTopic } from '../hooks/useRosTopic';
import { Cog } from 'lucide-react';

type MotorData = { values: number[] };

const MOTOR_LABELS = ['FL', 'FR', 'RL', 'RR'];

export function MotorsPanel() {
  const { data: speedData } = useRosTopic<MotorData>('/motors/status');
  const { data: currentData } = useRosTopic<MotorData>('/motors/current');

  const speeds = speedData?.values ?? [0, 0, 0, 0];
  const currents = currentData?.values ?? [0, 0, 0, 0];

  // Normalize speed for bar display (assuming 0-100 range)
  const maxSpeed = 100;

  return (
    <div className="panel-card">
      <div className="flex items-center gap-2 mb-3">
        <Cog size={16} className="text-panel-muted" />
        <span className="stat-label">Motors (4×DC)</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {MOTOR_LABELS.map((label, i) => {
          const speed = speeds[i] ?? 0;
          const current = currents[i] ?? 0;
          const pct = Math.min(Math.abs(speed) / maxSpeed, 1) * 100;
          const isReverse = speed < 0;

          return (
            <div key={label} className="text-center">
              {/* Motor label */}
              <div className="text-[10px] font-mono text-panel-muted mb-1.5 uppercase tracking-widest">
                {label}
              </div>

              {/* Speed bar */}
              <div className="h-16 w-full bg-panel-bg rounded-sm relative overflow-hidden mb-1.5">
                <div
                  className={`absolute bottom-0 left-0 right-0 transition-all duration-150 rounded-sm ${
                    isReverse ? 'bg-panel-warn/60' : 'bg-panel-accent/60'
                  }`}
                  style={{ height: `${pct}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-mono text-xs font-medium text-gray-200">
                    {Math.abs(speed).toFixed(0)}
                  </span>
                </div>
              </div>

              {/* Current */}
              <div className="font-mono text-[10px] text-panel-muted">
                {current.toFixed(2)}A
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1 mt-2">
        <span className="text-[10px] text-panel-muted font-mono">/motors/status</span>
        <span className="text-[10px] text-panel-muted">•</span>
        <span className="text-[10px] text-panel-muted font-mono">/motors/current</span>
      </div>
    </div>
  );
}
