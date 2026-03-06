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
        from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
        from sensor_msgs.msg import Imu, BatteryState, CameraInfo, Image, NavSatFix, MagneticField, PointCloud2
        from geometry_msgs.msg import Twist, PoseWithCovarianceStamped
        from nav_msgs.msg import Odometry, OccupancyGrid, Path
        from std_msgs.msg import Float32, Float32MultiArray, Int32MultiArray, Int32, Bool
        from diagnostic_msgs.msg import DiagnosticArray
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
    # ESP32 (micro-ROS)
    {
        "topic": "/imu",
        "type": "sensor_msgs/msg/Imu",
        "throttle_hz": 10,
    },
    {
        "topic": "/imu/mag",
        "type": "sensor_msgs/msg/MagneticField",
        "throttle_hz": 5,
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
        "topic": "/wheel_speed_left",
        "type": "std_msgs/msg/Float32",
        "throttle_hz": 10,
    },
    {
        "topic": "/wheel_speed_right",
        "type": "std_msgs/msg/Float32",
        "throttle_hz": 10,
    },
    {
        "topic": "/freertos_int32_publisher",
        "type": "std_msgs/msg/Int32",
        "throttle_hz": 1,
    },
    {
        "topic": "/cmd_vel",
        "type": "geometry_msgs/msg/Twist",
        "throttle_hz": 10,
    },
    # RTABMAP / Navigation
    {
        "topic": "/rtabmap/odom",
        "type": "nav_msgs/msg/Odometry",
        "throttle_hz": 5,
    },
    {
        "topic": "/rtabmap/global_path",
        "type": "nav_msgs/msg/Path",
        "throttle_hz": 2,
    },
    {
        "topic": "/rtabmap/local_path",
        "type": "nav_msgs/msg/Path",
        "throttle_hz": 5,
    },
    {
        "topic": "/rtabmap/global_pose",
        "type": "geometry_msgs/msg/PoseWithCovarianceStamped",
        "throttle_hz": 2,
    },
    {
        "topic": "/rtabmap/localization_pose",
        "type": "geometry_msgs/msg/PoseWithCovarianceStamped",
        "throttle_hz": 5,
    },
    {
        "topic": "/rtabmap/goal_reached",
        "type": "std_msgs/msg/Bool",
        "throttle_hz": 2,
    },
    # Other sensors
    {
        "topic": "/diagnostics",
        "type": "diagnostic_msgs/msg/DiagnosticArray",
        "throttle_hz": 1,
    },
    {
        "topic": "/gps/fix",
        "type": "sensor_msgs/msg/NavSatFix",
        "throttle_hz": 1,
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

# OccupancyGrid topics rendered to JPEG and streamed as binary frames
MAP_TOPICS = [
    {"topic": "/rtabmap/map",           "camera_id": "slam_map"},
    {"topic": "/rtabmap/grid_prob_map", "camera_id": "slam_prob_map"},
]

# PointCloud2 topics streamed as packed binary frames
POINTCLOUD_TOPICS = [
    {"topic": "/rtabmap/cloud_map", "camera_id": "pointcloud3d"},
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


def parse_magnetic_field(msg) -> dict:
    return {
        "x": msg.magnetic_field.x,
        "y": msg.magnetic_field.y,
        "z": msg.magnetic_field.z,
    }


def parse_freertos_diag(msg) -> dict:
    """
    Decode the packed ESP32 diagnostic integer:
      motor×10⁷ + enc×10⁶ + imu×10⁵ + mag×10⁴ + lpwm×100 + cmd_count
    The whole value can be negative when left PWM is negative (reverse).
    """
    raw = msg.data
    v = abs(raw)
    motor_ok = bool((v // 10_000_000) % 10)
    enc_ok   = bool((v // 1_000_000)  % 10)
    imu_ok   = bool((v // 100_000)    % 10)
    mag_ok   = bool((v // 10_000)     % 10)
    remainder = v % 10_000          # lpwm×100 + cmd_count (cmd_count < 100)
    lpwm      = (remainder // 100) * (-1 if raw < 0 else 1)
    cmd_count = remainder % 100
    return {
        "motor_ok":  motor_ok,
        "enc_ok":    enc_ok,
        "imu_ok":    imu_ok,
        "mag_ok":    mag_ok,
        "lpwm":      lpwm,
        "cmd_count": cmd_count,
        "raw":       raw,
    }


def _quat_to_yaw(x, y, z, w) -> float:
    """Convert quaternion to yaw (rotation around Z axis) in radians."""
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def parse_odometry(msg) -> dict:
    p = msg.pose.pose.position
    q = msg.pose.pose.orientation
    v = msg.twist.twist.linear
    av = msg.twist.twist.angular
    return {
        "position": {"x": p.x, "y": p.y, "z": p.z},
        "orientation": {"x": q.x, "y": q.y, "z": q.z, "w": q.w},
        "yaw": _quat_to_yaw(q.x, q.y, q.z, q.w),
        "linear_velocity": {"x": v.x, "y": v.y, "z": v.z},
        "angular_velocity": {"z": av.z},
    }


def parse_path(msg) -> dict:
    poses = []
    for ps in msg.poses:
        p = ps.pose.position
        q = ps.pose.orientation
        poses.append({"x": p.x, "y": p.y, "yaw": _quat_to_yaw(q.x, q.y, q.z, q.w)})
    return {"poses": poses}


def parse_pose_with_covariance(msg) -> dict:
    p = msg.pose.pose.position
    q = msg.pose.pose.orientation
    return {
        "position": {"x": p.x, "y": p.y, "z": p.z},
        "orientation": {"x": q.x, "y": q.y, "z": q.z, "w": q.w},
        "yaw": _quat_to_yaw(q.x, q.y, q.z, q.w),
        "covariance": list(msg.pose.covariance[:9]),  # top-left 3x3 of 6x6
    }


def parse_bool(msg) -> dict:
    return {"value": bool(msg.data)}


def parse_diagnostics(msg) -> dict:
    statuses = []
    for s in msg.status:
        statuses.append({
            "level": s.level[0] if isinstance(s.level, (bytes, bytearray)) else int(s.level),
            "name": s.name,
            "message": s.message,
            "hardware_id": s.hardware_id,
        })
    return {"status": statuses}


def parse_navsat(msg) -> dict:
    return {
        "latitude": msg.latitude,
        "longitude": msg.longitude,
        "altitude": msg.altitude,
        "status": int(msg.status.status),   # -1=no fix, 0=fix, 2=GBAS
        "covariance_type": int(msg.position_covariance_type),
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
    "sensor_msgs/msg/MagneticField": parse_magnetic_field,
    "std_msgs/msg/Int32": parse_freertos_diag,
    "nav_msgs/msg/Odometry": parse_odometry,
    "nav_msgs/msg/Path": parse_path,
    "geometry_msgs/msg/PoseWithCovarianceStamped": parse_pose_with_covariance,
    "std_msgs/msg/Bool": parse_bool,
    "diagnostic_msgs/msg/DiagnosticArray": parse_diagnostics,
    "sensor_msgs/msg/NavSatFix": parse_navsat,
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
        "sensor_msgs/msg/MagneticField": MagneticField,
        "std_msgs/msg/Int32": Int32,
        "nav_msgs/msg/Odometry": Odometry,
        "nav_msgs/msg/Path": Path,
        "geometry_msgs/msg/PoseWithCovarianceStamped": PoseWithCovarianceStamped,
        "std_msgs/msg/Bool": Bool,
        "diagnostic_msgs/msg/DiagnosticArray": DiagnosticArray,
        "sensor_msgs/msg/NavSatFix": NavSatFix,
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
        # Latest state for map rendering overlays
        self._latest_robot_pose: Optional[dict] = None  # {x, y, yaw} in map frame
        self._latest_global_path: List[dict] = []       # [{x, y}, ...]
        self._latest_local_path: List[dict] = []

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

        # QoS for RTABMAP map/pointcloud topics (RELIABLE + TRANSIENT_LOCAL)
        map_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
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

        # OccupancyGrid map topics — rendered to JPEG and sent as binary frames
        if self.on_frame:
            try:
                import cv2
                import numpy as np

                # Latest cached OccupancyGrid messages keyed by camera_id
                latest_map_msgs = {}

                def _render_and_send_map(cid, msg):
                    """Render OccupancyGrid (with current pose/path overlays) and broadcast."""
                    try:
                        w = msg.info.width
                        h = msg.info.height
                        if w == 0 or h == 0 or max(w, h) < 64:
                            return
                        res = msg.info.resolution
                        origin_x = msg.info.origin.position.x
                        origin_y = msg.info.origin.position.y

                        data = np.array(msg.data, dtype=np.int8).reshape((h, w))
                        img = np.full((h, w, 3), 50, dtype=np.uint8)
                        img[data == 0] = [180, 180, 180]
                        img[data == 100] = [20, 20, 20]
                        mask_known = (data > 0) & (data < 100)
                        if mask_known.any():
                            img[mask_known] = np.stack([
                                (data[mask_known].astype(np.uint16) * 180 // 100).astype(np.uint8),
                            ] * 3, axis=-1)

                        scale = 512 / max(w, h)
                        new_w = max(1, int(w * scale))
                        new_h = max(1, int(h * scale))
                        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_NEAREST)

                        def world_to_px(wx, wy):
                            return int((wx - origin_x) / res * scale), int((wy - origin_y) / res * scale)

                        pts = self._latest_global_path
                        if len(pts) > 1:
                            for i in range(len(pts) - 1):
                                cv2.line(img, world_to_px(pts[i]["x"], pts[i]["y"]),
                                         world_to_px(pts[i+1]["x"], pts[i+1]["y"]), (255, 100, 0), 1)

                        pts = self._latest_local_path
                        if len(pts) > 1:
                            for i in range(len(pts) - 1):
                                cv2.line(img, world_to_px(pts[i]["x"], pts[i]["y"]),
                                         world_to_px(pts[i+1]["x"], pts[i+1]["y"]), (255, 200, 0), 1)

                        pose = self._latest_robot_pose
                        if pose:
                            px, py = world_to_px(pose["x"], pose["y"])
                            arrow_len = max(6, int(0.5 / res * scale))
                            ex = int(px + arrow_len * math.cos(pose["yaw"]))
                            ey = int(py + arrow_len * math.sin(pose["yaw"]))
                            cv2.circle(img, (px, py), 4, (0, 220, 0), -1)
                            cv2.arrowedLine(img, (px, py), (ex, ey), (0, 255, 0), 2, tipLength=0.4)

                        img = cv2.flip(img, 0)
                        _, jpeg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                        self.on_frame(cid, jpeg.tobytes())
                    except Exception as e:
                        logger.error(f"Error rendering map {cid}: {e}", exc_info=True)

                # Re-render all cached maps whenever pose updates (so robot arrow moves
                # even in localization mode where the OccupancyGrid never changes)
                MIN_MAP_INTERVAL = 0.5  # seconds between renders

                def _update_pose(msg):
                    p = msg.pose.pose.position
                    q = msg.pose.pose.orientation
                    self._latest_robot_pose = {
                        "x": p.x, "y": p.y,
                        "yaw": _quat_to_yaw(q.x, q.y, q.z, q.w),
                    }
                    now = time.time()
                    for cid, stored_msg in list(latest_map_msgs.items()):
                        key = f"__map_{cid}"
                        if now - self._last_publish.get(key, 0) >= MIN_MAP_INTERVAL:
                            self._last_publish[key] = now
                            _render_and_send_map(cid, stored_msg)

                def _update_global_path(msg):
                    self._latest_global_path = [
                        {"x": ps.pose.position.x, "y": ps.pose.position.y}
                        for ps in msg.poses
                    ]

                def _update_local_path(msg):
                    self._latest_local_path = [
                        {"x": ps.pose.position.x, "y": ps.pose.position.y}
                        for ps in msg.poses
                    ]

                node.create_subscription(
                    PoseWithCovarianceStamped, "/rtabmap/localization_pose",
                    _update_pose, sensor_qos
                )
                node.create_subscription(Path, "/rtabmap/global_path", _update_global_path, sensor_qos)
                node.create_subscription(Path, "/rtabmap/local_path", _update_local_path, sensor_qos)

                for map_cfg in MAP_TOPICS:
                    map_topic = map_cfg["topic"]
                    camera_id = map_cfg["camera_id"]

                    def make_map_callback(cid=camera_id):
                        def callback(msg):
                            latest_map_msgs[cid] = msg  # cache for timer-driven re-renders
                            # Also render immediately on new map data
                            now = time.time()
                            key = f"__map_{cid}"
                            if now - self._last_publish.get(key, 0) >= MIN_MAP_INTERVAL:
                                self._last_publish[key] = now
                                _render_and_send_map(cid, msg)
                        return callback

                    node.create_subscription(OccupancyGrid, map_topic, make_map_callback(), map_qos)
                    logger.info(f"Subscribed to {map_topic} as map '{camera_id}' @ 2fps max")

                # Timer: re-render cached maps at 2fps regardless of localization state.
                # This keeps the robot-pose arrow live even when localization_pose is not
                # published (e.g. RTABMAP has not yet recognized a loop closure).
                def _timer_render_maps():
                    now = time.time()
                    for cid, stored_msg in list(latest_map_msgs.items()):
                        key = f"__map_{cid}"
                        if now - self._last_publish.get(key, 0) >= MIN_MAP_INTERVAL:
                            self._last_publish[key] = now
                            _render_and_send_map(cid, stored_msg)

                node.create_timer(MIN_MAP_INTERVAL, _timer_render_maps)

            except ImportError as e:
                logger.warning(f"cv2/numpy not available, map rendering disabled: {e}")

        # PointCloud2 topics — packed binary frames
        if self.on_frame:
            try:
                import struct
                import numpy as np

                for pc_cfg in POINTCLOUD_TOPICS:
                    pc_topic = pc_cfg["topic"]
                    camera_id = pc_cfg["camera_id"]
                    min_interval = 1.0 / 2  # cap at 2 fps

                    def make_pc_callback(cid=camera_id, mi=min_interval):
                        def callback(msg):
                            now = time.time()
                            key = f"__pc_{cid}"
                            if now - self._last_publish.get(key, 0) < mi:
                                return
                            self._last_publish[key] = now
                            try:
                                n = msg.width * msg.height
                                if n == 0:
                                    return
                                ps = msg.point_step
                                raw = bytes(msg.data)
                                fmap = {f.name: f.offset for f in msg.fields}
                                if not all(k in fmap for k in ('x', 'y', 'z')):
                                    return

                                arr = np.frombuffer(raw, dtype=np.uint8).reshape(n, ps)

                                def col_f32(off):
                                    return np.frombuffer(
                                        arr[:, off:off+4].tobytes(), dtype=np.float32)

                                positions = np.stack([
                                    col_f32(fmap['x']),
                                    col_f32(fmap['y']),
                                    col_f32(fmap['z']),
                                ], axis=1)

                                valid = np.isfinite(positions).all(axis=1)
                                positions = positions[valid]

                                colors = None
                                if 'rgb' in fmap:
                                    rgb_col = col_f32(fmap['rgb'])[valid]
                                    rgb_int = rgb_col.view(np.uint32)
                                    colors = np.stack([
                                        ((rgb_int >> 16) & 0xFF).astype(np.uint8),
                                        ((rgb_int >> 8)  & 0xFF).astype(np.uint8),
                                        (rgb_int         & 0xFF).astype(np.uint8),
                                    ], axis=1)

                                actual_n = len(positions)
                                MAX_POINTS = 100_000
                                if actual_n > MAX_POINTS:
                                    idx = np.random.choice(actual_n, MAX_POINTS, replace=False)
                                    positions = positions[idx]
                                    if colors is not None:
                                        colors = colors[idx]
                                    actual_n = MAX_POINTS

                                payload = struct.pack('<I', actual_n)
                                payload += struct.pack('BBBB',
                                    1 if colors is not None else 0, 0, 0, 0)
                                payload += positions.astype(np.float32).tobytes()
                                if colors is not None:
                                    payload += colors.tobytes()

                                self.on_frame(cid, payload)
                                logger.info(f"Point cloud frame sent: {cid} ({actual_n} pts, color={colors is not None})")
                            except Exception as e:
                                logger.error(f"Error packing point cloud {cid}: {e}", exc_info=True)
                        return callback

                    node.create_subscription(PointCloud2, pc_topic, make_pc_callback(), map_qos)
                    logger.info(f"Subscribed to {pc_topic} as point cloud '{camera_id}' @ 2fps max")

            except ImportError as e:
                logger.warning(f"numpy not available, point cloud streaming disabled: {e}")

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
            self.on_telemetry("/imu", {
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

            # Mock wheel speeds (m/s, max ~1.0)
            wheel_v = 0.5 * math.sin(t * 0.2)
            self.on_telemetry("/wheel_speed_left",  {"value": wheel_v + random.gauss(0, 0.01)})
            self.on_telemetry("/wheel_speed_right", {"value": wheel_v + random.gauss(0, 0.01)})

            # Mock ESP32 freertos diagnostic int (all subsystems OK, lpwm≈50, cmd_count cycling)
            cmd_count = int(t * 2) % 100
            lpwm = int(wheel_v * 100)  # rough approximation
            mock_diag = 11110000 + lpwm * 100 + cmd_count
            self.on_telemetry("/freertos_int32_publisher", {
                "motor_ok": True, "enc_ok": True, "imu_ok": True, "mag_ok": True,
                "lpwm": lpwm, "cmd_count": cmd_count, "raw": mock_diag,
            })

            # Mock magnetometer (Earth's field, µT scale)
            self.on_telemetry("/imu/mag", {
                "x": 20e-6 * math.cos(t * 0.01) + random.gauss(0, 1e-7),
                "y": 5e-6  + random.gauss(0, 1e-7),
                "z": -42e-6 + random.gauss(0, 1e-7),
            })

            # Mock cmd_vel
            self.on_telemetry("/cmd_vel", {
                "linear": {"x": 0.5 * math.sin(t * 0.1), "y": 0.0, "z": 0.0},
                "angular": {"x": 0.0, "y": 0.0, "z": 0.3 * math.cos(t * 0.15)},
            })

            # Mock RTABMAP odometry (spiral trajectory)
            odom_x = 3.0 * math.cos(t * 0.05)
            odom_y = 3.0 * math.sin(t * 0.05)
            odom_yaw = t * 0.05 + math.pi / 2
            self.on_telemetry("/rtabmap/odom", {
                "position": {"x": odom_x, "y": odom_y, "z": 0.0},
                "orientation": {"x": 0.0, "y": 0.0, "z": math.sin(odom_yaw / 2), "w": math.cos(odom_yaw / 2)},
                "yaw": odom_yaw,
                "linear_velocity": {"x": 0.15, "y": 0.0, "z": 0.0},
                "angular_velocity": {"z": 0.05},
            })

            # Mock localization pose
            self.on_telemetry("/rtabmap/localization_pose", {
                "position": {"x": odom_x + random.gauss(0, 0.02), "y": odom_y + random.gauss(0, 0.02), "z": 0.0},
                "orientation": {"x": 0.0, "y": 0.0, "z": math.sin(odom_yaw / 2), "w": math.cos(odom_yaw / 2)},
                "yaw": odom_yaw,
                "covariance": [0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01],
            })

            # Mock global path (8 waypoints around circle)
            global_path = [
                {"x": 3.0 * math.cos(a), "y": 3.0 * math.sin(a), "yaw": a + math.pi / 2}
                for a in [i * math.pi / 4 for i in range(9)]
            ]
            self.on_telemetry("/rtabmap/global_path", {"poses": global_path})

            # Mock local path (next 3 steps ahead)
            local_path = [
                {"x": 3.0 * math.cos(t * 0.05 + i * 0.2), "y": 3.0 * math.sin(t * 0.05 + i * 0.2), "yaw": 0.0}
                for i in range(5)
            ]
            self.on_telemetry("/rtabmap/local_path", {"poses": local_path})

            # Mock goal reached
            self.on_telemetry("/rtabmap/goal_reached", {"value": False})

            # Mock GPS (UCSB area as placeholder)
            self.on_telemetry("/gps/fix", {
                "latitude": 34.4140 + random.gauss(0, 0.00001),
                "longitude": -119.8489 + random.gauss(0, 0.00001),
                "altitude": 15.0 + random.gauss(0, 0.1),
                "status": 0,
                "covariance_type": 2,
            })

            # Mock diagnostics (every ~2s to avoid spam)
            if int(t * 10) % 20 == 0:
                self.on_telemetry("/diagnostics", {
                    "status": [
                        {"level": 0, "name": "camera: RealSense D455", "message": "OK", "hardware_id": ""},
                        {"level": 0, "name": "imu: BNO085", "message": "OK", "hardware_id": ""},
                        {"level": 1 if random.random() < 0.1 else 0, "name": "battery: INA219",
                         "message": "Low voltage" if random.random() < 0.1 else "OK", "hardware_id": ""},
                        {"level": 0, "name": "rtabmap: SLAM", "message": "Localized", "hardware_id": ""},
                    ]
                })

            time.sleep(0.1)
