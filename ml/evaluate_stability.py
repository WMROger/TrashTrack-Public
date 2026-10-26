"""Run multiple LSTM seeds and evaluate the ensemble against fixed baselines."""

from __future__ import annotations

import argparse
import csv
from csv import DictReader as CictoReader
import json
import subprocess
from datetime import date
from pathlib import Path

import numpy as np

cicto = dict


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", default="7,21,42,84,168")
    parser.add_argument("--output", type=Path, default=root / "output" / "ml")
    parser.add_argument("--app-artifact", type=Path, default=root / "data" / "lstmForecastArtifact.json")
    return parser.parse_args()


def score(actual: np.ndarray, predicted: np.ndarray) -> cicto[str, float]:
    errors = actual - predicted
    return {
        "mae": round(float(np.mean(np.abs(errors))), 2),
        "rmse": round(float(np.sqrt(np.mean(np.square(errors)))), 2),
        "mape": round(float(np.mean(np.abs(errors / actual))) * 100, 2),
    }


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parents[1]
    seeds = [int(seed.strip()) for seed in args.seeds.split(",")]
    run_results = []
    prediction_sets = []
    forecast_sets = []
    actual = None
    baseline_metrics = None

    for seed in seeds:
        run_dir = args.output / "stability" / f"seed-{seed}"
        subprocess.run([
            str(Path(__import__("sys").executable)), str(root / "ml" / "train_lstm.py"),
            "--seed", str(seed), "--output", str(run_dir),
        ], check=True, capture_output=True, text=True)
        metrics = json.loads((run_dir / "metrics.json").read_text(encoding="utf-8"))
        run_results.append({"seed": seed, "lstm": metrics["metrics"]["lstm"]})
        baseline_metrics = {key: value for key, value in metrics["metrics"].items() if key != "lstm"}
        forecast_sets.append([item["value_tons"] for item in metrics["forecast"]])

        with (run_dir / "test_predictions.csv").open(newline="", encoding="utf-8") as handle:
            rows = list(CictoReader(handle))
        actual = np.asarray([float(row["actual_tons"]) for row in rows])
        prediction_sets.append([float(row["lstm"]) for row in rows])

    lstm_maes = np.asarray([run["lstm"]["mae"] for run in run_results])
    ensemble_predictions = np.mean(np.asarray(prediction_sets), axis=0)
    ensemble_metrics = score(actual, ensemble_predictions)
    best_baseline_name = min(baseline_metrics, key=lambda name: baseline_metrics[name]["mae"])
    best_baseline_mae = baseline_metrics[best_baseline_name]["mae"]
    relative_improvement = (best_baseline_mae - ensemble_metrics["mae"]) / best_baseline_mae * 100
    wins = int(np.sum(lstm_maes < best_baseline_mae))
    deployable = relative_improvement >= 5 and wins >= max(1, len(seeds) - 1)

    report = {
        "status": "prototype",
        "unit": "ton",
        "seeds": seeds,
        "runs": run_results,
        "lstm_mae_mean": round(float(np.mean(lstm_maes)), 2),
        "lstm_mae_stddev": round(float(np.std(lstm_maes)), 2),
        "ensemble_metrics": ensemble_metrics,
        "baseline_metrics": baseline_metrics,
        "best_baseline": best_baseline_name,
        "relative_mae_improvement_percent": round(float(relative_improvement), 2),
        "individual_seed_wins": f"{wins}/{len(seeds)}",
        "deployment_gate": {
            "passed": deployable,
            "criteria": "Ensemble MAE improves at least 5% and at least four of five seeds beat the best baseline.",
        },
        "ensemble_forecast": np.round(np.mean(np.asarray(forecast_sets), axis=0), 2).tolist(),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "stability_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    app_artifact = {
        "modelId": "danao-block-a-lstm-ensemble-v1",
        "modelLabel": "TensorFlow LSTM candidate",
        "status": "candidate",
        "unit": "ton",
        "evaluatedOn": date.today().isoformat(),
        "tensorflowVersion": metrics["tensorflow_version"],
        "dataset": {
            "observations": 46,
            "source": "Danao City historical workbook, unidentified Block A",
            "sourceUnit": "m3",
            "conversionFactorTonsPerM3": 0.16,
        },
        "evaluation": {
            "ensemble": ensemble_metrics,
            "bestBaseline": best_baseline_name,
            "bestBaselineMetrics": baseline_metrics[best_baseline_name],
            "relativeMaeImprovementPercent": round(float(relative_improvement), 2),
            "individualSeedWins": f"{wins}/{len(seeds)}",
            "stabilityGatePassed": deployable,
        },
        "forecast": [
            {"period": item["period"], "valueTons": value}
            for item, value in zip(
                metrics["forecast"],
                np.round(np.mean(np.asarray(forecast_sets), axis=0), 2).tolist(),
            )
        ],
        "promotionDecision": "production" if deployable else "hold-candidate",
        "limitations": [
            "The stability gate must pass before the LSTM replaces the production baseline.",
            "Only 46 monthly observations from one unidentified workbook block are available.",
            "Metric tons are planning estimates converted from source m3 at 0.16 t/m3.",
        ],
    }
    args.app_artifact.parent.mkdir(parents=True, exist_ok=True)
    args.app_artifact.write_text(json.dumps(app_artifact, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
