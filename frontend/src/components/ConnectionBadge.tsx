import { Wifi, WifiOff } from 'lucide-react';

export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-medium border ${
        connected
          ? 'border-panel-success/30 bg-panel-success/10 text-panel-success'
          : 'border-panel-danger/30 bg-panel-danger/10 text-panel-danger'
      }`}
    >
      <div
        className={`status-dot ${connected ? 'status-dot-ok' : 'status-dot-error'}`}
      />
      {connected ? (
        <>
          <Wifi size={12} />
          <span>Connected</span>
        </>
      ) : (
        <>
          <WifiOff size={12} />
          <span>Disconnected</span>
        </>
      )}
    </div>
  );
}
