import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";

type Tip = { keywords: string[]; title: string; detail: string };

type DatasetRow = { question: string; answer: string };

type HFRowResponse = {
  rows: { row: { question?: string; answer?: string } }[];
  num_rows?: number;
  error?: string;
};

const DATASET_NAME = "i-am-mushfiq/FirstAidQA";
const DATASET_SPLIT = "train";
const DATASET_LIMIT = 500;
const DATASET_BATCH = 100;

const tips: Tip[] = [
  {
    keywords: ["fever", "flu", "temperature", "chills"],
    title: "Fever care",
    detail:
      "Rest, drink fluids, and monitor temperature. Seek care if fever is very high or lasts more than 3 days.",
  },
  {
    keywords: ["cut", "bleeding", "wound", "laceration"],
    title: "Minor cuts",
    detail:
      "Rinse with clean water, apply gentle pressure to stop bleeding, then cover with a clean bandage.",
  },
  {
    keywords: ["burn", "hot", "scald", "blister"],
    title: "Minor burns",
    detail: "Cool the area under running water for 10-20 minutes. Do not apply ice or butter.",
  },
  {
    keywords: ["sprain", "strain", "twist", "ankle"],
    title: "Sprains",
    detail: "Rest the area, apply ice, compress gently, and elevate. Seek care if severe pain persists.",
  },
  {
    keywords: ["headache", "head ache", "migraine"],
    title: "Headache relief",
    detail: "Rest in a dark room, hydrate, and consider mild pain relief if safe for you.",
  },
  {
    keywords: ["sore throat", "throat pain", "throat", "cough"],
    title: "Sore throat",
    detail: "Warm fluids, rest your voice, and consider salt-water gargles. Seek care if severe or persistent.",
  },
  {
    keywords: ["nausea", "vomit", "vomiting", "stomach"],
    title: "Nausea",
    detail: "Take small sips of water and eat bland foods. Seek care if persistent or severe.",
  },
  {
    keywords: ["diarrhea"],
    title: "Diarrhea",
    detail: "Hydrate with oral rehydration and avoid greasy foods. Seek care if severe or prolonged.",
  },
  {
    keywords: ["first aid", "firstaid", "help", "what to do"],
    title: "First-aid basics",
    detail: "Focus on safety, stop bleeding, cool burns, and seek help for severe symptoms.",
  },
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s\-_/]+/g, "").trim();
}

let datasetCache: DatasetRow[] | null = null;
let datasetPromise: Promise<DatasetRow[] | null> | null = null;
let datasetError: string | null = null;

async function loadDatasetRows(): Promise<DatasetRow[] | null> {
  if (datasetCache) return datasetCache;
  if (datasetPromise) return datasetPromise;

  datasetPromise = (async () => {
    try {
      const hfToken = process.env.HF_TOKEN;
      const rows: DatasetRow[] = [];
      for (let offset = 0; offset < DATASET_LIMIT; offset += DATASET_BATCH) {
        const url = new URL("https://datasets-server.huggingface.co/rows");
        url.searchParams.set("dataset", DATASET_NAME);
        url.searchParams.set("config", "default");
        url.searchParams.set("split", DATASET_SPLIT);
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("length", String(Math.min(DATASET_BATCH, DATASET_LIMIT - offset)));

        const res = await fetch(url.toString(), {
          headers: {
            ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
          },
          cache: "no-store",
        });

        if (!res.ok) {
          datasetError = `HF rows request failed (${res.status})`;
          return null;
        }

        const data = (await res.json()) as HFRowResponse;
        if (data.error) {
          datasetError = data.error;
          return null;
        }

        const batch = (data.rows || [])
          .map((item) => ({
            question: (item.row.question || "").toString(),
            answer: (item.row.answer || "").toString(),
          }))
          .filter((row) => row.question && row.answer);

        rows.push(...batch);
        if (batch.length < DATASET_BATCH) {
          break;
        }
      }

      datasetCache = rows;
      return rows;
    } catch (err) {
      datasetError = err instanceof Error ? err.message : "Unknown dataset error";
      return null;
    }
  })();

  return datasetPromise;
}

function scoreMatch(query: string, candidate: string) {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (c.includes(q)) return 100;

  const qTokens = q.split(/\W+/).filter(Boolean);
  const cTokens = new Set(c.split(/\W+/).filter(Boolean));
  let hits = 0;
  for (const token of qTokens) {
    if (cTokens.has(token)) hits += 1;
  }
  return hits;
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "PATIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawQuery = (searchParams.get("query") || "").toLowerCase().trim();
  const compactQuery = normalize(rawQuery);

  if (!rawQuery) {
    return NextResponse.json({ tips: tips.slice(0, 3), fallback: true });
  }

  const rows = await loadDatasetRows();
  if (rows && rows.length) {
    const scored = rows
      .map((row) => ({ row, score: scoreMatch(rawQuery, row.question) }))
      .sort((a, b) => b.score - a.score)
      .filter((item) => item.score > 0)
      .slice(0, 1);

    if (scored.length) {
      return NextResponse.json({
        tips: scored.map((item) => ({
          title: "FirstAidQA Answer",
          detail: item.row.answer,
        })),
        source: DATASET_NAME,
        fallback: false,
      });
    }
  }

  const matches = tips.filter((tip) =>
    tip.keywords.some((k) => {
      const keyword = k.toLowerCase().trim();
      return rawQuery.includes(keyword) || compactQuery.includes(normalize(keyword));
    }),
  );

  if (matches.length) {
    return NextResponse.json({ tips: matches, fallback: false });
  }

  return NextResponse.json({
    tips: tips.slice(0, 3),
    fallback: true,
    dataset: { loaded: Boolean(rows?.length), error: datasetError },
  });
}
