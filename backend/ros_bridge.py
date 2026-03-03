"""
ROS 2 Bridge
=============
Subscribes to ROS 2 topics using rclpy and forwards parsed data
to the FastAPI WebSocket layer.

Runs in a separate thread so it doesn't block the async event loop.

IMPORTANT: This module requires ROS 2 Humble and rclpy to be installed.
On the Orin Nano, source /opt/ros/humble/setup.bash before running.

For development/testing WITHOUT ROS, set environment variable:
    ROVER_MOCK_ROS=1
This will generate fake telemetry data for UI development.
"""

import os
import math
import time
import random
import threading
import logging
from typing import Callable, Dict, List, Optional

logger = logging.getLogger("ros-bridge")

MOCK_MODE = os.environ.get("ROVER_MOCK_ROS", "0") == "1"

if not MOCK_MODE:
    try:
        import rclpy
        from rclpy.node import Node
        from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
        from sensor_msgs.msg import Imu, BatteryState, CameraInfo, Image
        from geometry_msgs.msg import Twist
        from std_msgs.msg import Float32, Float32MultiArray, Int32MultiArray
        from realsense2_camera_msgs.msg import Metadata, Extrinsics
        ROS_AVAILABLE = True
    except ImportError:
        logger.warning("rclpy not available — falling back to mock mode")
        MOCK_MODE = True
        ROS_AVAILABLE = False


# ---------------------------------------------------------------------------
# Topic configuration
# ---------------------------------------------------------------------------
# Define which topics to subscribe to and how to parse them.
# Add new topics here as your robot grows.

TOPIC_CONFIG = [
    {
        "topic": "/imu/data",
        "type": "sensor_msgs/msg/Imu",
        "throttle_hz": 10,  # IMU may publish at 100Hz, we only need 10
    },
    {
        "topic": "/battery_voltage",
        "type": "std_msgs/msg/Float32",
        "throttle_hz": 1,
    },
    {
        "topic": "/battery_current",
        "type": "std_msgs/msg/Float32",
        "throttle_hz": 1,
    },
    {
        "topic": "/motors/status",
        "type": "std_msgs/msg/Float32MultiArray",
        "throttle_hz": 5,
    },
    {
        "topic": "/motors/current",
        "type": "std_msgs/msg/Float32MultiArray",
        "throttle_hz": 5,
    },
    {
        "topic": "/cmd_vel",
        "type": "geometry_msgs/msg/Twist",
        "throttle_hz": 10,
    },
    # RealSense D455 — metadata / intrinsics / extrinsics
    {
        "topic": "/camera/camera/color/camera_info",
        "type": "sensor_msgs/msg/CameraInfo",
        "throttle_hz": 1,
    },
    {
        "topic": "/camera/camera/color/metadata",
        "type": "realsense2_camera_msgs/msg/Metadata",
        "throttle_hz": 5,
    },
    {
        "topic": "/camera/camera/depth/camera_info",
        "type": "sensor_msgs/msg/CameraInfo",
        "throttle_hz": 1,
    },
    {
        "topic": "/camera/camera/depth/metadata",
        "type": "realsense2_camera_msgs/msg/Metadata",
        "throttle_hz": 5,
    },
    {
        "topic": "/camera/camera/aligned_depth_to_color/camera_info",
        "type": "sensor_msgs/msg/CameraInfo",
        "throttle_hz": 1,
    },
    {
        "topic": "/camera/camera/extrinsics/depth_to_color",
        "type": "realsense2_camera_msgs/msg/Extrinsics",
        "throttle_hz": 1,
    },
]

# Image topics streamed as JPEG binary frames (not JSON telemetry)
IMAGE_TOPICS = [
    {"topic": "/camera/camera/color/image_raw",               "camera_id": "color"},
    {"topic": "/camera/camera/depth/image_rect_raw",          "camera_id": "depth"},
    {"topic": "/camera/camera/aligned_depth_to_color/image_raw", "camera_id": "aligned_depth"},
]


# ---------------------------------------------------------------------------
# Message parsers — convert ROS messages to JSON-friendly dicts
# ---------------------------------------------------------------------------
def parse_imu(msg) -> dict:
    return {
        "orientation": {
            "x": msg.orientation.x,
            "y": msg.orientation.y,
            "z": msg.orientation.z,
            "w": msg.orientation.w,
        },
        "angular_velocity": {
            "x": msg.angular_velocity.x,
            "y": msg.angular_velocity.y,
            "z": msg.angular_velocity.z,
        },
        "linear_acceleration": {
            "x": msg.linear_acceleration.x,
            "y": msg.linear_acceleration.y,
            "z": msg.linear_acceleration.z,
        },
    }


def parse_float32(msg) -> dict:
    return {"value": msg.data}


def parse_float32_array(msg) -> dict:
    return {"values": list(msg.data)}


def parse_twist(msg) -> dict:
    return {
        "linear": {"x": msg.linear.x, "y": msg.linear.y, "z": msg.linear.z},
        "angular": {"x": msg.angular.x, "y": msg.angular.y, "z": msg.angular.z},
    }


def parse_camera_info(msg) -> dict:
    return {
        "width": msg.width,
        "height": msg.height,
        "distortion_model": msg.distortion_model,
        "D": list(msg.d),
        "K": list(msg.k),
        "R": list(msg.r),
        "P": list(msg.p),
    }


def parse_metadata(msg) -> dict:
    import json as _json
    try:
        return {"data": _json.loads(msg.json_data)}
    except Exception:
        return {"json_data": msg.json_data}


def parse_extrinsics(msg) -> dict:
    return {
        "rotation": list(msg.rotation),
        "translation": list(msg.translation),
    }


PARSERS = {
    "sensor_msgs/msg/Imu": parse_imu,
    "std_msgs/msg/Float32": parse_float32,
    "std_msgs/msg/Float32MultiArray": parse_float32_array,
    "std_msgs/msg/Int32MultiArray": lambda msg: {"values": list(msg.data)},
    "geometry_msgs/msg/Twist": parse_twist,
    "sensor_msgs/msg/BatteryState": lambda msg: {
        "voltage": msg.voltage,
        "current": msg.current,
        "percentage": msg.percentage,
    },
    "sensor_msgs/msg/CameraInfo": parse_camera_info,
    "realsense2_camera_msgs/msg/Metadata": parse_metadata,
    "realsense2_camera_msgs/msg/Extrinsics": parse_extrinsics,
}

# Map type strings to actual ROS message classes
if not MOCK_MODE:
    MSG_CLASSES = {
        "sensor_msgs/msg/Imu": Imu,
        "std_msgs/msg/Float32": Float32,
        "std_msgs/msg/Float32MultiArray": Float32MultiArray,
        "std_msgs/msg/Int32MultiArray": Int32MultiArray,
        "geometry_msgs/msg/Twist": Twist,
        "sensor_msgs/msg/BatteryState": BatteryState,
        "sensor_msgs/msg/CameraInfo": CameraInfo,
        "realsense2_camera_msgs/msg/Metadata": Metadata,
        "realsense2_camera_msgs/msg/Extrinsics": Extrinsics,
    }


# ---------------------------------------------------------------------------
# ROS Bridge (real)
# ---------------------------------------------------------------------------
class RosBridge:
    def __init__(self, on_telemetry: Callable[[str, dict], None],
                 on_frame: Optional[Callable[[str, bytes], None]] = None):
        self.on_telemetry = on_telemetry
        self.on_frame = on_frame
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._last_publish: Dict[str, float] = {}
        self._discovered_topics: List[dict] = []

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def get_topics(self) -> List[dict]:
        return self._discovered_topics

    def _run(self):
        if MOCK_MODE:
            self._run_mock()
            return

        rclpy.init()
        node = rclpy.create_node("rover_dashboard_bridge")
        logger.info("ROS 2 node created: rover_dashboard_bridge")

        # QoS for best-effort sensor data
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
        )

        for config in TOPIC_CONFIG:
            topic = config["topic"]
            msg_type_str = config["type"]
            throttle_hz = config.get("throttle_hz", 10)

            if msg_type_str not in MSG_CLASSES:
                logger.warning(f"Unknown message type: {msg_type_str}, skipping {topic}")
                continue

            msg_class = MSG_CLASSES[msg_type_str]
            parser = PARSERS.get(msg_type_str, lambda m: {"raw": str(m)})
            min_interval = 1.0 / throttle_hz

            def make_callback(t=topic, p=parser, mi=min_interval):
                def callback(msg):
                    now = time.time()
                    last = self._last_publish.get(t, 0)
                    if now - last >= mi:
                        self._last_publish[t] = now
                        try:
                            data = p(msg)
                            self.on_telemetry(t, data)
                        except Exception as e:
                            logger.error(f"Error parsing {t}: {e}")
                return callback

            node.create_subscription(msg_class, topic, make_callback(), sensor_qos)
            logger.info(f"Subscribed to {topic} ({msg_type_str}) @ {throttle_hz}Hz max")

        # Camera image subscriptions — JPEG-compressed and forwarded as binary frames
        if self.on_frame:
            try:
                from cv_bridge import CvBridge
                import cv2
                import numpy as np

                bridge = CvBridge()

                for img_cfg in IMAGE_TOPICS:
                    img_topic = img_cfg["topic"]
                    camera_id = img_cfg["camera_id"]
                    min_interval = 1.0 / 15  # cap at 15 fps

                    def make_image_callback(cid=camera_id, mi=min_interval):
                        def callback(msg):
                            now = time.time()
                            key = f"__img_{cid}"
                            if now - self._last_publish.get(key, 0) < mi:
                                return
                            self._last_publish[key] = now
                            try:
                                if cid == "color":
                                    cv_img = bridge.imgmsg_to_cv2(msg, "bgr8")
                                else:
                                    cv_img = bridge.imgmsg_to_cv2(msg, "16UC1")
                                    cv_img = cv2.normalize(cv_img, None, 0, 255, cv2.NORM_MINMAX)
                                    cv_img = cv2.applyColorMap(cv_img.astype(np.uint8), cv2.COLORMAP_JET)
                                cv_img = cv2.resize(cv_img, (640, 480))
                                _, jpeg = cv2.imencode(".jpg", cv_img, [cv2.IMWRITE_JPEG_QUALITY, 75])
                                self.on_frame(cid, jpeg.tobytes())
                            except Exception as e:
                                logger.error(f"Error encoding {cid} frame: {e}")
                        return callback

                    node.create_subscription(Image, img_topic, make_image_callback(), sensor_qos)
                    logger.info(f"Subscribed to {img_topic} as camera '{camera_id}' @ 15fps max")

            except ImportError as e:
                logger.warning(f"cv_bridge/cv2 not available, camera image streaming disabled: {e}")

        # Discover all available topics periodically
        def discover_topics():
            names_and_types = node.get_topic_names_and_types()
            self._discovered_topics = [
                {"name": name, "types": types}
                for name, types in names_and_types
            ]

        while self._running:
            rclpy.spin_once(node, timeout_sec=0.05)
            discover_topics()

        node.destroy_node()
        rclpy.shutdown()

    # ------------------------------------------------------------------
    # Mock mode for development without ROS
    # ------------------------------------------------------------------
    def _run_mock(self):
        logger.info("Running in MOCK mode — generating fake telemetry")
        self._discovered_topics = [
            {"name": c["topic"], "types": [c["type"]]} for c in TOPIC_CONFIG
        ]

        t = 0.0
        while self._running:
            t += 0.1

            # Mock IMU
            self.on_telemetry("/imu/data", {
                "orientation": {
                    "x": 0.01 * math.sin(t * 0.5),
                    "y": 0.02 * math.cos(t * 0.3),
                    "z": 0.0,
                    "w": 1.0,
                },
                "angular_velocity": {
                    "x": 0.1 * math.sin(t),
                    "y": 0.05 * math.cos(t * 1.5),
                    "z": 0.02 * math.sin(t * 0.7),
                },
                "linear_acceleration": {
                    "x": 0.3 * math.sin(t * 2) + random.gauss(0, 0.05),
                    "y": 0.1 * math.cos(t) + random.gauss(0, 0.05),
                    "z": 9.81 + random.gauss(0, 0.02),
                },
            })

            # Mock battery
            self.on_telemetry("/battery_voltage", {
                "value": 12.6 - 0.3 * (t / 600) + random.gauss(0, 0.05),
            })
            self.on_telemetry("/battery_current", {
                "value": 1.2 + random.gauss(0, 0.05),
            })

            # Mock motors (4 motors: FL, FR, RL, RR)
            base_speed = 50 + 20 * math.sin(t * 0.2)
            self.on_telemetry("/motors/status", {
                "values": [
                    base_speed + random.gauss(0, 2),
                    base_speed + random.gauss(0, 2),
                    base_speed + random.gauss(0, 2),
                    base_speed + random.gauss(0, 2),
                ],
            })

            # Mock motor currents
            self.on_telemetry("/motors/current", {
                "values": [
                    0.5 + random.gauss(0, 0.1),
                    0.5 + random.gauss(0, 0.1),
                    0.5 + random.gauss(0, 0.1),
                    0.5 + random.gauss(0, 0.1),
                ],
            })

            # Mock cmd_vel
            self.on_telemetry("/cmd_vel", {
                "linear": {"x": 0.5 * math.sin(t * 0.1), "y": 0.0, "z": 0.0},
                "angular": {"x": 0.0, "y": 0.0, "z": 0.3 * math.cos(t * 0.15)},
            })

            time.sleep(0.1)
