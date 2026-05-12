import csv
import os
import math
from collections import defaultdict
from datetime import datetime
from neo4j import GraphDatabase

DATA_DIR = os.getenv(
    "SYNTH_OMOP_DIR",
    "/Volumes/workspace/Explainable-AI-RAG-Framework/datasets/synthea_omop_100k",
)
PATIENT_LIMIT = int(os.getenv("PATIENT_LIMIT", "1000"))
MAX_CONDITIONS = int(os.getenv("MAX_CONDITIONS", "5"))
MAX_VISITS = int(os.getenv("MAX_VISITS", "5"))

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

if not all([NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD]):
    raise SystemExit("Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD")

person_path = os.path.join(DATA_DIR, "person.csv")
visit_path = os.path.join(DATA_DIR, "visit_occurrence.csv")
condition_path = os.path.join(DATA_DIR, "condition_occurrence.csv")

now_year = datetime.now().year

gender_map = {
    "8507": "Male",
    "8532": "Female",
}

patients = []
patient_ids = set()

with open(person_path, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        if len(patients) >= PATIENT_LIMIT:
            break
        person_id = row["person_id"]
        year = row.get("year_of_birth") or ""
        gender_code = row.get("gender_concept_id") or "unknown"
        age = None
        if year.isdigit():
            age = max(0, now_year - int(year))
        gender_label = gender_map.get(gender_code, "Unknown")
        patients.append({
            "id": person_id,
            "age": age,
            "gender": gender_code,
            "genderLabel": gender_label,
        })
        patient_ids.add(person_id)

visits_by_patient = defaultdict(list)
visit_count_by_patient = defaultdict(int)
with open(visit_path, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        pid = row["person_id"]
        if pid not in patient_ids:
            continue
        visit_count_by_patient[pid] += 1
        if len(visits_by_patient[pid]) >= MAX_VISITS:
            continue
        visits_by_patient[pid].append({
            "id": row["visit_occurrence_id"],
            "start": row.get("visit_start_date"),
            "type": row.get("visit_concept_id"),
        })

conditions_by_patient = defaultdict(list)
condition_count_by_patient = defaultdict(int)
with open(condition_path, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        pid = row["person_id"]
        if pid not in patient_ids:
            continue
        condition_count_by_patient[pid] += 1
        if len(conditions_by_patient[pid]) >= MAX_CONDITIONS:
            continue
        conditions_by_patient[pid].append({
            "code": row.get("condition_concept_id"),
            "date": row.get("condition_start_date"),
        })


def risk_score(pid: str, age: int | None) -> float:
    visits = visit_count_by_patient[pid]
    conditions = condition_count_by_patient[pid]
    visit_component = min(0.42, 0.09 * math.log1p(visits))
    condition_component = min(0.35, 0.10 * math.log1p(conditions))
    age_component = 0.0
    if age is not None:
        if age >= 75:
            age_component = 0.12
        elif age >= 60:
            age_component = 0.08
        elif age <= 17:
            age_component = 0.04
    score = min(0.97, 0.08 + visit_component + condition_component + age_component)
    return round(score, 2)


def build_signals(pid: str, age: int | None):
    signals = []
    visits = visit_count_by_patient[pid]
    conditions = condition_count_by_patient[pid]
    visit_types = {str(v.get("type") or "") for v in visits_by_patient[pid]}

    if visits >= 12:
        signals.append("Very high utilization")
    elif visits >= 6:
        signals.append("Frequent recent visits")
    elif visits >= 3:
        signals.append("Moderate visit activity")

    if conditions >= 8:
        signals.append("Complex multimorbidity")
    elif conditions >= 4:
        signals.append("Chronic condition burden")
    elif conditions >= 2:
        signals.append("Comorbidity risk")

    if "9201" in visit_types:
        signals.append("Recent emergency care")
    elif "9203" in visit_types:
        signals.append("Inpatient care history")
    elif "9202" in visit_types:
        signals.append("Predominantly outpatient follow-up")

    if age is not None:
        if age >= 75:
            signals.append("Older adult care risk")
        elif age <= 17:
            signals.append("Pediatric monitoring")

    if not signals:
        signals.append("Lower short-term complexity")
    return signals[:4]


driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

with driver.session() as session:
    session.run("CREATE CONSTRAINT patient_id IF NOT EXISTS FOR (p:Patient) REQUIRE p.id IS UNIQUE")
    session.run("CREATE CONSTRAINT visit_id IF NOT EXISTS FOR (v:Visit) REQUIRE v.id IS UNIQUE")

    for patient in patients:
        pid = patient["id"]
        session.run(
            """
            MERGE (p:Patient {id: $id})
            SET p.age = $age,
                p.gender = $gender,
                p.genderLabel = $genderLabel,
                p.risk = $risk,
                p.visitCount = $visitCount,
                p.conditionCount = $conditionCount,
                p.signals = $signals,
                p.name = $name
            """,
            {
                "id": pid,
                "age": patient["age"],
                "gender": patient["gender"],
                "genderLabel": patient["genderLabel"],
                "risk": risk_score(pid, patient["age"]),
                "visitCount": visit_count_by_patient[pid],
                "conditionCount": condition_count_by_patient[pid],
                "signals": build_signals(pid, patient["age"]),
                "name": f"Patient {pid}",
            },
        )

        for visit in visits_by_patient[pid]:
            session.run(
                """
                MERGE (v:Visit {id: $vid})
                SET v.start = $start,
                    v.type = $type
                WITH v
                MATCH (p:Patient {id: $pid})
                MERGE (p)-[:HAD_VISIT]->(v)
                """,
                {
                    "vid": visit["id"],
                    "start": visit["start"],
                    "type": visit["type"],
                    "pid": pid,
                },
            )

        for condition in conditions_by_patient[pid]:
            session.run(
                """
                MERGE (c:Condition {code: $code})
                WITH c
                MATCH (p:Patient {id: $pid})
                MERGE (p)-[:HAS_CONDITION]->(c)
                """,
                {
                    "code": condition["code"],
                    "pid": pid,
                },
            )

print(f"Seeded {len(patients)} patients into Neo4j.")
