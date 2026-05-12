import neo4j, { type Driver, type Integer } from "neo4j-driver";

const uri = process.env.NEO4J_URI || "";
const user = process.env.NEO4J_USER || "";
const password = process.env.NEO4J_PASSWORD || "";

let driver: Driver | null = null;

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
    return result.records.map((record) => toNative(record.toObject())) as T[];
  } finally {
    await session.close();
  }
}

function toNative(value: unknown): unknown {
  if (neo4j.isInt(value)) {
    return (value as Integer).toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toNative(item));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = toNative(obj[key]);
    }
    return out;
  }
  return value;
}
