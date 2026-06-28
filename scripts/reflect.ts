// Reviews a real WhatsApp conversation and proposes specific, evidence-
// based additions to the tutor's instructions. This does NOT auto-edit
// your code — it prints a report. You decide what to apply, the same way
// every fix in this project has come from a real transcript, not a guess.
//
// Run: npx ts-node scripts/reflect.ts <phone_number>

import { query } from "../src/db/client";
import { callLLM } from "../src/llm/client";

const RUBRIC = `
You are reviewing a real WhatsApp tutoring conversation between an AI tutor
("Wax") and a Nigerian secondary/university-prep student. Judge ONLY against
these rules, which are the tutor's actual current instructions:

1. Teach before quizzing, always.
2. Never ask for information the student already gave (exam combo, goal, confusion level).
3. Buttons/lists only for real forks in the road, never to confirm something obvious.
4. After sending any button/list/quiz, don't send another prompt until the student replies.
5. No Markdown headers, double-asterisk bold, tables, or LaTeX — WhatsApp plain text only.
6. Never narrate or name a tool in the visible reply.
7. Reflective questions only after real teaching content — never on casual remarks.
8. Acknowledge a prior "overloaded" filler message before continuing, if one occurred.

For each rule, find the EARLIEST point in this transcript (if any) where it was broken,
quote the exact line, and propose ONE concrete, minimal sentence to add to that rule's
text that would have prevented it. If a rule was never broken, say "OK" — don't invent
a problem that isn't there.

Output as a numbered list: Status (OK / VIOLATED), Evidence (exact quote if violated),
Proposed addition (one sentence, if violated).
`;

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error("Usage: npx ts-node scripts/reflect.ts <phone_number>");
    process.exit(1);
  }

  const rows = await query<{ direction: string; raw_text: string }>(
    `SELECT direction, raw_text FROM message_log
     WHERE student_phone = $1
     ORDER BY timestamp ASC
     LIMIT 200`,
    [phone]
  );

  if (rows.length === 0) {
    console.log("No messages found for that phone.");
    return;
  }

  const transcript = rows
    .map((r) => `${r.direction === "inbound" ? "STUDENT" : "TUTOR"}: ${r.raw_text}`)
    .join("\n");

  const response = await callLLM({
    messages: [
      { role: "system", content: RUBRIC },
      { role: "user", content: `TRANSCRIPT:\n\n${transcript}` },
    ],
    temperature: 0.2,
    max_tokens: 1500,
  });

  console.log("\n=== REFLECTION REPORT ===\n");
  console.log(response.content);
  console.log("\n=== Review this before touching systemPrompt.ts ===\n");
}

main().catch((err) => {
  console.error("Reflection script failed:", err.message);
  process.exit(1);
});
