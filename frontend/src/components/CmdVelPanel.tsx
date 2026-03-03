import { useRosTopic } from '../hooks/useRosTopic';
import { Navigation } from 'lucide-react';

type TwistData = {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
};

export function CmdVelPanel() {
  const { data } = useRosTopic<TwistData>('/cmd_vel');

  const linear = data?.linear ?? { x: 0, y: 0, z: 0 };
  const angular = data?.angular ?? { x: 0, y: 0, z: 0 };

  // Visual indicator: arrow showing direction
  const arrowAngle = Math.atan2(angular.z, linear.x) * (180 / Math.PI);
  const speed = Math.sqrt(linear.x ** 2 + linear.y ** 2);
  const maxIndicator = 1.0; // max speed for visual scaling

  return (
    <div className="panel-card">
      <div className="flex items-center gap-2 mb-3">
        <Navigation size={16} className="text-panel-muted" />
        <span className="stat-label">Command Velocity</span>
      </div>

      <div className="flex items-center gap-4">
        {/* Direction indicator */}
        <div className="w-20 h-20 rounded-full border border-panel-border bg-panel-bg relative flex items-center justify-center flex-shrink-0">
          {/* Crosshair */}
          <div className="absolute w-full h-px bg-panel-border" />
          <div className="absolute h-full w-px bg-panel-border" />

          {/* Direction arrow */}
          <div
            className="transition-transform duration-150"
            style={{
              transform: `rotate(${-arrowAngle + 90}deg)`,
            }}
          >
            <div
              className="w-1 bg-panel-accent rounded-full mx-auto origin-bottom"
              style={{
                height: `${Math.min(speed / maxIndicator, 1) * 32 + 4}px`,
              }}
            />
          </div>

          {/* Center dot */}
          <div className="absolute w-2 h-2 rounded-full bg-panel-accent" />
        </div>

        {/* Values */}
        <div className="flex-1 space-y-2">
          <div>
            <div className="text-[10px] text-panel-muted uppercase tracking-wider">
              Linear (m/s)
            </div>
            <div className="font-mono text-sm">
              <span className="text-red-400">x:</span> {linear.x.toFixed(3)}
              <span className="text-green-400 ml-2">y:</span> {linear.y.toFixed(3)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-panel-muted uppercase tracking-wider">
              Angular (rad/s)
            </div>
            <div className="font-mono text-sm">
              <span className="text-blue-400">z:</span> {angular.z.toFixed(3)}
            </div>
          </div>
          <div className="text-[10px] text-panel-muted font-mono">/cmd_vel</div>
        </div>
      </div>
    </div>
  );
}
