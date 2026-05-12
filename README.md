# GOJO Health App (Doctor + Patient)

A dual-portal healthcare assistant with a **Doctor workspace** (EHR + evidence search) and a **Patient assistant** (local first-aid guidance). Data is synthetic (Synthea) and stored in SQLite + Neo4j with local evidence retrieval.

## What’s Included
- **Doctor portal**: patient search + evidence search grounded in local SQL + Neo4j text retrieval
- **Patient portal**: local first-aid Q&A
- **Local auth**: separate Doctor/Patient sessions (SQLite)
- **Neo4j graph**: 5,000 synthetic patients from Synthea

---

## Demo Accounts
- **Doctor**: `doctor@aegis.local` / `Doctor@123456`
- **Patient**: `patient@aegis.local` / `Patient@123456`

---

## Patient Assistant
The patient first-aid assistant uses local safe first-aid knowledge and does not call external dataset APIs at runtime.

If you want higher rate limits, add a token in:
`/Volumes/workspace/Explainable-AI-RAG-Framework/web/.env.local`
```
```

---

## Doctor Workspace
- Search patients by **name or ID**
- Evidence search returns similar patient summaries using local SQL + Neo4j text retrieval
- “Secondary suggestions” are advisory; final decision stays with the clinician

---

## Useful Scripts
- `scripts/seed_neo4j_subset.py` — load patient graph from Synthea
- Doctor evidence search now runs inside Next.js using local SQL + Neo4j text retrieval.
- Legacy external retrieval scripts are disabled; use the app evidence search page.

---

## Notes
- Evidence retrieval does not require an external embedding server.
- Data is synthetic (Synthea) for research/demo use only.

---

## Predictive Modeling (Readmission Task)

### Build the dataset (multi-core)
```bash
cd /Volumes/workspace/Explainable-AI-RAG-Framework
NEO4J_URI="bolt://127.0.0.1:7687" \
NEO4J_USER="neo4j" \
NEO4J_PASSWORD="your_neo4j_password" \
MAX_WORKERS=12 \
python scripts/predictive/extract_readmission_dataset.py
```

### Train the three models
```bash
# Tabular model
python scripts/predictive/train_tabular.py

# Sequence model (GRU on visit types)
python scripts/predictive/train_sequence.py

# Graph-featurized model
NEO4J_URI="bolt://127.0.0.1:7687" \
NEO4J_USER="neo4j" \
NEO4J_PASSWORD="your_neo4j_password" \
python scripts/predictive/train_graph.py
```

### Aggregate metrics for the UI
```bash
python scripts/predictive/aggregate_metrics.py
```

### Model Comparison UI
Open `http://localhost:3000/doctor/metrics` to view the comparison dashboard.

---

## Open Datasets (Downloaded)

### ClaimsDB (CMS SynPUF sample)
Downloaded into:
- `datasets/open/claimsdb`

To convert `.rda` files to CSV (optional):
```bash
python scripts/predictive/convert_claimsdb.py
```

Output CSVs:
- `datasets/open/claimsdb/converted`
