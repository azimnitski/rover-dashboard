# Rover Dashboard

Real-time telemetry dashboard for an ESP32 + NVIDIA Orin Nano rover running ROS 2 Humble.

## Architecture

```
ESP32 (micro-ROS) ──┐
                     ├── ROS 2 Topics ──▶ FastAPI Backend ──▶ WebSocket ──▶ React Dashboard
D455 Camera ─────────┘                    (on Orin Nano)       (WiFi)       (in browser)
```

**Backend** (Python/FastAPI): Subscribes to ROS 2 topics via `rclpy`, throttles high-frequency data, and streams JSON over WebSocket to connected browsers.

**Frontend** (React/TypeScript): Displays live telemetry panels for battery, motors, IMU, velocity commands, and a topic explorer showing all active ROS 2 topics.

## Quick Start

### 1. Backend (on Orin Nano)

```bash
# Source ROS 2
source /opt/ros/humble/setup.bash

# Install Python deps
cd backend
pip install -r requirements.txt

# Run (real ROS mode)
python main.py

# Run (mock mode for development without ROS)
ROVER_MOCK_ROS=1 python main.py
```

The backend starts on `http://0.0.0.0:8765`.

### 2. Frontend (development)

```bash
cd frontend
npm install
npm run dev
```

Opens on `http://localhost:3000`. Vite proxies `/ws` and `/api` to the backend.

### 3. Frontend (production build)

```bash
cd frontend
npm run build
```

This builds into `backend/static/`. Then just run the backend — it serves both the API and the frontend automatically.

## Docker (production on Orin Nano)

```bash
# Create the shared network (once, if not already created)
docker network create ros_net

# Build and run
docker compose up -d

# Or build manually
docker build -t rover-dashboard .
docker run --rm -p 8765:8765 --network ros_net rover-dashboard
```

Set `ROS_DOMAIN_ID` to match your ROS 2 container:

```bash
ROS_DOMAIN_ID=1 docker compose up -d
```

The dashboard container and your ROS 2 container must share the `ros_net` network for DDS topic discovery.

## Development Without ROS

Set `ROVER_MOCK_ROS=1` to run the backend with simulated telemetry:

```bash
cd backend
ROVER_MOCK_ROS=1 python main.py
```

This generates fake IMU, battery, motor, and velocity data so you can develop the UI without the actual robot.

## Topics Monitored

| Topic | Type | Source | Throttle |
|-------|------|--------|----------|
| `/imu/data` | sensor_msgs/Imu | ESP32 | 10 Hz |
| `/battery/voltage` | std_msgs/Float32 | ESP32 | 1 Hz |
| `/motors/status` | std_msgs/Float32MultiArray | ESP32 | 5 Hz |
| `/motors/current` | std_msgs/Float32MultiArray | ESP32 | 5 Hz |
| `/cmd_vel` | geometry_msgs/Twist | Orin Nano | 10 Hz |

### Adding New Topics

Edit `TOPIC_CONFIG` in `backend/ros_bridge.py`:

```python
TOPIC_CONFIG = [
    ...
    {
        "topic": "/your/new/topic",
        "type": "std_msgs/msg/Float32",
        "throttle_hz": 5,
    },
]
```

Add a parser in `PARSERS` if the message type isn't already supported, then create a new React panel component.

## Phases

- [x] **Phase 1**: Live telemetry (IMU, battery, motors, cmd_vel)
- [ ] **Phase 2**: Camera streaming (D455 color + depth)
- [ ] **Phase 3**: SLAM map visualization (Three.js)
- [ ] **Phase 4**: Telemetry recording + historical playback
- [ ] **Phase 5**: Robot control (cmd_vel, motor commands from UI)

## Tech Stack

- **Backend**: Python, FastAPI, rclpy, uvicorn
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Recharts
- **Transport**: WebSocket (JSON for telemetry, binary for camera frames)
- **Future DB**: SQLite → TimescaleDB for time-series recording
