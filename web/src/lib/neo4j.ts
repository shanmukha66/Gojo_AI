import neo4j from "neo4j-driver";

const uri = process.env.NEO4J_URI || "";
const user = process.env.NEO4J_USER || "";
const password = process.env.NEO4J_PASSWORD || "";

let driver: neo4j.Driver | null = null;

export function getDriver() {
  if (!uri || !user || !password) {
    throw new Error("Neo4j credentials missing. Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD.");
  }
  if (!driver) {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

export async function runQuery<T = unknown>(query: string, params?: Record<string, unknown>) {
  const session = getDriver().session();
  try {
    const result = await session.run(query, params);
    return result.records.map((record) => record.toObject()) as T[];
  } finally {
    await session.close();
  }
}
