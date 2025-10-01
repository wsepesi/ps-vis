import { NextResponse } from "next/server";
import { summarizeReplay } from "@/lib/parser";

interface SummaryRequestBody {
  url?: string;
}

export async function POST(request: Request) {
  let body: SummaryRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const replayUrl = body.url?.trim();
  if (!replayUrl) {
    return NextResponse.json({ error: "Missing replay URL" }, { status: 400 });
  }

  try {
    const summary = await summarizeReplay(replayUrl);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
