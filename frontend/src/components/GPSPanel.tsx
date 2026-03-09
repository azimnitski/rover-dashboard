import { MapPin, Satellite } from 'lucide-react';
import { useRosTopic } from '../hooks/useRosTopic';

type GPSData = {
  latitude: number;
  longitude: number;
  altitude: number;
  status: number;   // -1=no fix, 0=fix, 1=SBAS, 2=GBAS
  covariance_type: number;
};

const STATUS_LABEL: Record<number, { label: string; dot: string }> = {
  [-1]: { label: 'No Fix', dot: 'status-dot-error' },
  0:   { label: 'GPS Fix', dot: 'status-dot-ok' },
  1:   { label: 'SBAS',    dot: 'status-dot-ok' },
  2:   { label: 'GBAS',    dot: 'status-dot-ok' },
};

export function GPSPanel() {
  const { data } = useRosTopic<GPSData>('/gps/fix');

  const statusInfo = data ? (STATUS_LABEL[data.status] ?? { label: 'Unknown', dot: 'status-dot-warn' })
                          : { label: 'No Data', dot: 'status-dot-warn' };

  return (
    <div className="panel-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin size={16} className="text-panel-muted" />
          <span className="stat-label">GPS</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`status-dot ${statusInfo.dot}`} />
          <span className="text-xs font-mono text-panel-muted">{statusInfo.label}</span>
        </div>
      </div>

      {data ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <div className="text-[10px] text-panel-muted font-mono uppercase tracking-wider">Lat</div>
              <div className="font-mono text-sm text-gray-200 tabular-nums">
                {data.latitude.toFixed(6)}°
              </div>
            </div>
            <div>
              <div className="text-[10px] text-panel-muted font-mono uppercase tracking-wider">Lon</div>
              <div className="font-mono text-sm text-gray-200 tabular-nums">
                {data.longitude.toFixed(6)}°
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-panel-muted font-mono uppercase tracking-wider">Alt</div>
            <div className="font-mono text-sm text-gray-200 tabular-nums">
              {data.altitude.toFixed(1)} m
            </div>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Satellite size={10} className="text-panel-muted" />
            <a
              href={`https://maps.google.com/?q=${data.latitude},${data.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-panel-accent hover:underline"
            >
              Open in Maps ↗
            </a>
          </div>
        </div>
      ) : (
        <div className="text-panel-muted text-xs font-mono">Waiting for fix…</div>
      )}
    </div>
  );
}
