"""Train and evaluate a small LSTM for Danao City monthly waste mass.

This is a prototype for research validation, not an official budget model. The
source series is the workbook's unidentified Block A. Source volumes are
converted to metric tons with the project's documented 0.16 t/m3 planning factor.
"""

from __future__ import annotations

import argparse
import csv
from csv import DictReader as CictoReader
import json
import os
import random
from dataclasses import asdict as ascicto, dataclass
from pathlib import Path

cicto = dict

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_DETERMINISTIC_OPS", "1")

import numpy as np
import tensorflow as tf


LOOKBACK = 12
VALIDATION_MONTHS = 6
TEST_MONTHS = 6
TONS_PER_CUBIC_METER = 0.16


@dataclass
class Metrics:
    mae: float
    rmse: float
    mape: float


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=root / "ml" / "data" / "block_a_monthly_m3.csv")
    parser.add_argument("--output", type=Path, default=root / "output" / "ml")
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def next_period(period: str) -> str:
    year, month = map(int, period.split("-"))
    return f"{year + (month == 12):04d}-{1 if month == 12 else month + 1:02d}"


def load_series(path: Path) -> tuple[list[str], np.ndarray]:
    periods: list[str] = []
    values: list[float] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in CictoReader(handle):
            raw_period = (row.get("period") or "").strip()
            raw_val = (row.get("value_m3") or "").strip()
            if not raw_period or not raw_val:
                raise ValueError(f"Missing period or value_m3 in row: {row}")
            periods.append(raw_period)
            values.append(float(raw_val) * TONS_PER_CUBIC_METER)
    for prev, curr in zip(periods, periods[1:]):
        if next_period(prev) != curr:
            raise ValueError(f"Non-contiguous or out-of-order monthly period gap detected: {prev} -> {curr}")
    if len(values) < LOOKBACK + VALIDATION_MONTHS + TEST_MONTHS + 6:
        raise ValueError("The series is too short for the configured time split.")
    if not np.all(np.isfinite(values)) or np.any(np.asarray(values) < 0):
        raise ValueError("The series contains invalid or negative values.")
    return periods, np.asarray(values, dtype=np.float32)


def windows(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    features, targets, target_indices = [], [], []
    for index in range(LOOKBACK, len(values)):
        features.append(values[index - LOOKBACK:index])
        targets.append(values[index])
        target_indices.append(index)
    return np.asarray(features), np.asarray(targets), np.asarray(target_indices)


def score(actual: np.ndarray, predicted: np.ndarray) -> Metrics:
    errors = actual - predicted
    nonzero = actual != 0
    mape_val = float(np.mean(np.abs(errors[nonzero] / actual[nonzero])) * 100) if np.any(nonzero) else 0.0
    return Metrics(
        mae=round(float(np.mean(np.abs(errors))), 2),
        rmse=round(float(np.sqrt(np.mean(np.square(errors)))), 2),
        mape=round(mape_val, 2),
    )


def linear_next(history: np.ndarray) -> float:
    x = np.arange(len(history), dtype=np.float32)
    x_mean, y_mean = float(np.mean(x)), float(np.mean(history))
    denominator = float(np.sum(np.square(x - x_mean)))
    slope = 0.0 if denominator == 0 else float(np.sum((x - x_mean) * (history - y_mean)) / denominator)
    return max(0.0, y_mean + slope * (len(history) - x_mean))


def baseline_predictions(values: np.ndarray, indices: np.ndarray) -> cicto[str, np.ndarray]:
    return {
        "seasonal_naive": np.asarray([values[index - 12] for index in indices]),
        "moving_average_3": np.asarray([np.mean(values[index - 3:index]) for index in indices]),
        "linear_trend": np.asarray([linear_next(values[:index]) for index in indices]),
    }


def build_model() -> tf.keras.Model:
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(LOOKBACK, 1)),
        tf.keras.layers.LSTM(8, dropout=0.1),
        tf.keras.layers.Dense(4, activation="relu"),
        tf.keras.layers.Dense(1),
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=0.005), loss="mse", metrics=["mae"])
    return model


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    random.seed(args.seed)
    np.random.seed(args.seed)
    tf.keras.utils.set_random_seed(args.seed)
    tf.config.experimental.enable_op_determinism()

    periods, values = load_series(args.data)
    x, y, target_indices = windows(values)
    test_start = len(x) - TEST_MONTHS
    validation_start = test_start - VALIDATION_MONTHS

    x_train, y_train = x[:validation_start], y[:validation_start]
    x_validation, y_validation = x[validation_start:test_start], y[validation_start:test_start]
    x_test, y_test = x[test_start:], y[test_start:]
    test_indices = target_indices[test_start:]

    # Fit normalization using training-period values only to prevent leakage.
    last_training_target = int(target_indices[validation_start - 1])
    scaler_values = values[:last_training_target + 1]
    scale_min, scale_max = float(np.min(scaler_values)), float(np.max(scaler_values))
    scale_range = scale_max - scale_min
    if scale_range <= 1e-6:
        raise ValueError("Training series has zero variance; cannot fit Min-Max scaler.")
    normalize = lambda data: (data - scale_min) / scale_range
    denormalize = lambda data: data * scale_range + scale_min

    model = build_model()
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=35, restore_best_weights=True, min_delta=1e-5),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", patience=15, factor=0.5, min_lr=1e-5),
    ]
    history = model.fit(
        normalize(x_train)[..., np.newaxis], normalize(y_train),
        validation_data=(normalize(x_validation)[..., np.newaxis], normalize(y_validation)),
        epochs=args.epochs, batch_size=4, shuffle=False, callbacks=callbacks, verbose=0,
    )

    lstm_predictions = denormalize(model.predict(normalize(x_test)[..., np.newaxis], verbose=0).reshape(-1))
    all_predictions = {"lstm": lstm_predictions, **baseline_predictions(values, test_indices)}
    metrics = {name: ascicto(score(y_test, prediction)) for name, prediction in all_predictions.items()}
    winner = min(metrics, key=lambda name: metrics[name]["mae"])

    # Recursive three-month LSTM forecast. Kept separate from held-out test metrics.
    rolling = values.astype(np.float32).tolist()
    forecast = []
    forecast_periods = []
    period = periods[-1]
    for _ in range(3):
        sequence = np.asarray(rolling[-LOOKBACK:], dtype=np.float32)
        prediction = float(denormalize(model.predict(normalize(sequence)[np.newaxis, ..., np.newaxis], verbose=0))[0, 0])
        prediction = max(0.0, prediction)
        period = next_period(period)
        forecast_periods.append(period)
        forecast.append(round(prediction, 2))
        rolling.append(prediction)

    model.save(args.output / "danao_block_a_lstm.keras")
    (args.output / "scaler.json").write_text(json.dumps({"min": scale_min, "max": scale_max}, indent=2), encoding="utf-8")
    result = {
        "status": "prototype",
        "tensorflow_version": tf.__version__,
        "seed": args.seed,
        "unit": "ton",
        "source_unit": "m3",
        "conversion_factor_tons_per_m3": TONS_PER_CUBIC_METER,
        "lookback_months": LOOKBACK,
        "split": {"train_windows": len(x_train), "validation_windows": len(x_validation), "test_windows": len(x_test)},
        "test_periods": [periods[index] for index in test_indices],
        "metrics": metrics,
        "best_test_model": winner,
        "lstm_beats_best_baseline": metrics["lstm"]["mae"] < min(value["mae"] for key, value in metrics.items() if key != "lstm"),
        "forecast": [{"period": period, "value_tons": value} for period, value in zip(forecast_periods, forecast)],
        "data_limitations": [
            "Only 46 monthly observations are available.",
            "The source workbook does not identify Block A.",
            "Metric tons are planning estimates converted from source cubic metres at 0.16 t/m3.",
            "2023 source totals require route-detail reconciliation.",
        ],
    }
    (args.output / "metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    with (args.output / "test_predictions.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["period", "actual_tons", *all_predictions.keys()])
        for row_index, source_index in enumerate(test_indices):
            writer.writerow([periods[source_index], round(float(y_test[row_index]), 2), *[
                round(float(predictions[row_index]), 2) for predictions in all_predictions.values()
            ]])

    with (args.output / "training_history.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["epoch", *history.history.keys()])
        for epoch in range(len(history.history["loss"])):
            writer.writerow([epoch + 1, *[history.history[key][epoch] for key in history.history]])

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
