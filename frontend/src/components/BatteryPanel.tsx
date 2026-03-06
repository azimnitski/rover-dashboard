import { useRosTopic } from '../hooks/useRosTopic';
import { Battery, Zap } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

type BatteryData = { value: number };

// 3S LiPo: 12.6V = 100%, 10.5V = 0%
const V_MAX = 12.6;
const V_MIN = 10.5;

function batteryPct(v: number) {
  return Math.max(0, Math.min(100, ((v - V_MIN) / (V_MAX - V_MIN)) * 100));
}

export function BatteryPanel() {
  const { data: voltageData, history } = useRosTopic<BatteryData>('/battery_voltage', 120);
  const { data: currentData } = useRosTopic<BatteryData>('/battery_current');

  const voltage = voltageData?.value ?? 0;
  const current = currentData?.value ?? null;
  const pct = voltage > 0 ? batteryPct(voltage) : null;
  const power = voltage > 0 && current !== null ? voltage * current : null;

  const getStatus = (v: number) => {
    if (v >= 12.0) return { label: 'Good', color: 'text-panel-success', dot: 'status-dot-ok', bar: 'bg-panel-success' };
    if (v >= 11.0) return { label: 'Low',  color: 'text-panel-warn',    dot: 'status-dot-warn', bar: 'bg-panel-warn' };
    return               { label: 'Critical', color: 'text-panel-danger', dot: 'status-dot-error', bar: 'bg-panel-danger' };
  };

  const status = getStatus(voltage);

  const chartData = history.map((h) => ({
    t: h.timestamp,
    v: h.data.value,
  }));

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Battery size={16} className="text-panel-muted" />
          <span className="stat-label">Battery</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`status-dot ${status.dot}`} />
          <span className={`text-xs font-mono ${status.color}`}>{status.label}</span>
        </div>
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="stat-value text-gray-100">
            {voltage > 0 ? voltage.toFixed(2) : '—'}
            <span className="text-sm text-panel-muted ml-1">V</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {current !== null && (
              <span className="font-mono text-sm text-gray-400 tabular-nums">
                {current.toFixed(2)}<span className="text-panel-muted ml-0.5 text-xs">A</span>
              </span>
            )}
            {power !== null && (
              <span className="font-mono text-sm text-amber-400 tabular-nums">
                {power.toFixed(1)}<span className="text-panel-muted ml-0.5 text-xs">W</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Zap size={10} className="text-panel-warn" />
            <span className="text-xs text-panel-muted font-mono">INA219</span>
          </div>
        </div>

        {/* Voltage sparkline */}
        {chartData.length > 2 && (
          <div className="w-24 h-10">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <YAxis domain={['dataMin - 0.2', 'dataMax + 0.2']} hide />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Visual fill bar */}
      {pct !== null && (
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-mono text-panel-muted uppercase tracking-wider">Charge</span>
            <span className={`text-[10px] font-mono tabular-nums ${status.color}`}>{pct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 w-full bg-panel-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${status.bar}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
