"""
rPPG FastAPI Server
====================
Production-grade REST + WebSocket server for the rPPG pipeline.

Features:
- WebSocket endpoint for real-time video frame processing
- REST endpoints for session management and health checks
- CORS support for frontend integration
- Session management with auto-cleanup
- Structured logging
"""

import asyncio
import base64
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from config import CONFIG
from models import (
    HealthCheckResponse,
    MeasurementResult,
    SessionInfo,
    SessionSummary,
    VitalSigns,
)
from rppg_engine import RPPGEngine

# ─── Logging ───────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(name)-20s │ %(levelname)-7s │ %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("rppg.server")


# ─── Session Manager ──────────────────────────────────────────────────
class SessionManager:
    """Manages active rPPG processing sessions."""

    def __init__(self):
        self.sessions: Dict[str, dict] = {}

    def create_session(self) -> str:
        if len(self.sessions) >= CONFIG.server.max_sessions:
            raise HTTPException(429, "Maximum concurrent sessions reached")

        session_id = str(uuid.uuid4())[:8]
        self.sessions[session_id] = {
            "engine": RPPGEngine(),
            "start_time": datetime.utcnow(),
            "frames": 0,
            "measurements": 0,
            "accepted": 0,
            "rejected": 0,
            "quality_dist": {},
            "vitals_sum": {"hr": [], "rr": []},
        }
        logger.info(f"Session created: {session_id}")
        return session_id

    def get_engine(self, session_id: str) -> RPPGEngine:
        session = self.sessions.get(session_id)
        if not session:
            raise HTTPException(404, f"Session {session_id} not found")
        return session["engine"]

    def update_stats(self, session_id: str, result: MeasurementResult):
        session = self.sessions.get(session_id)
        if not session:
            return

        session["frames"] += 1
        if result.vitals.heart_rate is not None:
            session["measurements"] += 1
            if result.quality.is_acceptable:
                session["accepted"] += 1
                session["vitals_sum"]["hr"].append(result.vitals.heart_rate)
                if result.vitals.respiratory_rate:
                    session["vitals_sum"]["rr"].append(result.vitals.respiratory_rate)
            else:
                session["rejected"] += 1

            level = result.quality.overall_level.value
            session["quality_dist"][level] = session["quality_dist"].get(level, 0) + 1

    def get_summary(self, session_id: str) -> SessionSummary:
        session = self.sessions.get(session_id)
        if not session:
            raise HTTPException(404, f"Session {session_id} not found")

        now = datetime.utcnow()
        duration = (now - session["start_time"]).total_seconds()

        avg_vitals = VitalSigns()
        hr_list = session["vitals_sum"]["hr"]
        rr_list = session["vitals_sum"]["rr"]
        if hr_list:
            avg_vitals.heart_rate = round(float(np.median(hr_list)), 1)
        if rr_list:
            avg_vitals.respiratory_rate = round(float(np.median(rr_list)), 1)

        total = session["accepted"] + session["rejected"]
        confidence = session["accepted"] / total if total > 0 else 0.0

        return SessionSummary(
            session_id=session_id,
            start_time=session["start_time"],
            end_time=now,
            duration_seconds=round(duration, 1),
            total_frames=session["frames"],
            total_measurements=session["measurements"],
            accepted_measurements=session["accepted"],
            rejected_measurements=session["rejected"],
            average_vitals=avg_vitals,
            quality_distribution=session["quality_dist"],
            confidence_score=round(confidence, 3),
            emr_ready=confidence >= 0.6 and session["accepted"] >= 10,
        )

    def destroy_session(self, session_id: str):
        if session_id in self.sessions:
            self.sessions[session_id]["engine"].reset()
            del self.sessions[session_id]
            logger.info(f"Session destroyed: {session_id}")


# ─── App Setup ─────────────────────────────────────────────────────────
session_manager = SessionManager()
start_time = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🫀 rPPG Server starting up...")
    logger.info(f"   Buffer size: {CONFIG.signal.buffer_size} frames")
    logger.info(f"   HR band: {CONFIG.filter.hr_low_freq}-{CONFIG.filter.hr_high_freq} Hz")
    logger.info(f"   RR band: {CONFIG.filter.rr_low_freq}-{CONFIG.filter.rr_high_freq} Hz")
    yield
    # Cleanup
    for sid in list(session_manager.sessions.keys()):
        session_manager.destroy_session(sid)
    logger.info("rPPG Server shut down")


from fastapi.middleware.gzip import GZipMiddleware

app = FastAPI(
    title="TelegarudaAI",
    description="Remote Photoplethysmography pipeline for contactless vital sign measurement",
    version="1.0.0",
    lifespan=lifespan,
)

# Optimization: Compress large JSON responses and static files
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Security: Rate limiting to prevent abuse (basic implementation)
from fastapi import Request
from starlette.responses import JSONResponse

REQUESTS_PER_MINUTE = 60
ip_requests = {}

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host
    current_time = time.time()
    
    # Simple cleanup (could be improved)
    if len(ip_requests) > 1000:
        ip_requests.clear()
        
    requests = ip_requests.get(client_ip, [])
    requests = [t for t in requests if current_time - t < 60]
    
    if len(requests) >= REQUESTS_PER_MINUTE:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please wait a minute."}
        )
    
    requests.append(current_time)
    ip_requests[client_ip] = requests
    
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CONFIG.server.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Security: Add security headers
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "connect-src 'self' ws: wss:; "
        "media-src 'self' blob:; "
        "font-src 'self';"
    )
    return response

# ─── Static File Serving ─────────────────────────────────────────────
# Priority: React production build (frontend-dist/)
import os

_root = os.path.dirname(os.path.dirname(__file__))
_react_dist = os.path.join(_root, "frontend-dist")

# Serve React build assets (JS, CSS chunks, images etc.)
if os.path.exists(_react_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_react_dist, "assets")), name="assets")
    # Public assets (logo, images)
    _asserts_in_dist = os.path.join(_react_dist, "asserts")
    if os.path.exists(_asserts_in_dist):
        app.mount("/asserts", StaticFiles(directory=_asserts_in_dist), name="asserts")


# ─── REST Endpoints ───────────────────────────────────────────────────
@app.api_route("/", response_class=FileResponse, methods=["GET", "HEAD"])
async def serve_frontend():
    """Serve the React frontend SPA."""
    react_index = os.path.join(_react_dist, "index.html")
    if os.path.exists(react_index):
        return FileResponse(react_index)
    return {"message": "rPPG API Server", "docs": "/docs"}


@app.api_route("/health", response_model=HealthCheckResponse, methods=["GET", "HEAD"])
async def health_check():
    """Server health check."""
    return HealthCheckResponse(
        status="healthy",
        version="1.0.0",
        uptime_seconds=round(time.time() - start_time, 1),
        active_sessions=len(session_manager.sessions),
    )


@app.post("/api/session/create")
async def create_session():
    """Create a new rPPG processing session."""
    session_id = session_manager.create_session()
    return {"session_id": session_id, "status": "created"}


@app.get("/api/session/{session_id}/summary", response_model=SessionSummary)
async def get_session_summary(session_id: str):
    """Get session summary (for EMR integration)."""
    return session_manager.get_summary(session_id)


@app.delete("/api/session/{session_id}")
async def end_session(session_id: str):
    """End and cleanup a session."""
    summary = session_manager.get_summary(session_id)
    session_manager.destroy_session(session_id)
    return {"status": "ended", "summary": summary.dict()}


@app.post("/api/session/{session_id}/reset")
async def reset_session(session_id: str):
    """Reset session buffers without destroying."""
    engine = session_manager.get_engine(session_id)
    engine.reset()
    return {"status": "reset", "session_id": session_id}


@app.api_route("/{full_path:path}", response_class=FileResponse, include_in_schema=False, methods=["GET", "HEAD"])
async def spa_fallback(full_path: str):
    """SPA catch-all: serve index.html for any unknown route (React Router support)."""
    # Skip API and WebSocket paths
    if full_path.startswith(("api/", "ws/", "health", "docs", "openapi")):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(404)
    react_index = os.path.join(_react_dist, "index.html")
    if os.path.exists(react_index):
        return FileResponse(react_index)
    from fastapi import HTTPException as _HTTPException
    raise _HTTPException(404)


# ─── Security Constants ──────────────────────────────────────────────
import re

MAX_FRAME_SIZE = 5 * 1024 * 1024  # 5 MB max frame payload
MAX_MESSAGE_SIZE = 6 * 1024 * 1024  # 6 MB max WS message
SESSION_ID_PATTERN = re.compile(r"^[a-zA-Z0-9\-]{1,64}$")
VALID_COMMANDS = {"reset", "calibrate", "stats"}
MAX_FRAME_DIMENSIONS = (1920, 1080)


def _sanitize_error(msg: str) -> str:
    """Strip internal paths and sensitive info from error messages."""
    # Remove file paths
    sanitized = re.sub(r"(/[a-zA-Z0-9_\-./]+)", "[path]", msg)
    # Remove anything that looks like a stack trace line
    sanitized = re.sub(r"File \".*?\".*?line \d+", "[internal]", sanitized)
    # Truncate
    return sanitized[:200]


def _validate_session_id(session_id: str) -> bool:
    """Validate session ID format to prevent injection attacks."""
    return bool(SESSION_ID_PATTERN.match(session_id))


# ─── WebSocket Endpoint ──────────────────────────────────────────────
@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time video frame processing.

    Security:
    - Session ID validation (alphanumeric + hyphens only)
    - Frame size limits (5 MB max)
    - Frame dimension validation (max 1920x1080)
    - Sanitized error responses (no internal details leaked)
    - Auto-cleanup on disconnect

    Protocol:
    - Client sends base64-encoded JPEG frames in JSON: {"frame": "data:image/jpeg;base64,..."}
    - Server responds with JSON MeasurementResult
    """
    # Security: Validate session ID format
    if not _validate_session_id(session_id):
        await websocket.close(code=4001, reason="Invalid session ID format")
        logger.warning(f"Rejected WebSocket with invalid session ID: {session_id[:32]}")
        return

    await websocket.accept()
    logger.info(f"WebSocket connected: {session_id}")

    # Get or create session
    actual_session_id = session_id
    if session_id not in session_manager.sessions:
        try:
            actual_session_id = session_manager.create_session()
        except HTTPException:
            await websocket.close(code=4029, reason="Maximum sessions reached")
            return
        engine = session_manager.get_engine(actual_session_id)
    else:
        engine = session_manager.get_engine(session_id)

    try:
        while True:
            # Receive frame data
            data = await websocket.receive_text()

            # Security: reject oversized messages
            if len(data) > MAX_MESSAGE_SIZE:
                await websocket.send_json({
                    "type": "error",
                    "message": "Message too large"
                })
                continue

            try:
                message = json.loads(data)

                # Security: validate message structure
                if not isinstance(message, dict):
                    continue

                frame_data = message.get("frame", "")
                command = message.get("command", "")

                # Handle commands (whitelist only)
                if command:
                    if command not in VALID_COMMANDS:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Unknown command: {command}"
                        })
                        continue

                    if command == "reset":
                        engine.reset()
                        await websocket.send_json({
                            "type": "command_response",
                            "command": "reset",
                            "status": "ok"
                        })
                        continue

                    if command == "calibrate":
                        calib_data = message.get("data", {})
                        # Security: validate calibration data types
                        if isinstance(calib_data, dict) and hasattr(engine, 'set_calibration'):
                            engine.set_calibration(calib_data)
                        await websocket.send_json({
                            "type": "command_response",
                            "command": "calibrate",
                            "status": "ok"
                        })
                        continue

                    if command == "stats":
                        stats = engine.get_session_stats()
                        await websocket.send_json({
                            "type": "stats",
                            "data": stats
                        })
                        continue

                if not frame_data:
                    continue

                # Security: validate frame size before decoding
                if len(frame_data) > MAX_FRAME_SIZE:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Frame too large"
                    })
                    continue

                # Decode base64 JPEG frame
                if "," in frame_data:
                    frame_data = frame_data.split(",")[1]

                img_bytes = base64.b64decode(frame_data)
                nparr = np.frombuffer(img_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if frame is None:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid frame data"
                    })
                    continue

                # Security: validate frame dimensions
                h, w = frame.shape[:2]
                if w > MAX_FRAME_DIMENSIONS[0] or h > MAX_FRAME_DIMENSIONS[1]:
                    # Resize instead of rejecting for better UX
                    scale = min(MAX_FRAME_DIMENSIONS[0] / w, MAX_FRAME_DIMENSIONS[1] / h)
                    frame = cv2.resize(frame, (int(w * scale), int(h * scale)))

                # Process through rPPG pipeline
                result = engine.process_frame(frame)

                # Update session stats
                session_manager.update_stats(actual_session_id, result)

                # Build response — convert numpy types to native Python
                raw_signal = result.raw_signal[-100:] if result.raw_signal else []
                spectrum = result.spectrum[:100] if result.spectrum else []
                spectrum_freqs = result.spectrum_freqs[:100] if result.spectrum_freqs else []

                response = {
                    "type": "measurement",
                    "data": {
                        "timestamp": result.timestamp.isoformat(),
                        "face_detected": result.face_detected,
                        "face_rect": list(result.face_rect) if result.face_rect else None,
                        "estimated_age": result.estimated_age,
                        "estimated_gender": result.estimated_gender,
                        "estimated_sentiment": result.estimated_sentiment,
                        "buffer_fill": round(result.buffer_fill, 1),
                        "fps_actual": result.fps_actual,
                        "message": result.message,
                        "vitals": {
                            **result.vitals.dict(),
                            "heart_rate": result.vitals.heart_rate,
                            "respiratory_rate": result.vitals.respiratory_rate,
                        },
                        "quality": {
                            "snr_db": round(result.quality.snr_db, 2),
                            "spectral_purity": round(result.quality.spectral_purity, 3),
                            "motion_score": round(result.quality.motion_score, 2),
                            "face_confidence": round(result.quality.face_confidence, 3),
                            "level": result.quality.overall_level.value,
                            "acceptable": result.quality.is_acceptable,
                        },
                        "signal": [round(float(v), 4) for v in raw_signal],
                        "spectrum": [round(float(v), 4) for v in spectrum],
                        "spectrum_freqs": [round(float(v), 4) for v in spectrum_freqs],
                    }
                }

                await websocket.send_json(response)

            except json.JSONDecodeError:
                # Handle raw base64 frame (no JSON wrapper)
                try:
                    if len(data) > MAX_FRAME_SIZE:
                        continue
                    if "," in data:
                        data = data.split(",")[1]
                    img_bytes = base64.b64decode(data)
                    nparr = np.frombuffer(img_bytes, np.uint8)
                    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if frame is not None:
                        result = engine.process_frame(frame)
                        session_manager.update_stats(actual_session_id, result)
                        await websocket.send_json({
                            "type": "measurement",
                            "data": result.dict(exclude={"raw_signal", "spectrum", "spectrum_freqs"})
                        })
                except Exception as e:
                    await websocket.send_json({
                        "type": "error",
                        "message": _sanitize_error(str(e))
                    })

            except Exception as e:
                logger.error(f"Frame processing error: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": _sanitize_error(str(e))
                })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Auto-cleanup session on disconnect
        logger.info(f"Cleaning up session {actual_session_id}")
        session_manager.destroy_session(actual_session_id)


# ─── Entry Point ──────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=CONFIG.server.host,
        port=CONFIG.server.port,
        reload=False,
        log_level="info",
        ws_ping_interval=CONFIG.server.ws_heartbeat_interval,
        ws_ping_timeout=60.0,
    )
