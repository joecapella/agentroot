/**
 * Voice I/O stubs + OpenAI TTS integration.
 *
 * TTS: text → speech (OpenAI Azure endpoint).
 * STT: speech → text (placeholder — uses Whisper when wired).
 */

import { prisma } from "@/src/prisma";

export async function createTtsJob(args: {
  userId: string;
  text: string;
  voice?: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  model?: string;
}): Promise<{ jobId: string; status: string }> {
  const job = await prisma.voiceJob.create({
    data: {
      userId: args.userId,
      jobType: "tts",
      inputText: args.text,
    },
  });

  // Async processing
  processTtsJob(job.id, args.text, args.voice ?? "alloy", args.model).catch((err) => {
    console.error("[tts] background job failed:", err);
  });

  return { jobId: job.id, status: "pending" };
}

async function processTtsJob(
  jobId: string,
  text: string,
  voice: string,
  model?: string
) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) {
    await markVoiceFailed(jobId, "AZURE_OPENAI_ENDPOINT not set");
    return;
  }

  const deployment = process.env.AZURE_AI_TTS_DEPLOYMENT ?? "tts-hd";
  const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}/audio/speech?api-version=2025-03-01-preview`;

  const { DefaultAzureCredential } = await import("@azure/identity");
  const cred = new DefaultAzureCredential();
  const token = await cred.getToken("https://cognitiveservices.azure.com/.default");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model ?? "tts-1-hd",
      input: text.slice(0, 4000),
      voice,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    await markVoiceFailed(jobId, `HTTP ${res.status}: ${await res.text()}`);
    return;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const b64 = buffer.toString("base64");

  await prisma.voiceJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      audioBase64: b64,
      completedAt: new Date(),
    },
  });
}

async function markVoiceFailed(jobId: string, error: string) {
  await prisma.voiceJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      error,
      completedAt: new Date(),
    },
  });
}

export async function getVoiceJob(jobId: string, userId: string) {
  return prisma.voiceJob.findFirst({
    where: { id: jobId, userId },
  });
}
