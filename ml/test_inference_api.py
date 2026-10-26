from __future__ import annotations

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from inference_api import ForecastHandler, ForecastRuntime


class ForecastApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        root = Path(__file__).resolve().parents[1]
        ForecastHandler.runtime = ForecastRuntime(
            root / "output" / "ml" / "danao_block_a_lstm.keras",
            root / "output" / "ml" / "scaler.json",
            root / "data" / "lstmForecastArtifact.json",
        )
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ForecastHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def test_health_and_forecast(self) -> None:
        with urllib.request.urlopen(f"{self.base_url}/health", timeout=15) as response:
            health = json.loads(response.read().decode("utf-8"))
        self.assertEqual(health["status"], "ready")
        payload = json.dumps({
            "historyTons": [122.23, 94.56, 97.89, 107.71, 96.50, 121.05, 115.59, 129.88, 130.04, 138.04, 123.23, 147.81],
            "horizonMonths": 3,
        }).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/forecast",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            forecast = json.loads(response.read().decode("utf-8"))
        self.assertEqual(forecast["horizonMonths"], 3)
        self.assertEqual(len(forecast["predictionsTons"]), 3)
        self.assertTrue(all(value >= 0 for value in forecast["predictionsTons"]))
        self.assertFalse(forecast["productionApproved"])


if __name__ == "__main__":
    unittest.main()
