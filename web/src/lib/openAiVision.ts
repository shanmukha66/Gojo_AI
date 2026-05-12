import { randomUUID } from "crypto";
import { getDb } from "./db";
import { recordAiReward } from "./rlMetrics";

type VisionResult = {
  visualSummary: string;
  possibleConcerns: string[];
  visibleText: string[];
  suggestedDoctorQuestions: string[];
  caution: "low" | "moderate" | "high";
  escalation: string;
};

function nowIso() {
  return new Date().toISOString();
}

function dailyLimitReached() {
  const limit = Number(process.env.OPENAI_VISION_DAILY_LIMIT || "25");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS calls FROM ai_usage_logs WHERE provider = 'openai-vision' AND cache_hit = 0 AND created_at >= ?`)
    .get(since) as { calls: number } | undefined;
  return (row?.calls ?? 0) >= limit;
}

function logVisionUsage(input: { model: string; promptTokens?: number; completionTokens?: number; totalTokens?: number; cacheHit?: boolean }) {
  getDb()
    .prepare(
      `INSERT INTO ai_usage_logs
        (id, provider, model, route_kind, cache_hit, prompt_tokens, completion_tokens, total_tokens, request_hash, created_at)
       VALUES (?, 'openai-vision', ?, 'doctor_image_vision', ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      randomUUID(),
      input.model,
      input.cacheHit ? 1 : 0,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.totalTokens ?? 0,
      nowIso(),
    );
}

function extractJson(text: string) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  const jsonText = first >= 0 && last > first ? clean.slice(first, last + 1) : clean;
  return JSON.parse(jsonText) as VisionResult;
}

export async function analyzeMedicalImageWithOpenAI(input: { file: File; question: string }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OpenAI vision key is not configured." } as const;
  if (dailyLimitReached()) return { error: "Daily OpenAI vision limit reached. Try again tomorrow or use text/PDF mode." } as const;

  const maxMb = Number(process.env.OPENAI_VISION_MAX_IMAGE_MB || "4");
  if (input.file.size > maxMb * 1024 * 1024) {
    return { error: `Image is too large. Limit is ${maxMb}MB to control cost.` } as const;
  }

  const model = process.env.OPENAI_VISION_MODEL || "gpt-4.1-nano";
  const maxOutputTokens = Number(process.env.OPENAI_VISION_MAX_OUTPUT_TOKENS || "450");
  const detail = process.env.OPENAI_VISION_DETAIL || "auto";
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const dataUrl = `data:${input.file.type || "image/png"};base64,${bytes.toString("base64")}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are a doctor-facing medical image/document assistant. Describe only what is visibly apparent, note possible concerns in cautious language, and give practical next questions/actions for a clinician to verify. Do not make a definitive diagnosis, do not claim certainty, and do not replace radiology/clinician interpretation. Always say final interpretation remains with clinician/radiologist. Return strict JSON only.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Doctor question: ${input.question}

Return JSON with:
- visualSummary: 3-5 clear sentences describing visible anatomy/image type and any obvious abnormal-looking areas without certainty.
- possibleConcerns: short bullet-style strings, each starting with "Possible" or "May show" unless it is only a technical observation.
- visibleText: any visible labels/text, or [].
- suggestedDoctorQuestions: concrete next checks/actions such as correlate with pain location, exam findings, compare prior imaging, obtain radiology read, immobilization/orthopedic review if clinically appropriate.
- caution: low, moderate, or high.
- escalation: one concise safety/verification note.`,
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    return { error: `OpenAI vision request failed (${res.status}).` } as const;
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return { error: "OpenAI vision returned no content." } as const;

  try {
    const result = extractJson(content);
    logVisionUsage({
      model,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
      totalTokens: payload.usage?.total_tokens,
    });
    recordAiReward({
      actorRole: "doctor",
      routeKind: "doctor_image_vision",
      actionKey: "openai-vision:image-assist",
      fallback: false,
      evidenceCount: result.visibleText.length + result.possibleConcerns.length + 1,
      caution: result.caution,
      answerLength: result.visualSummary.length,
      model,
    });
    return { result, model, usage: payload.usage } as const;
  } catch {
    return { error: "OpenAI vision returned non-JSON content." } as const;
  }
}
