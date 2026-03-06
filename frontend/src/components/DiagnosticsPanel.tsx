import { Activity } from 'lucide-react';
import { useRosTopic } from '../hooks/useRosTopic';

type DiagStatus = { level: number; name: string; message: string; hardware_id: string };
type DiagnosticsData = { status: DiagStatus[] };

type FreertosData = {
  motor_ok:  boolean;
  enc_ok:    boolean;
  imu_ok:    boolean;
  mag_ok:    boolean;
  cmd_count: number;
};

const LEVEL_META = [
  { label: 'OK',    dot: 'status-dot-ok',    text: 'text-panel-success' },
  { label: 'WARN',  dot: 'status-dot-warn',   text: 'text-panel-warn' },
  { label: 'ERROR', dot: 'status-dot-error',  text: 'text-panel-danger' },
  { label: 'STALE', dot: 'status-dot-warn',   text: 'text-panel-muted' },
];

function Dot({ ok }: { ok: boolean }) {
  return <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? 'bg-panel-success' : 'bg-panel-danger'}`} />;
}

export function DiagnosticsPanel() {
  const { data: diagData } = useRosTopic<DiagnosticsData>('/diagnostics');
  const { data: esp32 }    = useRosTopic<FreertosData>('/freertos_int32_publisher');

  const statuses = diagData?.status ?? [];
  const worst    = statuses.reduce((acc, s) => Math.max(acc, s.level), 0);
  const worstMeta = LEVEL_META[Math.min(worst, 3)];

  const esp32Subsystems: [boolean, string][] = esp32 ? [
    [esp32.motor_ok, 'Motor driver (TB6612)'],
    [esp32.enc_ok,   'Encoders (PCNT)'],
    [esp32.imu_ok,   'ICM-20948'],
    [esp32.mag_ok,   'AK09916'],
  ] : [];

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-panel-muted" />
          <span className="stat-label">Diagnostics</span>
        </div>
        {statuses.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className={`status-dot ${worstMeta.dot}`} />
            <span className={`text-xs font-mono ${worstMeta.text}`}>{worstMeta.label}</span>
          </div>
        )}
      </div>

      {/* ESP32 subsystem status (from /freertos_int32_publisher) */}
      {esp32 !== null && (
        <div className="mb-3 pb-3 border-b border-panel-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-panel-muted uppercase tracking-wider">ESP32 • micro-ROS</span>
            <span className="text-[10px] font-mono text-panel-muted tabular-nums">cmd #{esp32.cmd_count}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {esp32Subsystems.map(([ok, label]) => (
              <div key={label} className="flex items-center gap-1.5">
                <Dot ok={ok} />
                <span className="text-[10px] font-mono text-panel-muted">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ROS /diagnostics */}
      <div>
        <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1.5">ROS Diagnostics</div>
        {statuses.length === 0 ? (
          <div className="text-panel-muted text-xs font-mono">No messages…</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {statuses.map((s, i) => {
              const meta = LEVEL_META[Math.min(s.level, 3)];
              return (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <div className={`status-dot mt-1 flex-shrink-0 ${meta.dot}`} />
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-gray-200 truncate">{s.name}</div>
                    {s.message && s.message !== 'OK' && (
                      <div className={`text-[10px] font-mono ${meta.text} truncate`}>{s.message}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
