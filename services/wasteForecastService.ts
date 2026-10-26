export type ForecastModel = 'seasonal-naive' | 'linear-trend' | 'moving-average';

export type ForecastResult = {
  model: ForecastModel;
  modelLabel: string;
  forecast: number[];
  mae: number;
  rmse: number;
  mape: number;
  validationPoints: number;
};

type Candidate = {
  model: ForecastModel;
  label: string;
  predict: (history: number[], step: number) => number;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const linearPrediction = (history: number[], step: number) => {
  if (history.length < 2) return history[history.length - 1] || 0;
  const xMean = (history.length - 1) / 2;
  const yMean = mean(history);
  let numerator = 0;
  let denominator = 0;
  history.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += Math.pow(index - xMean, 2);
  });
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return Math.max(0, yMean + slope * (history.length + step - xMean));
};

const candidates: Candidate[] = [
  {
    model: 'seasonal-naive',
    label: '12-month seasonal baseline',
    predict: (history, step) => history.length >= 12
      ? history[history.length - 12 + (step % 12)]
      : history[history.length - 1] || 0,
  },
  {
    model: 'linear-trend',
    label: 'Linear trend baseline',
    predict: linearPrediction,
  },
  {
    model: 'moving-average',
    label: '3-month moving average baseline',
    predict: history => mean(history.slice(-3)),
  },
];

const round = (value: number) => Math.round(value * 100) / 100;

export function buildValidatedForecast(values: number[], horizon = 3): ForecastResult {
  const clean = values.filter(value => Number.isFinite(value) && value >= 0);
  if (clean.length < 6) throw new Error('At least six valid periods are required for forecasting.');

  const validationPoints = Math.min(12, Math.max(3, Math.floor(clean.length * 0.25)));
  const validationStart = clean.length - validationPoints;

  const scored = candidates.map(candidate => {
    const errors: number[] = [];
    const percentageErrors: number[] = [];
    for (let index = validationStart; index < clean.length; index += 1) {
      const history = clean.slice(0, index);
      const predicted = candidate.predict(history, 0);
      const error = clean[index] - predicted;
      errors.push(error);
      if (clean[index] !== 0) percentageErrors.push(Math.abs(error / clean[index]) * 100);
    }
    return {
      ...candidate,
      mae: mean(errors.map(Math.abs)),
      rmse: Math.sqrt(mean(errors.map(error => error * error))),
      mape: mean(percentageErrors),
    };
  }).sort((a, b) => a.mae - b.mae);

  const best = scored[0];
  const rolling = [...clean];
  const forecast: number[] = [];
  for (let step = 0; step < horizon; step += 1) {
    const predicted = round(best.predict(rolling, 0));
    forecast.push(predicted);
    rolling.push(predicted);
  }

  return {
    model: best.model,
    modelLabel: best.label,
    forecast,
    mae: round(best.mae),
    rmse: round(best.rmse),
    mape: round(best.mape),
    validationPoints,
  };
}
