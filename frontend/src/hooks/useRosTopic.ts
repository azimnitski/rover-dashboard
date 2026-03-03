import { useState, useEffect, useRef, useCallback } from 'react';
import { wsClient, TelemetryMessage } from '../lib/wsClient';

/**
 * Subscribe to a specific ROS topic and get the latest data.
 *
 * @param topic - ROS topic name (e.g., "/imu/data")
 * @param maxHistory - Number of historical data points to keep (for charts)
 */
export function useRosTopic<T = Record<string, any>>(
  topic: string,
  maxHistory: number = 1
) {
  const [data, setData] = useState<T | null>(null);
  const [history, setHistory] = useState<{ timestamp: number; data: T }[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  useEffect(() => {
    const unsub = wsClient.subscribe(topic, (msg: TelemetryMessage) => {
      const typed = msg.data as T;
      setData(typed);
      setLastUpdate(msg.timestamp);

      if (maxHistory > 1) {
        setHistory((prev) => {
          const next = [...prev, { timestamp: msg.timestamp, data: typed }];
          return next.length > maxHistory ? next.slice(-maxHistory) : next;
        });
      }
    });

    return unsub;
  }, [topic, maxHistory]);

  return { data, history, lastUpdate };
}

/**
 * Get WebSocket connection status.
 */
export function useConnectionStatus() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    wsClient.connect();
    const unsub = wsClient.onConnectionChange(setConnected);
    return () => {
      unsub();
    };
  }, []);

  return connected;
}

/**
 * Subscribe to all telemetry for the TopicExplorer.
 */
export function useAllTopics() {
  const [topics, setTopics] = useState<
    Map<string, { data: Record<string, any>; timestamp: number; updateCount: number }>
  >(new Map());

  useEffect(() => {
    const unsub = wsClient.subscribeAll((msg) => {
      setTopics((prev) => {
        const next = new Map(prev);
        const existing = next.get(msg.topic);
        next.set(msg.topic, {
          data: msg.data,
          timestamp: msg.timestamp,
          updateCount: (existing?.updateCount ?? 0) + 1,
        });
        return next;
      });
    });
    return unsub;
  }, []);

  return topics;
}
