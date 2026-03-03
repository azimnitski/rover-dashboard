"""
Camera Streamer
================
Subscribes to ROS 2 image topics (D455 color + depth) and compresses
frames to JPEG for efficient WebSocket streaming.

Phase 2 implementation — stubbed for now with mock data support.
"""

import os
import time
import threading
import logging
from typing import Callable, Optional

logger = logging.getLogger("camera-stream")

MOCK_MODE = os.environ.get("ROVER_MOCK_ROS", "0") == "1"


class CameraStreamer:
    """
    Subscribes to camera image topics and streams compressed JPEG
    frames to connected WebSocket clients.

    Cameras:
        - color: /camera/color/image_raw
        - depth: /camera/depth/image_rect_raw (colorized)

    In Phase 2, this will:
    1. Subscribe to Image topics via rclpy
    2. Convert ROS Image → OpenCV → JPEG bytes
    3. Throttle to ~15fps to save WiFi bandwidth
    4. Call on_frame(camera_id, jpeg_bytes) for broadcasting
    """

    def __init__(self, on_frame: Callable[[str, bytes], None]):
        self.on_frame = on_frame
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._target_fps = 15
        self._frame_interval = 1.0 / self._target_fps

    def start(self):
        self._running = True
        # Phase 2: uncomment to enable camera streaming
        # self._thread = threading.Thread(target=self._run, daemon=True)
        # self._thread.start()
        logger.info("Camera streamer initialized (Phase 2 — not yet active)")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self):
        """
        Phase 2 implementation sketch:

        import rclpy
        import cv2
        import numpy as np
        from cv_bridge import CvBridge
        from sensor_msgs.msg import Image

        rclpy.init()
        node = rclpy.create_node("camera_streamer")
        bridge = CvBridge()

        def color_callback(msg):
            cv_image = bridge.imgmsg_to_cv2(msg, "bgr8")
            # Resize for bandwidth
            cv_image = cv2.resize(cv_image, (640, 480))
            _, jpeg = cv2.imencode('.jpg', cv_image, [cv2.IMWRITE_JPEG_QUALITY, 70])
            self.on_frame("color", jpeg.tobytes())

        def depth_callback(msg):
            cv_image = bridge.imgmsg_to_cv2(msg, "16UC1")
            # Normalize and colorize depth
            depth_normalized = cv2.normalize(cv_image, None, 0, 255, cv2.NORM_MINMAX)
            depth_colored = cv2.applyColorMap(
                depth_normalized.astype(np.uint8), cv2.COLORMAP_JET
            )
            depth_colored = cv2.resize(depth_colored, (640, 480))
            _, jpeg = cv2.imencode('.jpg', depth_colored, [cv2.IMWRITE_JPEG_QUALITY, 70])
            self.on_frame("depth", jpeg.tobytes())

        node.create_subscription(Image, "/camera/color/image_raw", color_callback, 10)
        node.create_subscription(Image, "/camera/depth/image_rect_raw", depth_callback, 10)

        while self._running:
            rclpy.spin_once(node, timeout_sec=0.01)

        node.destroy_node()
        rclpy.shutdown()
        """
        pass
