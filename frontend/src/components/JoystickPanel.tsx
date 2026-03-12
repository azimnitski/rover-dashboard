import { useState, useCallback } from 'react';
import { Gamepad2, Bluetooth, BluetoothConnected, BluetoothSearching, RefreshCw } from 'lucide-react';
import { useRosTopic } from '../hooks/useRosTopic';

const BACKEND = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:8765`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type JoyMsg = { axes: number[]; buttons: number[] };

type BtDevice = {
  address: string;
  name: string;
  connected?: boolean;
  paired?: boolean;
};

type ScanState = 'idle' | 'scanning' | 'done' | 'error';
type ConnectState = 'idle' | 'connecting' | 'ok' | 'error';

// ---------------------------------------------------------------------------
// Axis bar — horizontal bar centered at 0, range -1..1
// ---------------------------------------------------------------------------
function AxisBar({ label, value }: { label: string; value: number }) {
  const pct = Math.abs(value) * 50; // 0..50%
  const left = value < 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-panel-muted w-6 text-right">{label}</span>
      <div className="flex-1 h-3 bg-panel-bg rounded relative overflow-hidden">
        {/* centre line */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-panel-border" />
        {/* fill */}
        <div
          className="absolute inset-y-1 rounded-sm bg-panel-accent"
          style={{
            width: `${pct}%`,
            left: left ? `${50 - pct}%` : '50%',
          }}
        />
      </div>
      <span className="text-[10px] font-mono text-panel-muted w-10 text-right tabular-nums">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button grid
// ---------------------------------------------------------------------------
function ButtonGrid({ buttons }: { buttons: number[] }) {
  if (!buttons.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {buttons.map((val, i) => (
        <div
          key={i}
          className={`w-6 h-6 rounded text-[9px] font-mono flex items-center justify-center transition-colors ${
            val ? 'bg-panel-accent text-white' : 'bg-panel-bg text-panel-muted border border-panel-border'
          }`}
        >
          {i}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bluetooth device row
// ---------------------------------------------------------------------------
function DeviceRow({
  device,
  onConnect,
  onDisconnect,
  connectState,
}: {
  device: BtDevice;
  onConnect: (addr: string) => void;
  onDisconnect: (addr: string) => void;
  connectState: ConnectState;
}) {
  const busy = connectState === 'connecting';
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-panel-border/40 last:border-0">
      <BluetoothConnected
        size={11}
        className={device.connected ? 'text-panel-accent' : 'text-panel-border'}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono text-gray-300 truncate">{device.name}</div>
        <div className="text-[9px] font-mono text-panel-muted">{device.address}</div>
      </div>
      {device.connected ? (
        <button
          onClick={() => onDisconnect(device.address)}
          disabled={busy}
          className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-900/30 border border-red-800/40 text-red-400 hover:bg-red-900/50 transition-colors disabled:opacity-40"
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={() => onConnect(device.address)}
          disabled={busy}
          className="text-[10px] font-mono px-2 py-0.5 rounded bg-panel-accent/20 border border-panel-accent/40 text-panel-accent hover:bg-panel-accent/30 transition-colors disabled:opacity-40"
        >
          {busy ? '…' : 'Connect'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function JoystickPanel() {
  const { data: joy } = useRosTopic<JoyMsg>('/joy');

  const [devices, setDevices]           = useState<BtDevice[]>([]);
  const [scanState, setScanState]       = useState<ScanState>('idle');
  const [connectStates, setConnectStates] = useState<Record<string, ConnectState>>({});
  const [btError, setBtError]           = useState<string | null>(null);

  // ── Bluetooth: load paired devices ───────────────────────────────────────
  const loadDevices = useCallback(async () => {
    setBtError(null);
    try {
      const res = await fetch(`${BACKEND}/api/bluetooth/devices`);
      const data = await res.json();
      if (data.error) { setBtError(data.error); return; }
      setDevices(data.devices ?? []);
    } catch (e) {
      setBtError('Could not reach backend');
    }
  }, []);

  // ── Bluetooth: scan ───────────────────────────────────────────────────────
  const scan = useCallback(async () => {
    setScanState('scanning');
    setBtError(null);
    try {
      const res = await fetch(`${BACKEND}/api/bluetooth/scan`, { method: 'POST' });
      const data = await res.json();
      if (data.error) { setScanState('error'); setBtError(data.error); return; }
      setDevices(data.devices ?? []);
      setScanState('done');
    } catch (e) {
      setScanState('error');
      setBtError('Scan failed');
    }
  }, []);

  // ── Bluetooth: connect ────────────────────────────────────────────────────
  const connect = useCallback(async (addr: string) => {
    setConnectStates(s => ({ ...s, [addr]: 'connecting' }));
    setBtError(null);
    try {
      const res = await fetch(`${BACKEND}/api/bluetooth/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr }),
      });
      const data = await res.json();
      if (data.success) {
        setConnectStates(s => ({ ...s, [addr]: 'ok' }));
        setDevices(ds => ds.map(d => d.address === addr ? { ...d, connected: true } : d));
      } else {
        setConnectStates(s => ({ ...s, [addr]: 'error' }));
        setBtError(data.error ?? 'Connection failed');
      }
    } catch (e) {
      setConnectStates(s => ({ ...s, [addr]: 'error' }));
      setBtError('Connection failed');
    }
  }, []);

  // ── Bluetooth: disconnect ─────────────────────────────────────────────────
  const disconnect = useCallback(async (addr: string) => {
    setConnectStates(s => ({ ...s, [addr]: 'connecting' }));
    try {
      await fetch(`${BACKEND}/api/bluetooth/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr }),
      });
      setConnectStates(s => ({ ...s, [addr]: 'idle' }));
      setDevices(ds => ds.map(d => d.address === addr ? { ...d, connected: false } : d));
    } catch {
      setConnectStates(s => ({ ...s, [addr]: 'idle' }));
    }
  }, []);

  const axes    = joy?.axes    ?? [];
  const buttons = joy?.buttons ?? [];
  const hasJoy  = joy != null;

  return (
    <div className="panel-card flex flex-col gap-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Gamepad2 size={14} className="text-panel-accent" />
          <span className="text-xs font-mono text-panel-muted uppercase tracking-wider">Joystick</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${hasJoy ? 'bg-green-500' : 'bg-panel-border'}`} />
          <span className="text-[10px] font-mono text-panel-muted">{hasJoy ? '/joy active' : 'no /joy'}</span>
        </div>
      </div>

      {/* ── Joystick input ── */}
      {hasJoy ? (
        <div className="space-y-2">
          {/* Axes */}
          {axes.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-mono text-panel-muted uppercase tracking-wider mb-1">Axes</div>
              {axes.map((v: number, i: number) => (
                <AxisBar key={i} label={`A${i}`} value={v} />
              ))}
            </div>
          )}
          {/* Buttons */}
          {buttons.length > 0 && (
            <div>
              <div className="text-[10px] font-mono text-panel-muted uppercase tracking-wider mb-1">Buttons</div>
              <ButtonGrid buttons={buttons} />
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs font-mono text-panel-muted text-center py-2">
          No joystick input — connect via Bluetooth below
        </div>
      )}

      {/* ── Divider ── */}
      <div className="border-t border-panel-border/50" />

      {/* ── Bluetooth section ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Bluetooth size={12} className="text-panel-muted" />
            <span className="text-[10px] font-mono text-panel-muted uppercase tracking-wider">Bluetooth</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadDevices}
              title="Refresh paired devices"
              className="text-panel-muted hover:text-gray-300 transition-colors"
            >
              <RefreshCw size={11} />
            </button>
            <button
              onClick={scan}
              disabled={scanState === 'scanning'}
              className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-panel-surface border border-panel-border text-panel-muted hover:text-gray-300 hover:border-panel-accent/50 transition-colors disabled:opacity-40"
            >
              <BluetoothSearching size={10} className={scanState === 'scanning' ? 'animate-pulse text-panel-accent' : ''} />
              {scanState === 'scanning' ? 'Scanning…' : 'Scan'}
            </button>
          </div>
        </div>

        {btError && (
          <div className="text-[10px] font-mono text-red-400 bg-red-950/20 rounded px-2 py-1">{btError}</div>
        )}

        {devices.length === 0 ? (
          <div className="text-[10px] font-mono text-panel-border text-center py-2">
            {scanState === 'scanning'
              ? 'Scanning for devices…'
              : 'No devices — press Scan or Refresh'}
          </div>
        ) : (
          <div>
            {devices.map(dev => (
              <DeviceRow
                key={dev.address}
                device={dev}
                onConnect={connect}
                onDisconnect={disconnect}
                connectState={connectStates[dev.address] ?? 'idle'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
