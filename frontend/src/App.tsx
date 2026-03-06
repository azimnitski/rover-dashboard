import { useState, useRef, useCallback } from 'react';
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { useConnectionStatus } from './hooks/useRosTopic';
import { ConnectionBadge } from './components/ConnectionBadge';
import { ImuPanel } from './components/ImuPanel';
import { BatteryPanel } from './components/BatteryPanel';
import { MotorsPanel } from './components/MotorsPanel';
import { CmdVelPanel } from './components/CmdVelPanel';
import { TopicExplorer } from './components/TopicExplorer';
import { CameraPanel } from './components/CameraPanel';
import { OdometryPanel } from './components/OdometryPanel';
import { SLAMMapPanel } from './components/SLAMMapPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { GPSPanel } from './components/GPSPanel';
import { PointCloud3DPanel } from './components/PointCloud3DPanel';

// ---------------------------------------------------------------------------
// Panel registry
// ---------------------------------------------------------------------------
type PanelDef = {
  id: string;
  label: string;
  colSpan: 1 | 2 | 3;
  component: React.ComponentType;
};

const PANEL_DEFS: PanelDef[] = [
  { id: 'battery',     label: 'Battery',        colSpan: 1, component: BatteryPanel },
  { id: 'motors',      label: 'Motors',          colSpan: 1, component: MotorsPanel },
  { id: 'cmdvel',      label: 'Cmd Vel',         colSpan: 1, component: CmdVelPanel },
  { id: 'imu',         label: 'IMU',             colSpan: 2, component: ImuPanel },
  { id: 'topics',      label: 'Topic Explorer',  colSpan: 1, component: TopicExplorer },
  { id: 'camera',      label: 'Camera',          colSpan: 3, component: CameraPanel },
  { id: 'odometry',    label: 'Odometry',        colSpan: 1, component: OdometryPanel },
  { id: 'slammap',     label: 'SLAM Map',        colSpan: 2, component: SLAMMapPanel },
  { id: 'diagnostics', label: 'Diagnostics',     colSpan: 2, component: DiagnosticsPanel },
  { id: 'gps',         label: 'GPS',             colSpan: 1, component: GPSPanel },
  { id: 'pointcloud',  label: 'Point Cloud 3D',  colSpan: 3, component: PointCloud3DPanel },
];

const PANEL_MAP = Object.fromEntries(PANEL_DEFS.map(p => [p.id, p]));

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------
const LS_ORDER     = 'panel_order';
const LS_COLLAPSED = 'panel_collapsed';

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(LS_ORDER);
    if (raw) {
      const saved = JSON.parse(raw) as string[];
      const knownIds = new Set(saved);
      const added = PANEL_DEFS.map(p => p.id).filter(id => !knownIds.has(id));
      return [...saved.filter(id => PANEL_MAP[id] !== undefined), ...added];
    }
  } catch { /* ignore */ }
  return PANEL_DEFS.map(p => p.id);
}

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function persist(order: string[], collapsed: Record<string, boolean>) {
  localStorage.setItem(LS_ORDER, JSON.stringify(order));
  localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsed));
}

// ---------------------------------------------------------------------------
// PanelShell — wraps each panel with drag handle + collapse toggle
// ---------------------------------------------------------------------------
function PanelShell({
  def,
  collapsed,
  dragging,
  dropTarget,
  onGripDown,
  onToggleCollapse,
  registerEl,
}: {
  def: PanelDef;
  collapsed: boolean;
  dragging: boolean;     // this panel is being dragged
  dropTarget: boolean;   // cursor is over this panel
  onGripDown: (e: React.MouseEvent) => void;
  onToggleCollapse: () => void;
  registerEl: (el: HTMLElement | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const Component = def.component;

  const colClass =
    def.colSpan === 3 ? 'col-span-1 md:col-span-2 xl:col-span-3' :
    def.colSpan === 2 ? 'col-span-1 md:col-span-2' :
    'col-span-1';

  const dropRing = dropTarget && !dragging
    ? 'ring-2 ring-panel-accent ring-offset-1 ring-offset-panel-bg'
    : '';

  // ── Collapsed: mini labeled bar ──────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        ref={registerEl}
        className={`${colClass} panel-card flex items-center gap-2 py-2 select-none ${dropRing} ${dragging ? 'opacity-30' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Drag grip */}
        <div
          onMouseDown={onGripDown}
          className="cursor-grab active:cursor-grabbing text-panel-border hover:text-panel-muted flex-shrink-0"
        >
          <GripVertical size={14} />
        </div>

        <span className="text-xs font-mono text-panel-muted uppercase tracking-wider flex-1 truncate select-none">
          {def.label}
        </span>

        {/* Expand button — always visible on collapsed panels */}
        <button
          onClick={onToggleCollapse}
          className="text-panel-muted hover:text-gray-200 transition-colors flex-shrink-0"
          title="Expand panel"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  // ── Expanded: full panel with hover-revealed controls ─────────────────────
  return (
    <div
      ref={registerEl}
      className={`${colClass} relative ${dropRing} ${dragging ? 'opacity-30' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Hover controls — top-right corner overlay */}
      <div
        className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1 transition-opacity duration-150"
        style={{ opacity: hovered ? 1 : 0 }}
      >
        <button
          onClick={onToggleCollapse}
          className="text-panel-muted hover:text-gray-200 transition-colors"
          title="Collapse panel"
        >
          <ChevronUp size={13} />
        </button>
        <div
          onMouseDown={onGripDown}
          className="cursor-grab active:cursor-grabbing text-panel-muted hover:text-gray-200 transition-colors"
          title="Drag to reorder"
        >
          <GripVertical size={13} />
        </div>
      </div>

      <Component />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const connected = useConnectionStatus();

  const [order, setOrder] = useState<string[]>(loadOrder);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  // DOM refs for each panel wrapper (used for hit-testing during drag)
  const panelEls = useRef<Map<string, HTMLElement>>(new Map());
  const registerEl = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) panelEls.current.set(id, el);
    else panelEls.current.delete(id);
  }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const startDrag = useCallback((id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragId(id);
    setDropId(id);

    let currentDropId = id;
    // Snapshot order at drag-start; order won't change while user is dragging
    const orderSnap = [...order];

    document.body.style.cursor = 'grabbing';

    function onMove(ev: MouseEvent) {
      for (const [pid, el] of panelEls.current) {
        const r = el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right &&
            ev.clientY >= r.top  && ev.clientY <= r.bottom) {
          if (pid !== currentDropId) {
            currentDropId = pid;
            setDropId(pid);
          }
          return;
        }
      }
    }

    function onUp() {
      document.body.style.cursor = '';

      if (currentDropId !== id) {
        const srcIdx = orderSnap.indexOf(id);
        const dstIdx = orderSnap.indexOf(currentDropId);
        if (srcIdx !== -1 && dstIdx !== -1 && srcIdx !== dstIdx) {
          const next = [...orderSnap];
          next.splice(srcIdx, 1);
          // After removing src, destination index shifts if src was before dst
          const insertAt = srcIdx < dstIdx ? dstIdx - 1 : dstIdx;
          next.splice(insertAt, 0, id);
          setOrder(next);
          persist(next, collapsed);
        }
      }

      setDragId(null);
      setDropId(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [order, collapsed]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [id]: !prev[id] };
      persist(order, next);
      return next;
    });
  }, [order]);

  const collapseAll = useCallback(() => {
    const next = Object.fromEntries(order.map((id: string) => [id, true]));
    setCollapsed(next);
    persist(order, next);
  }, [order]);

  const expandAll = useCallback(() => {
    setCollapsed({});
    persist(order, {});
  }, [order]);

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
        <div className="flex items-center gap-2">
          <button
            onClick={collapseAll}
            className="text-[10px] font-mono text-panel-muted hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-panel-surface"
            title="Collapse all panels"
          >
            Collapse all
          </button>
          <button
            onClick={expandAll}
            className="text-[10px] font-mono text-panel-muted hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-panel-surface"
            title="Expand all panels"
          >
            Expand all
          </button>
          <ConnectionBadge connected={connected} />
        </div>
      </header>

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {order.map(id => {
          const def = PANEL_MAP[id] as PanelDef | undefined;
          if (!def) return null;
          return (
            <PanelShell
              key={id}
              def={def}
              collapsed={!!collapsed[id]}
              dragging={dragId === id}
              dropTarget={dropId === id && dragId !== id}
              onGripDown={startDrag(id)}
              onToggleCollapse={() => toggleCollapse(id)}
              registerEl={registerEl(id)}
            />
          );
        })}
      </div>

      {/* Footer */}
      <footer className="mt-6 text-center text-xs text-panel-muted font-mono">
        Phase 1–3 • Telemetry, Camera &amp; SLAM
      </footer>
    </div>
  );
}
