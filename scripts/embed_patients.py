import os
from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer
import torch

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

MODEL_NAME = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
BATCH_SIZE = int(os.getenv("EMBED_BATCH", "64"))
LIMIT = int(os.getenv("PATIENT_LIMIT", "5000"))

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise SystemExit("Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD")

cpu_count = os.cpu_count() or 4
try:
    torch.set_num_threads(cpu_count)
    torch.set_num_interop_threads(max(1, cpu_count // 2))
except Exception:
    pass


def build_description(row):
    signals = row.get("signals") or []
    conditions = row.get("conditions") or []
    last_visit = row.get("lastVisit") or "unknown"
    condition_count = row.get("conditionCount", 0)
    visit_count = row.get("visitCount", 0)
    age = row.get("age", "unknown")
    age_band = "unknown"
    try:
        if age is not None:
            age = int(age)
            if age >= 75:
                age_band = "older adult"
            elif age >= 45:
                age_band = "adult"
            elif age >= 18:
                age_band = "young adult"
            else:
                age_band = "pediatric"
    except Exception:
        pass

    parts = [
        f"Patient {row['id']} ({row.get('name', 'Patient')}), age {row.get('age', 'unknown')} ({age_band}), gender {row.get('genderLabel', 'unknown')}.",
        f"Risk score {row.get('risk', 0):.2f}.",
        f"Visits in record: {visit_count}. Last visit: {last_visit}.",
        f"Condition count: {condition_count}.",
    ]
    if conditions:
        parts.append("Condition codes: " + ", ".join(map(str, conditions)) + ".")
    if signals:
        parts.append("Signals: " + ", ".join(map(str, signals)) + ".")
    return " ".join(parts)


def main():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    with driver.session() as session:
        session.run(
            """
            CREATE VECTOR INDEX patient_embedding IF NOT EXISTS
            FOR (p:Patient) ON (p.embedding)
            OPTIONS { indexConfig: { `vector.dimensions`: 384, `vector.similarity_function`: 'cosine' } }
            """
        )

        result = session.run(
            """
            MATCH (p:Patient)
            OPTIONAL MATCH (p)-[:HAS_CONDITION]->(c:Condition)
            WITH p, collect(distinct c.code)[0..8] as conditions, count(c) as conditionCount
            OPTIONAL MATCH (p)-[:HAD_VISIT]->(v:Visit)
            WITH p, conditions, conditionCount, count(v) as visitCount, max(v.start) as lastVisit
            RETURN p.id as id, p.name as name, p.age as age, p.genderLabel as genderLabel, p.risk as risk,
                   p.signals as signals, conditions, conditionCount, visitCount, lastVisit
            LIMIT $limit
            """,
            {"limit": LIMIT},
        )

        rows = [record.data() for record in result]

    model = SentenceTransformer(MODEL_NAME)

    descriptions = [build_description(row) for row in rows]
    embeddings = model.encode(
        descriptions,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )

    with driver.session() as session:
        for i in range(0, len(rows), BATCH_SIZE):
            batch_rows = rows[i : i + BATCH_SIZE]
            batch_embeds = embeddings[i : i + BATCH_SIZE]
            payload = []
            for row, embed in zip(batch_rows, batch_embeds):
                payload.append(
                    {
                        "id": row["id"],
                        "description": build_description(row),
                        "embedding": embed.tolist(),
                    }
                )
            session.run(
                """
                UNWIND $rows as row
                MATCH (p:Patient {id: row.id})
                SET p.description = row.description,
                    p.embedding = row.embedding
                """,
                {"rows": payload},
            )

    driver.close()
    print(f"Embedded {len(rows)} patients with model {MODEL_NAME}.")


if __name__ == "__main__":
    main()
