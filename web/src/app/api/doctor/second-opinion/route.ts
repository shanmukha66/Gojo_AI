import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { answerDoctorSecondOpinion } from "@/lib/doctorSecondOpinion";
import { analyzeMedicalImageWithOpenAI } from "@/lib/openAiVision";

function cleanText(value: string) {
  return value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractUploadText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  if (file.type.startsWith("text/") || file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".csv")) {
    return cleanText(buffer.toString("utf8")).slice(0, 5000);
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gojo-copilot-upload-"));
    const tempPath = path.join(tempDir, file.name.replace(/[^a-zA-Z0-9._-]/g, "_"));
    try {
      fs.writeFileSync(tempPath, buffer);
      const output = execFileSync("pdftotext", ["-layout", tempPath, "-"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      return cleanText(output).slice(0, 5000);
    } catch {
      return "";
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return "";
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
    const user = getCurrentUser(sessionId);
    if (!user || user.role !== "DOCTOR") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = req.headers.get("content-type") || "";
    let question = "";
    let uploadNote = "";
    let answerMode = "balanced";
    let imageWarning = "";
    let visionContext = "";
    let imageAnalysis: Awaited<ReturnType<typeof analyzeMedicalImageWithOpenAI>>["result"] | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      question = String(form.get("question") || "").trim();
      answerMode = String(form.get("answerMode") || "balanced");
      const file = form.get("file");
      if (file instanceof File && file.size > 0) {
        if (file.type.startsWith("image/")) {
          const vision = await analyzeMedicalImageWithOpenAI({ file, question: question || "Describe this uploaded medical image for clinician review." });
          if ("result" in vision && vision.result) {
            const analysis = vision.result;
            imageAnalysis = analysis;
            visionContext = `\n\nUploaded image visual-assist context from ${file.name}:
Visual summary: ${analysis.visualSummary}
Possible concerns: ${analysis.possibleConcerns.join("; ") || "none listed"}
Visible text: ${analysis.visibleText.join("; ") || "none"}
Suggested clinician checks: ${analysis.suggestedDoctorQuestions.join("; ") || "obtain clinician/radiology review"}
Vision escalation note: ${analysis.escalation}
Important limitation: This is assistive image description only. Final interpretation remains with clinician/radiologist.`;
          } else {
            imageWarning = vision.error;
          }
        } else {
          const extracted = await extractUploadText(file);
          uploadNote = extracted ? `\n\nUploaded document context from ${file.name}:\n${extracted}` : `\n\nUploaded file ${file.name} could not be text-extracted.`;
        }
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as { question?: string; answerMode?: string };
      question = body.question?.trim() || "";
      answerMode = body.answerMode || "balanced";
    }

    if (!question) {
      return NextResponse.json({ error: "Missing doctor question" }, { status: 400 });
    }

    const result = await answerDoctorSecondOpinion({
      doctorId: user.id,
      question: `${question}${uploadNote}${visionContext}\n\nPreferred answer mode: ${answerMode}`,
    });

    return NextResponse.json({ ...result, imageWarning, imageAnalysis });
  } catch (error) {
    console.error("Doctor second-opinion failed", error);
    return NextResponse.json({ error: "Doctor copilot failed while processing this request. Please try again with a shorter question or a smaller upload." }, { status: 500 });
  }
}
