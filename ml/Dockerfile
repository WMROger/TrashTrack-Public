FROM python:3.11-slim
WORKDIR /app
COPY ml/requirements.txt ml/requirements.txt
RUN pip install --no-cache-dir -r ml/requirements.txt
COPY ml ml
COPY data/lstmForecastArtifact.json data/lstmForecastArtifact.json
RUN python ml/train_lstm.py --output output/ml
EXPOSE 8787
CMD ["python", "ml/inference_api.py", "--host", "0.0.0.0", "--port", "8787"]
