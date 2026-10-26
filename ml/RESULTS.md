# TensorFlow Prototype Results

Evaluation date: 2026-08-10  
TensorFlow: 2.21.0, native Windows CPU  
Dataset: 46 monthly Block A observations converted to estimated metric tons at 0.16 t/m³  
Lookback: 12 months

## Chronological split

- Training: 22 supervised windows
- Validation: 6 supervised windows
- Test: 6 supervised windows (`2025-05` through `2025-10`)
- Normalization was fitted on the training period only.
- Early stopping used validation loss; test values were not used for training or early stopping.

## Held-out test comparison

| Model | MAE (t) | RMSE (t) | MAPE |
|---|---:|---:|---:|
| Five-seed LSTM ensemble | 18.61 | 24.21 | 10.01% |
| Seasonal naive | 19.70 | 25.89 | 10.49% |
| Three-month moving average | 24.38 | 29.34 | 12.81% |
| Linear trend | 35.62 | 42.12 | 19.05% |

Individual results and the ensemble are evaluated in metric tons. Only two of five individual seeds beat the seasonal-naive baseline.

The ensemble improved MAE by 5.53%, but the stability gate required at least four of five seeds to beat the best baseline. The gate did not pass, so the mobile dashboard remains on the validated statistical baseline.

## Prototype ensemble forecast

| Period | Forecast (t) |
|---|---:|
| 2025-11 | 211.48 |
| 2025-12 | 211.61 |
| 2026-01 | 212.06 |

These values are experimental planning estimates, not official budget forecasts.

## Required before deployment

- Resolve the identities of workbook Blocks A and B and reconcile 2023 route details.
- Collect at least 24 additional consecutive monthly observations, ideally route-level daily or weekly measurements.
- Repeat rolling-origin evaluation and compare confidence intervals, not only one six-month holdout.
- Validate operational usefulness with CENRO and define an acceptable error threshold.
- Promote a versioned model through a server-side inference endpoint; do not bundle model training or privileged credentials into the mobile client.
