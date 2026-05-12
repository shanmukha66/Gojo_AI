import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences, updateUserPreferences } from "@/lib/preferences";

type Payload = {
  theme?: "dark" | "light";
  chartDensity?: "comfortable" | "compact";
  showRiskPanels?: boolean;
  voiceInputEnabled?: boolean;
};

function validatePayload(body: Payload) {
  const patch: Payload = {};

  if (body.theme !== undefined) {
    if (body.theme !== "dark" && body.theme !== "light") {
      return { error: "Invalid theme" };
    }
    patch.theme = body.theme;
  }
  if (body.chartDensity !== undefined) {
    if (body.chartDensity !== "comfortable" && body.chartDensity !== "compact") {
      return { error: "Invalid chartDensity" };
    }
    patch.chartDensity = body.chartDensity;
  }
  if (body.showRiskPanels !== undefined) {
    patch.showRiskPanels = Boolean(body.showRiskPanels);
  }
  if (body.voiceInputEnabled !== undefined) {
    patch.voiceInputEnabled = Boolean(body.voiceInputEnabled);
  }

  return { patch };
}

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "PATIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preferences = getUserPreferences(user.id);
  return NextResponse.json({ preferences });
}

export async function PUT(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  if (!user || user.role !== "PATIENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Payload;
  const { patch, error } = validatePayload(body);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const preferences = updateUserPreferences(user.id, patch ?? {});
  return NextResponse.json({ preferences });
}
