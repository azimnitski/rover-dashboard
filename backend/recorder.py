"""
Telemetry Recorder (Phase 4)
==============================
Records telemetry data to SQLite for historical queries.

Future features:
- Circular buffer: auto-delete data older than N hours
- "Last 5 minutes" query endpoint
- Export to CSV/ROS bag
- Configurable recording filters (which topics, sample rate)
"""

import sqlite3
import json
import time
import threading
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("recorder")

DB_PATH = Path("~/.rover-dashboard/telemetry.db").expanduser()


class TelemetryRecorder:
    """
    Writes telemetry snapshots to SQLite.

    Usage:
        recorder = TelemetryRecorder()
        recorder.start()

        # Called from the ROS bridge callback chain:
        recorder.record("/imu/data", {"orientation": {...}, ...})

        # Query:
        rows = recorder.query_last_minutes("/imu/data", minutes=5)
    """

    def __init__(self, db_path: Path = DB_PATH, max_hours: int = 24):
        self.db_path = db_path
        self.max_hours = max_hours
        self._conn: Optional[sqlite3.Connection] = None

    def start(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                topic TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """)
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_topic_ts ON telemetry(topic, timestamp)"
        )
        self._conn.commit()
        logger.info(f"Telemetry recorder started: {self.db_path}")

    def stop(self):
        if self._conn:
            self._conn.close()

    def record(self, topic: str, data: dict):
        if not self._conn:
            return
        self._conn.execute(
            "INSERT INTO telemetry (timestamp, topic, data) VALUES (?, ?, ?)",
            (time.time(), topic, json.dumps(data)),
        )
        self._conn.commit()

    def query_last_minutes(self, topic: str, minutes: int = 5) -> list:
        if not self._conn:
            return []
        cutoff = time.time() - (minutes * 60)
        cursor = self._conn.execute(
            "SELECT timestamp, data FROM telemetry WHERE topic = ? AND timestamp > ? ORDER BY timestamp",
            (topic, cutoff),
        )
        return [
            {"timestamp": row[0], "data": json.loads(row[1])}
            for row in cursor.fetchall()
        ]

    def cleanup_old(self):
        """Remove data older than max_hours."""
        if not self._conn:
            return
        cutoff = time.time() - (self.max_hours * 3600)
        self._conn.execute("DELETE FROM telemetry WHERE timestamp < ?", (cutoff,))
        self._conn.commit()
