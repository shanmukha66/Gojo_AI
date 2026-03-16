import os
from fastapi import FastAPI, Query
from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer
import torch

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
MODEL_NAME = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise SystemExit("Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD")

cpu_count = os.cpu_count() or 4
try:
    torch.set_num_threads(cpu_count)
    torch.set_num_interop_threads(max(1, cpu_count // 2))
except Exception:
    pass

model = SentenceTransformer(MODEL_NAME)

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


@app.get("/rag")
def rag(query: str = Query(...), k: int = Query(5)):
    embedding = model.encode([query], normalize_embeddings=True)[0].tolist()
    with driver.session() as session:
        result = session.run(
            """
            CALL db.index.vector.queryNodes('patient_embedding', $k, $embedding)
            YIELD node, score
            RETURN node.id AS id, node.name AS name, node.age AS age, node.risk AS risk,
                   node.description AS description, node.signals AS signals, score
            ORDER BY score DESC
            """,
            {"k": k, "embedding": embedding},
        )
        rows = result.data()
    return {"query": query, "results": rows}
