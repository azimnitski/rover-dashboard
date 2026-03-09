/**
 * WebSocket client with automatic reconnection.
 *
 * Manages a single WebSocket connection to the backend and
 * dispatches messages to registered topic handlers.
 */

export type TelemetryMessage = {
  type: 'telemetry';
  topic: string;
  data: Record<string, any>;
  timestamp: number;
};

type MessageHandler = (msg: TelemetryMessage) => void;
type FrameHandler = (jpeg: Uint8Array<ArrayBuffer>) => void;

// Binary frame layout: first 64 bytes = camera_id (null-padded), rest = JPEG
const FRAME_HEADER_LEN = 64;

class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private globalHandlers: Set<(msg: TelemetryMessage) => void> = new Set();
  private frameHandlers: Map<string, Set<FrameHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 10000;
  private _connected = false;

  // Connection state listeners
  private connectionListeners: Set<(connected: boolean) => void> = new Set();

  constructor() {
    // Determine WS URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In dev mode, Vite proxies /ws to the backend
    this.url = `${protocol}//${window.location.host}/ws`;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this._connected = true;
        this.reconnectDelay = 1000;
        this.notifyConnectionListeners();
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this._connected = false;
        this.notifyConnectionListeners();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data) as TelemetryMessage;
            if (msg.type === 'telemetry') {
              this.dispatch(msg);
            }
          } catch (e) {
            console.warn('[WS] Failed to parse message:', e);
          }
        } else if (event.data instanceof ArrayBuffer) {
          const buf = event.data;
          if (buf.byteLength <= FRAME_HEADER_LEN) return;
          const header = new Uint8Array(buf, 0, FRAME_HEADER_LEN);
          const cameraId = new TextDecoder().decode(header).replace(/\0+$/, '');
          const jpeg = new Uint8Array(buf, FRAME_HEADER_LEN);
          this.dispatchFrame(cameraId, jpeg);
        }
      };
    } catch (err) {
      console.error('[WS] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
    this.notifyConnectionListeners();
  }

  /**
   * Subscribe to a specific ROS topic.
   * Returns an unsubscribe function.
   */
  subscribe(topic: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
    }
    this.handlers.get(topic)!.add(handler);

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }

  /**
   * Subscribe to ALL telemetry messages.
   */
  subscribeAll(handler: (msg: TelemetryMessage) => void): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to binary camera frames for a given camera ID.
   * Returns an unsubscribe function.
   */
  subscribeFrame(cameraId: string, handler: FrameHandler): () => void {
    if (!this.frameHandlers.has(cameraId)) {
      this.frameHandlers.set(cameraId, new Set());
    }
    this.frameHandlers.get(cameraId)!.add(handler);

    return () => {
      this.frameHandlers.get(cameraId)?.delete(handler);
    };
  }

  /**
   * Listen for connection state changes.
   */
  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this.connectionListeners.add(handler);
    handler(this._connected); // Immediate callback with current state
    return () => {
      this.connectionListeners.delete(handler);
    };
  }

  /**
   * Send a message to the backend (future: commands).
   */
  send(data: Record<string, any>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private dispatch(msg: TelemetryMessage) {
    // Topic-specific handlers
    const topicHandlers = this.handlers.get(msg.topic);
    if (topicHandlers) {
      topicHandlers.forEach((h) => h(msg));
    }

    // Global handlers
    this.globalHandlers.forEach((h) => h(msg));
  }

  private dispatchFrame(cameraId: string, jpeg: Uint8Array<ArrayBuffer>) {
    this.frameHandlers.get(cameraId)?.forEach((h) => h(jpeg));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    console.log(`[WS] Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  private notifyConnectionListeners() {
    this.connectionListeners.forEach((h) => h(this._connected));
  }
}

// Singleton — one connection per app
export const wsClient = new WSClient();
