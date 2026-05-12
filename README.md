# GOJO Health App

GOJO Health App is an explainable AI-RAG healthcare assistant for doctor and patient workflows. It combines patient timelines, report uploads, clinical notes, scheduling, prediction dashboards, graph-based evidence, grounded copilot responses, and reinforcement-style AI quality metrics.

## Main Features

- Doctor workspace with patients, reports, timeline, memos, reviews, schedule, copilot, and predictions.
- Patient assistant with report upload, document Q&A, first-aid guidance, appointments, and speech input.
- Evidence-grounded AI flow using local clinical knowledge, saved ground-truth memory, caching, and fallback responses.
- Prediction explainability with ROC/PR artifacts, SHAP-style feature importance, graph paths, and similar-patient retrieval.
- SQLite for app persistence, Neo4j for graph evidence, and CSV/Excel exports as generated snapshots.

## Run Locally

```bash
./scripts/start_gojo_local.sh
```

Then open:

```text
http://localhost:3000
```

Create your own environment file from:

```bash
cp web/.env.local.example web/.env.local
```

Do not commit real API keys or local database files.

## Branches

- `V1`: original project version.
- `V2`: upgraded doctor/patient workflows and AI features.
- `main`: merged current version containing V1 + V2 work.
