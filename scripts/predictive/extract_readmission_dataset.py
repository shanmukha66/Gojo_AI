import csv
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, Optional

from neo4j import GraphDatabase

DATA_DIR = os.getenv(
    "SYNTH_OMOP_DIR",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/synthea_omop_100k",
)
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
OUT_PATH = os.getenv(
    "OUT_PATH",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/artifacts/predictive/readmission_dataset.csv",
)
MAX_WORKERS = int(os.getenv("MAX_WORKERS", str(os.cpu_count() or 4)))

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise SystemExit("Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD")


def parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return None


def compute_features(row: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now()
    visit_dates_raw = row.get("visit_dates", [])
    visit_types_raw = row.get("visit_types", [])

    visit_dates = [parse_date(d) for d in visit_dates_raw if d]
    visit_dates = [d for d in visit_dates if d]
    visit_dates.sort()

    visit_count = len(visit_dates)
    condition_count = len(row.get("condition_codes", []))

    first_visit = visit_dates[0] if visit_dates else None
    last_visit = visit_dates[-1] if visit_dates else None

    gaps = []
    if len(visit_dates) >= 2:
        for a, b in zip(visit_dates[:-1], visit_dates[1:]):
            gaps.append((b - a).days)

    avg_gap = sum(gaps) / len(gaps) if gaps else None
    min_gap = min(gaps) if gaps else None

    readmitted_30d = 1 if any(g is not None and g <= 30 for g in gaps) else 0

    recent_gap = (now - last_visit).days if last_visit else None

    return {
        "patient_id": row.get("id"),
        "age": row.get("age"),
        "gender": row.get("genderLabel"),
        "risk": row.get("risk"),
        "visit_count": visit_count,
        "condition_count": condition_count,
        "first_visit_date": first_visit.strftime("%Y-%m-%d") if first_visit else "",
        "last_visit_date": last_visit.strftime("%Y-%m-%d") if last_visit else "",
        "avg_days_between_visits": round(avg_gap, 2) if avg_gap is not None else "",
        "min_days_between_visits": min_gap if min_gap is not None else "",
        "recent_visit_gap_days": recent_gap if recent_gap is not None else "",
        "readmitted_30d": readmitted_30d,
        "visit_types": ",".join([v for v in visit_types_raw if v]),
        "visit_dates": ",".join([d for d in visit_dates_raw if d]),
    }


def main():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    query = """
    MATCH (p:Patient)
    OPTIONAL MATCH (p)-[:HAD_VISIT]->(v:Visit)
    OPTIONAL MATCH (p)-[:HAS_CONDITION]->(c:Condition)
    RETURN p.id AS id,
           p.age AS age,
           p.genderLabel AS genderLabel,
           p.risk AS risk,
           collect(v.start) AS visit_dates,
           collect(v.type) AS visit_types,
           collect(DISTINCT c.code) AS condition_codes
    """

    with driver.session() as session:
        records = session.run(query)
        rows = [record.data() for record in records]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        features = list(executor.map(compute_features, rows))

    fieldnames = [
        "patient_id",
        "age",
        "gender",
        "risk",
        "visit_count",
        "condition_count",
        "first_visit_date",
        "last_visit_date",
        "avg_days_between_visits",
        "min_days_between_visits",
        "recent_visit_gap_days",
        "readmitted_30d",
        "visit_types",
        "visit_dates",
    ]

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in features:
            writer.writerow(row)

    print(f"Wrote dataset with {len(features)} patients to {OUT_PATH}")


if __name__ == "__main__":
    main()
