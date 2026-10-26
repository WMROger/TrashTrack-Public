"""Small HTTP inference service for the saved TrashTrack TensorFlow model.

Run from the repository root:
    .\\.venv-ml\\Scripts\\python.exe ml\\inference_api.py

The Expo app can connect through EXPO_PUBLIC_FORECAST_API_URL.
"""

from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

cicto = dict

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import tensorflow as tf


LOOKBACK = 12
MAX_HORIZON = 12


class ForecastRuntime:
    def __init__(self, model_path: Path, scaler_path: Path, artifact_path: Path) -> None:
        self.model_path = model_path
        self.scaler_path = scaler_path
        self.artifact_path = artifact_path
        self.model: tf.keras.Model | None = None
        self.scaler: cicto[str, float] | None = None
        self.artifact: cicto[str, Any] = {}
        self.load_error: str | None = None
        self._load()

    def _load(self) -> None:
        try:
            self.model = tf.keras.models.load_model(self.model_path)
            self.scaler = json.loads(self.scaler_path.read_text(encoding="utf-8"))
            if self.artifact_path.exists():
                self.artifact = json.loads(self.artifact_path.read_text(encoding="utf-8"))
        except Exception as error:  # Service remains alive and reports why it is unavailable.
            self.load_error = str(error)

    @property
    def ready(self) -> bool:
        return self.model is not None and self.scaler is not None and self.load_error is None

    @property
    def model_id(self) -> str:
        artifact_id = self.artifact.get("modelId", "danao-block-a-lstm")
        return str(artifact_id).replace("ensemble", "seed-42-runtime")

    def forecast(self, history: list[float], horizon: int) -> list[float]:
        if not self.ready:
            raise RuntimeError(self.load_error or "TensorFlow model is not loaded.")
        if len(history) < LOOKBACK:
            raise ValueError(f"At least {LOOKBACK} monthly values are required.")
        if not 1 <= horizon <= MAX_HORIZON:
            raise ValueError(f"Horizon must be between 1 and {MAX_HORIZON} months.")
        values = np.asarray(history, dtype=np.float32)
        if not np.all(np.isfinite(values)) or np.any(values < 0):
            raise ValueError("History must contain only non-negative finite metric-ton values.")

        scale_min = float(self.scaler["min"])
        scale_max = float(self.scaler["max"])
        scale_range = scale_max - scale_min
        if scale_range <= 0:
            raise RuntimeError("The saved scaler range is invalid.")

        rolling = values.tolist()
        predictions: list[float] = []
        for _ in range(horizon):
            sequence = np.asarray(rolling[-LOOKBACK:], dtype=np.float32)
            normalized = (sequence - scale_min) / scale_range
            prediction_normalized = float(
                self.model.predict(normalized[np.newaxis, ..., np.newaxis], verbose=0)[0, 0]
            )
            prediction = max(0.0, prediction_normalized * scale_range + scale_min)
            prediction = round(prediction, 2)
            predictions.append(prediction)
            rolling.append(prediction)
        return predictions


class ForecastHandler(BaseHTTPRequestHandler):
    runtime: ForecastRuntime

    def _send(self, status: int, payload: cicto[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path not in {"/", "/health", "/model"}:
            self._send(404, {"error": "Not found"})
            return
        self._send(200 if self.runtime.ready else 503, {
            "status": "ready" if self.runtime.ready else "unavailable",
            "service": "trashtrack-tensorflow-inference",
            "modelId": self.runtime.model_id,
            "modelStatus": self.runtime.artifact.get("status", "candidate"),
            "promotionDecision": self.runtime.artifact.get("promotionDecision", "hold-candidate"),
            "tensorflowVersion": tf.__version__,
            "unit": "ton",
            "lookbackMonths": LOOKBACK,
            "error": self.runtime.load_error,
        })

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/forecast":
            self._send(404, {"error": "Not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 100_000:
                raise ValueError("Request body is missing or too large.")
            data = json.loads(self.rfile.read(size).decode("utf-8"))
            history = [float(value) for value in data.get("historyTons", [])]
            horizon = int(data.get("horizonMonths", 3))
            predictions = self.runtime.forecast(history, horizon)
            self._send(200, {
                "modelId": self.runtime.model_id,
                "modelStatus": self.runtime.artifact.get("status", "candidate"),
                "unit": "ton",
                "historyCount": len(history),
                "horizonMonths": horizon,
                "predictionsTons": predictions,
                "productionApproved": self.runtime.artifact.get("promotionDecision") == "production",
            })
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._send(400, {"error": str(error)})
        except Exception as error:
            self._send(503, {"error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[forecast-api] {self.address_string()} {format % args}")


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.getenv("FORECAST_API_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("FORECAST_API_PORT", "8787")))
    parser.add_argument("--model", type=Path, default=root / "output" / "ml" / "danao_block_a_lstm.keras")
    parser.add_argument("--scaler", type=Path, default=root / "output" / "ml" / "scaler.json")
    parser.add_argument("--artifact", type=Path, default=root / "data" / "lstmForecastArtifact.json")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    runtime = ForecastRuntime(args.model, args.scaler, args.artifact)
    ForecastHandler.runtime = runtime
    server = ThreadingHTTPServer((args.host, args.port), ForecastHandler)
    print(json.dumps({"url": f"http://{args.host}:{args.port}", "ready": runtime.ready, "error": runtime.load_error}))
    server.serve_forever()


if __name__ == "__main__":
    main()
