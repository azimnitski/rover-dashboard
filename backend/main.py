"""
Rover Dashboard Backend
=======================
FastAPI server that bridges ROS 2 topics to WebSocket clients.
Runs on the Orin Nano alongside the ROS 2 stack.

Usage:
    python main.py
    # or
    uvicorn main:app --host 0.0.0.0 --port 8765
"""

import asyncio
import json
import os
import time
import logging
from contextlib import asynccontextmanager
from typing import Dict, Set, Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from ros_bridge import RosBridge
from camera_stream import CameraStreamer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rover-dashboard")

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
ros_bridge: RosBridge | None = None
camera_streamer: CameraStreamer | None = None
connected_clients: Set[WebSocket] = set()

# Store latest values for each topic so new clients get immediate data
latest_telemetry: Dict[str, dict] = {}
latest_frames: Dict[str, bytes] = {}  # camera_id → full binary frame (header + payload)

# Single-worker broadcast queue — serialises all sends so two coroutines
# never call send_bytes/send_text on the same WebSocket concurrently.
_broadcast_queue: asyncio.Queue = None  # type: ignore[assignment]


async def _broadcast_worker():
    while True:
        kind, data = await _broadcast_queue.get()
        try:
            if kind == "text":
                await _broadcast_json(data)
            else:
                await _broadcast_binary(data)
        except Exception as exc:
            logger.error("[broadcast_worker] %s", exc)
        finally:
            _broadcast_queue.task_done()


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global ros_bridge, camera_streamer, loop, _broadcast_queue
    loop = asyncio.get_running_loop()

    _broadcast_queue = asyncio.Queue()
    asyncio.create_task(_broadcast_worker())

    logger.info("Starting ROS 2 bridge...")
    ros_bridge = RosBridge(on_telemetry=broadcast_telemetry, on_frame=broadcast_camera_frame)
    ros_bridge.start()

    camera_streamer = CameraStreamer(on_frame=broadcast_camera_frame)
    camera_streamer.start()

    logger.info("Rover Dashboard backend ready")
    yield

    logger.info("Shutting down...")
    if ros_bridge:
        ros_bridge.stop()
    if camera_streamer:
        camera_streamer.stop()


app = FastAPI(title="Rover Dashboard", lifespan=lifespan)

# Allow React dev server to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Broadcasting helpers
# ---------------------------------------------------------------------------
def broadcast_telemetry(topic: str, data: dict):
    """Called from ROS bridge thread when new telemetry arrives."""
    message = {
        "type": "telemetry",
        "topic": topic,
        "data": data,
        "timestamp": time.time(),
    }
    latest_telemetry[topic] = message
    if _broadcast_queue is not None:
        loop.call_soon_threadsafe(_broadcast_queue.put_nowait, ("text", message))


def broadcast_camera_frame(camera_id: str, jpeg_bytes: bytes):
    """Called from camera streamer when a new frame is ready."""
    # Send binary with a small header: first 64 bytes = camera_id padded
    header = camera_id.encode().ljust(64, b"\x00")
    frame = header + jpeg_bytes
    latest_frames[camera_id] = frame  # cache for new clients
    if _broadcast_queue is not None:
        loop.call_soon_threadsafe(_broadcast_queue.put_nowait, ("binary", frame))


async def _broadcast_json(message: dict):
    text = json.dumps(message)
    dead = set()
    for ws in list(connected_clients):  # snapshot — set can change at every await
        try:
            await ws.send_text(text)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


async def _broadcast_binary(data: bytes):
    dead = set()
    for ws in list(connected_clients):  # snapshot — set can change at every await
        try:
            await ws.send_bytes(data)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------
@app.get("/api/topics")
async def list_topics():
    """List all discovered ROS 2 topics and their types."""
    if ros_bridge:
        return {"topics": ros_bridge.get_topics()}
    return {"topics": []}


@app.get("/api/health")
async def health():
    """Basic health check."""
    return {
        "status": "ok",
        "clients": len(connected_clients),
        "ros_connected": ros_bridge is not None and ros_bridge.is_alive(),
        "topics_active": list(latest_telemetry.keys()),
        "cached_frames": {k: len(v) for k, v in latest_frames.items()},
    }


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    # Send snapshot BEFORE joining connected_clients — prevents a concurrent
    # _broadcast_binary from racing with this burst on the same WebSocket.
    for topic, message in list(latest_telemetry.items()):
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            pass

    for frame in list(latest_frames.values()):
        try:
            await ws.send_bytes(frame)
        except Exception:
            pass

    connected_clients.add(ws)
    logger.info(f"Client connected ({len(connected_clients)} total)")

    try:
        while True:
            # Listen for client messages (future: commands, topic subscriptions)
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                await handle_client_message(ws, msg)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        connected_clients.discard(ws)
        logger.info(f"Client disconnected ({len(connected_clients)} total)")


async def handle_client_message(ws: WebSocket, msg: dict):
    """Handle messages from the browser client."""
    msg_type = msg.get("type")

    if msg_type == "ping":
        await ws.send_text(json.dumps({"type": "pong", "timestamp": time.time()}))

    # Future: subscribe/unsubscribe to specific topics
    # Future: send cmd_vel or motor commands
    elif msg_type == "command":
        logger.info(f"Received command: {msg}")
        # ros_bridge.publish(msg["topic"], msg["data"])


# ---------------------------------------------------------------------------
# Static file serving (production builds land in ./static)
# ---------------------------------------------------------------------------
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    loop = asyncio.new_event_loop()

    config = uvicorn.Config(
        app=app,
        host="0.0.0.0",
        port=8765,
        loop="asyncio",
        log_level="info",
    )
    server = uvicorn.Server(config)

    loop.run_until_complete(server.serve())
else:
    # When run via `uvicorn main:app`, grab the running loop lazily
    loop = None

    @app.on_event("startup")
    async def _grab_loop():
        global loop
        loop = asyncio.get_running_loop()
