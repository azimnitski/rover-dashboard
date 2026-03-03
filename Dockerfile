# ===========================================================================
# Stage 1 — Build frontend
# ===========================================================================
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output lands in /app/backend/static (per vite.config.ts)

# ===========================================================================
# Stage 2 — Runtime (ROS 2 Humble + FastAPI)
# ===========================================================================
FROM ros:humble

# Avoid interactive prompts during package install
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3-pip \
        ros-humble-realsense2-camera-msgs \
        ros-humble-cv-bridge \
        python3-opencv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# Copy built frontend from stage 1
COPY --from=frontend-build /app/backend/static ./static

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/api/health')" || exit 1

# Source ROS 2 setup and run
CMD ["bash", "-c", "source /opt/ros/humble/setup.bash && python3 main.py"]
