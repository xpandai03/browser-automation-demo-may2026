"""
Demo dashboard API: spawn Node demo.js with status file, poll status JSON.

Run API server, open http://localhost:8080/demo (port from PORT or default).
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/demo", tags=["demo"])

REPO_ROOT = Path(__file__).resolve().parents[3]
DEMO_JS = REPO_ROOT / "demo.js"
RUN_ID_RE = re.compile(r"^[a-f0-9]{16}$")


def _status_path(run_id: str) -> Path:
    return Path(tempfile.gettempdir()) / f"run-{run_id}.json"


def _initial_status_payload(run_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "run_id": run_id,
        "state": "starting",
        "started_at": now,
        "current_section": "Initializing",
        "sections_completed": 0,
        "sections_total": 8,
        "fields_filled": 0,
        "fields_total": 29,
        "latest_log": "Spawning intake agent process…",
        "screenshot_path": None,
        "result": None,
    }


@router.post("/run-intake")
async def run_intake_demo():
    """Start demo.js with --status-file and --run-id; returns run_id for polling."""
    import secrets

    if not DEMO_JS.is_file():
        raise HTTPException(
            status_code=500,
            detail=f"demo.js not found at {DEMO_JS}",
        )
    node = shutil.which("node")
    if not node:
        raise HTTPException(
            status_code=500,
            detail="Node.js executable not found on PATH",
        )

    run_id = secrets.token_hex(8)
    status_file = _status_path(run_id)

    try:
        status_file.write_text(
            json.dumps(_initial_status_payload(run_id), indent=2),
            encoding="utf-8",
        )
    except OSError as e:
        logger.exception("Failed to write initial status file")
        raise HTTPException(status_code=500, detail=f"Cannot write status file: {e}") from e

    cmd = [
        node,
        str(DEMO_JS),
        "--status-file",
        str(status_file),
        "--run-id",
        run_id,
    ]
    try:
        subprocess.Popen(
            cmd,
            cwd=str(REPO_ROOT),
            start_new_session=True,
            stdout=None,
            stderr=None,
        )
    except OSError as e:
        logger.exception("Failed to spawn demo.js")
        raise HTTPException(status_code=500, detail=f"Spawn failed: {e}") from e

    logger.info("Started intake demo run_id=%s", run_id)
    return {"run_id": run_id}


@router.get("/status/{run_id}")
async def get_intake_demo_status(run_id: str):
    """Return JSON status for a demo run; starting if file not yet present."""
    if not RUN_ID_RE.match(run_id):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    path = _status_path(run_id)
    if not path.is_file():
        return {"state": "starting"}
    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
        if isinstance(data, dict):
            return data
        return {"state": "error", "error": "Status file was not a JSON object"}
    except json.JSONDecodeError:
        return {"state": "error", "error": "Invalid JSON in status file"}
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
