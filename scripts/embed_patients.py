"""Disabled legacy retrieval script.

GOJO Health App no longer uses the local sentence-transformer / external embedding
server path. Evidence search now runs inside the Next.js app using SQL + Neo4j
text retrieval, and AI text generation uses MiniMax.
"""

raise SystemExit(
    "This legacy retrieval script is disabled. Use the Next.js doctor evidence search instead."
)
