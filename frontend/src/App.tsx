import { useConnectionStatus } from './hooks/useRosTopic';
import { ConnectionBadge } from './components/ConnectionBadge';
import { ImuPanel } from './components/ImuPanel';
import { BatteryPanel } from './components/BatteryPanel';
import { MotorsPanel } from './components/MotorsPanel';
import { CmdVelPanel } from './components/CmdVelPanel';
import { TopicExplorer } from './components/TopicExplorer';
import { CameraPanel } from './components/CameraPanel';

export default function App() {
  const connected = useConnectionStatus();

  return (
    <div className="min-h-screen bg-panel-bg p-4 md:p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-panel-accent flex items-center justify-center">
            <span className="text-white font-bold text-sm font-mono">R</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-100 font-sans tracking-tight">
              Rover Dashboard
            </h1>
            <p className="text-xs text-panel-muted font-mono">
              ESP32 + Orin Nano • ROS 2 Humble
            </p>
          </div>
        </div>
        <ConnectionBadge connected={connected} />
      </header>

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Row 1: Key telemetry */}
        <BatteryPanel />
        <MotorsPanel />
        <CmdVelPanel />

        {/* Row 2: IMU (wider) + Topic Explorer */}
        <div className="md:col-span-2">
          <ImuPanel />
        </div>
        <TopicExplorer />

        {/* Row 3: Camera feeds (full width) */}
        <div className="col-span-1 md:col-span-2 xl:col-span-3">
          <CameraPanel />
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-6 text-center text-xs text-panel-muted font-mono">
        Phase 1 + 2 • Telemetry &amp; Camera
      </footer>
    </div>
  );
}
