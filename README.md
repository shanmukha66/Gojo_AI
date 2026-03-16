# Explainable AI‑RAG Framework (Doctor + Patient)

A dual‑portal healthcare assistant with a **Doctor workspace** (EHR + RAG evidence search) and a **Patient assistant** (first‑aid guidance from FirstAidQA). Data is synthetic (Synthea) and stored in Neo4j with embeddings for similarity search.

## What’s Included
- **Doctor portal**: patient search + RAG evidence search grounded in Neo4j embeddings
- **Patient portal**: first‑aid Q&A (FirstAidQA dataset)
- **Local auth**: separate Doctor/Patient sessions (SQLite)
- **Neo4j graph**: 5,000 synthetic patients from Synthea
- **RAG server**: local FastAPI service on `127.0.0.1:8008`

---

## Demo Accounts
- **Doctor**: `doctor@aegis.local` / `Doctor@123456`
- **Patient**: `patient@aegis.local` / `Patient@123456`

---

## Patient Assistant (FirstAidQA)
The patient search uses the **FirstAidQA dataset** from Hugging Face and returns the **best single match**. It falls back to safe, general first‑aid tips if no dataset match is found.

If you want higher rate limits, add a token in:
`/Volumes/workspace/Explainable-AI-RAG-Framework/web/.env.local`
```
HF_TOKEN=your_huggingface_token_optional
```

---

## Doctor Workspace
- Search patients by **name or ID**
- RAG evidence search returns similar patient summaries using Neo4j vector search
- “Secondary suggestions” are advisory; final decision stays with the clinician

---

## Useful Scripts
- `scripts/seed_neo4j_subset.py` — load patient graph from Synthea
- `scripts/embed_patients.py` — generate patient summaries + embeddings
- `scripts/rag_server.py` — FastAPI RAG server
- `scripts/rag_query.py` — CLI query against Neo4j vector index

---

## Notes
- Embeddings live on `:Patient.embedding` (vector index `patient_embedding`).
- Data is synthetic (Synthea) for research/demo use only.
