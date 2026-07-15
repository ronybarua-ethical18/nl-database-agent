import { askDatabase } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let question: unknown;
  try {
    ({ question } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof question !== "string" || question.trim().length === 0) {
    return Response.json(
      { error: "Body must be { question: string }." },
      { status: 400 },
    );
  }
  if (question.length > 500) {
    return Response.json({ error: "Question is too long." }, { status: 400 });
  }

  try {
    const result = await askDatabase(question.trim());
    return Response.json(result);
  } catch (err) {
    console.error("askDatabase failed:", err);
    return Response.json(
      { error: "Something went wrong while answering the question." },
      { status: 500 },
    );
  }
}
