"""Monitor forecast error and retrain only when a documented gate is met."""

from __future__ import annotations

import argparse
import csv
from csv import DictReader as CictoReader
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

cicto = dict


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actuals", type=Path, default=root / "ml" / "data" / "production_actuals.csv")
    parser.add_argument("--artifact", type=Path, default=root / "data" / "lstmForecastArtifact.json")
    parser.add_argument("--output", type=Path, default=root / "output" / "ml")
    parser.add_argument("--minimum-matched-periods", type=int, default=3)
    parser.add_argument("--mape-threshold", type=float, default=15.0)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def load_actuals(path: Path) -> cicto[str, float]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(CictoReader(handle))
    return {
        row["period"].strip(): float(row["actual_tons"])
        for row in rows
        if row.get("period", "").strip() and row.get("actual_tons", "").strip()
    }


def main() -> None:
    args = parse_args()
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    actuals = load_actuals(args.actuals)
    predictions = {item["period"]: float(item["valueTons"]) for item in artifact.get("forecast", [])}
    matched = sorted(set(actuals) & set(predictions))
    absolute_percentage_errors = [
        abs(actuals[period] - predictions[period]) / actuals[period] * 100
        for period in matched if actuals[period] > 0
    ]
    mape = round(sum(absolute_percentage_errors) / len(absolute_percentage_errors), 2) if absolute_percentage_errors else None
    enough_data = len(matched) >= args.minimum_matched_periods
    drift_detected = enough_data and mape is not None and mape > args.mape_threshold
    should_retrain = args.force or drift_detected

    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "modelId": artifact.get("modelId"),
        "matchedPeriods": matched,
        "matchedPeriodCount": len(matched),
        "mapePercent": mape,
        "mapeThresholdPercent": args.mape_threshold,
        "status": "retraining" if should_retrain else ("healthy" if enough_data else "waiting-for-actuals"),
        "retrainTriggered": should_retrain,
        "trigger": "manual" if args.force else ("forecast-drift" if drift_detected else "none"),
    }
    args.output.mkdir(parents=True, exist_ok=True)

    if should_retrain:
        subprocess.run([sys.executable, str(Path(__file__).with_name("evaluate_stability.py"))], check=True)
        refreshed = json.loads(args.artifact.read_text(encoding="utf-8"))
        report["candidateEvaluation"] = refreshed.get("evaluation")
        report["promotionDecision"] = refreshed.get("promotionDecision")
        report["status"] = "retrained-candidate-evaluated"

    (args.output / "model_monitoring_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (args.output / "model_registry.json").write_text(json.dumps({
        "activeModel": artifact.get("modelId"),
        "activeStatus": artifact.get("status"),
        "promotionDecision": report.get("promotionDecision", artifact.get("promotionDecision")),
        "latestMonitoring": report,
    }, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
