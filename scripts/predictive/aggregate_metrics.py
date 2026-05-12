import json
import os
from datetime import datetime

OUT_PATH = os.getenv(
    "OUT_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/web/public/predictive/metrics.json",
)

METRICS_FILES = [
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_graph.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_claimsdb_tabular.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_claimsdb_sequence.json",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/metrics_claimsdb_graph.json",
]

metrics = []
for path in METRICS_FILES:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            metrics.append(json.load(f))

payload = {
    "generated_at": datetime.utcnow().isoformat() + "Z",
    "models": metrics,
}

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

print(f"Wrote {OUT_PATH} with {len(metrics)} model entries")
