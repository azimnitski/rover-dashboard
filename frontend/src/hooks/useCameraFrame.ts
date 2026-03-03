import { useState, useEffect, useRef } from 'react';
import { wsClient } from '../lib/wsClient';

/**
 * Subscribes to JPEG camera frames for a given camera ID.
 * Returns a blob URL suitable for use as <img src>.
 * Revokes the previous URL on each new frame to avoid memory leaks.
 */
export function useCameraFrame(cameraId: string): string | null {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = wsClient.subscribeFrame(cameraId, (jpeg: Uint8Array<ArrayBuffer>) => {
      const blob = new Blob([jpeg], { type: 'image/jpeg' });
      const newUrl = URL.createObjectURL(blob);

      // Revoke the previous blob URL now that a new frame is ready
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
      }
      prevUrlRef.current = newUrl;
      setSrcUrl(newUrl);
    });

    return () => {
      unsub();
      // Clean up on unmount
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    };
  }, [cameraId]);

  return srcUrl;
}
