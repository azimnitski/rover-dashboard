# Plan: Dockerize Rover Dashboard Backend

## Context
- ROS 2 runs in a separate container on the Orin Nano
- Image will be built directly on the Orin Nano (arm64 native)
- Backend needs rclpy to subscribe to ROS 2 topics
- Frontend is pre-built into `backend/static/` and served by FastAPI

## Files to create/modify

### 1. Create `Dockerfile` (multi-stage build)

**Stage 1 — frontend build:**
- Base: `node:20-slim`
- Copy `frontend/`, run `npm ci && npm run build`
- Output: built static files in `/app/backend/static/`

**Stage 2 — runtime:**
- Base: `ros:humble` (has rclpy + message types, supports arm64)
- Install Python deps from `requirements.txt` via pip
- Copy `backend/` source + built static files from stage 1
- Expose port 8765
- Healthcheck using `/api/health`
- Entrypoint: `python main.py`

### 2. Create `.dockerignore`
Exclude node_modules, .git, __pycache__, etc.

### 3. Create `docker-compose.yml`
- Define `dashboard` service building from this Dockerfile
- Connect it to an external network (shared with the ROS 2 container)
- Set `ROS_DOMAIN_ID` to match the ROS 2 container
- Expose port 8765

### 4. Modify `backend/main.py`
- Uncomment static file serving (line 61 area — currently there's no commented-out mount, so we add it)
- Add a guard for the static directory existing before mounting

### 5. Update `README.md`
- Add Docker build/run instructions

## Networking approach
Since ROS 2 runs in another container, both containers must share a Docker network for DDS discovery. The `docker-compose.yml` will reference an external network that the ROS 2 container is also attached to.

## Image size estimate
- `ros:humble` base: ~700MB
- Node build stage: discarded (multi-stage)
- Final image: ~750-800MB
