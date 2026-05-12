import fs from "fs";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getMockClinicalCsvPath, listMockClinicalCsvFiles, loadGeneratedClinicalDataForAllPatients, loadMockClinicalData } from "@/lib/mockClinicalData";

function requireDoctorUser(sessionId?: string) {
  const user = getCurrentUser(sessionId);
  return user && user.role === "DOCTOR" ? user : null;
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const user = requireDoctorUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const fileName = searchParams.get("file");
  if (fileName) {
    const filePath = getMockClinicalCsvPath(fileName);
    if (!filePath) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return new Response(fs.readFileSync(filePath, "utf8"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `inline; filename="${fileName}"`,
      },
    });
  }

  return NextResponse.json({ files: listMockClinicalCsvFiles() });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const user = requireDoctorUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: string };
    const result = body.mode === "all" ? await loadGeneratedClinicalDataForAllPatients(user.id) : await loadMockClinicalData(user.id);
    return NextResponse.json({ ok: true, mode: body.mode === "all" ? "all" : "csv", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load mock clinical data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
