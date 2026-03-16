import json
import os
import sys
from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
MODEL_NAME = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
TOP_K = int(os.getenv("TOP_K", "5"))

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise SystemExit("Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD")

query_text = " ".join(sys.argv[1:]).strip()
if not query_text:
    raise SystemExit("Usage: rag_query_json.py <your question>")

model = SentenceTransformer(MODEL_NAME)
query_embedding = model.encode([query_text], normalize_embeddings=True)[0].tolist()

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
with driver.session() as session:
    result = session.run(
        """
        CALL db.index.vector.queryNodes('patient_embedding', $k, $embedding)
        YIELD node, score
        RETURN node.id AS id, node.name AS name, node.age AS age, node.risk AS risk,
               node.description AS description, node.signals AS signals, score
        ORDER BY score DESC
        """,
        {"k": TOP_K, "embedding": query_embedding},
    )
    rows = result.data()

driver.close()

print(json.dumps({"query": query_text, "results": rows}))
