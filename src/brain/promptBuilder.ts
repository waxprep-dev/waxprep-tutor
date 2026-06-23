import { ChatMessage } from "../llm/types";
import { buildStaticPromptParts } from "./systemPrompt";
import { ContextBundle } from "../memory/retrieval";
import { StudentProfile } from "../memory/profile";

export function buildPrompt(
  context: ContextBundle,
  currentMessage: string,
  history: ChatMessage[] = []
): ChatMessage[] {
  const staticParts = buildStaticPromptParts(context.profile);

  const systemContent = [
    staticParts.identity,
    "",
    "## MISSION",
    staticParts.mission,
    "",
    "## CAPABILITIES",
    staticParts.capabilities,
    "",
    "## CONVERSATIONAL DISCIPLINE",
    staticParts.conversational,
    "",
    "## BEHAVIORAL RULES",
    staticParts.rules,
  ].join("\n");

  const contextBlock = formatContextBlock(context);

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history,
    {
      role: "user",
      content: `${contextBlock}\n\n## INCOMING MESSAGE\n${currentMessage}`,
    },
  ];

  return messages;
}

function formatContextBlock(context: ContextBundle): string {
  const sections: string[] = ["## CONTEXT FOR THIS MESSAGE"];

  const p = context.profile;
  sections.push(`### Student
WAX ID: ${context.wax_id || "(not yet assigned)"}
Name: ${p.preferred_name || p.full_name || "(not yet known)"}
Level: ${p.current_level || "(not yet known)"}
School: ${p.school_type || "(not yet known)"}
Learning style: ${p.learning_style?.primary || "not yet determined"}
Pace: ${p.pace || "not yet determined"}
Confidence: ${p.confidence_baseline || "not yet determined"}
Preferred name: ${p.preferred_name || "ask what they want to be called"}
Goals: ${formatGoals(p.goals)}
Tutor name: ${p.tutor_persona?.tutor_name || "you don't have a name yet — they can give you one"}`);

  if (context.recentEpisodes.length > 0) {
    sections.push(`### Past closed conversations (most recent first)
${context.recentEpisodes
  .map(
    (e) =>
      `- ${new Date(e.ended_at!).toLocaleDateString()}: ${e.summary}${
        e.key_moments?.length
          ? " Key moments: " + e.key_moments.map((m: any) => m.description).join("; ")
          : ""
      }`
  )
  .join("\n")}`);
  } else {
    sections.push(`### Past closed conversations
None yet — but check the actual message history in this prompt below before assuming this is a first contact. A student can be mid-conversation with no closed episodes yet.`);
  }

  if (context.relevantEpisodes.length > 0) {
    const relevant = context.relevantEpisodes.filter((e) => e.similarity > 0.5);
    if (relevant.length > 0) {
      sections.push(`### Past conversations relevant to this message
${relevant
  .slice(0, 3)
  .map(
    (e) =>
      `- (similarity: ${e.similarity.toFixed(2)}) ${new Date(e.ended_at).toLocaleDateString()}: ${e.summary_text}`
  )
  .join("\n")}`);
    }
  }

  if (context.relevantConcepts.length > 0) {
    sections.push(`### Concepts this student has touched
${context.relevantConcepts
  .map(
    (c) =>
      `- ${c.name} (${c.subject}) — mastery: ${(c.mastery_score * 100).toFixed(0)}%${
        c.common_misconceptions.length
          ? " | known misconceptions: " + c.common_misconceptions.join("; ")
          : ""
      }`
  )
  .join("\n")}`);
  }

  if (context.relevantRules.length > 0) {
    sections.push(`### What works for THIS student (procedural rules)
${context.relevantRules
  .slice(0, 5)
  .map(
    (r) =>
      `- When ${r.trigger_condition || "(no specific trigger)"}: ${r.rule_text} (confidence: ${(r.confidence * 100).toFixed(0)}%)`
  )
  .join("\n")}`);
  }

  if (context.relevantNotes.length > 0) {
    sections.push(`### Personal context (relational memory)
${context.relevantNotes.map((n) => `- [${n.category}] ${n.note_text}`).join("\n")}`);
  }

  sections.push(`### Engagement signal (informational — use your judgment)
${context.engagement.label === "unknown"
  ? "No recent message history yet."
  : `Last few replies: ${context.engagement.label === "low_effort" ? "short / low-effort" : "normal length"} (streak: ${context.engagement.shortReplyStreak}).`}`);

  return sections.join("\n\n");
}

function formatGoals(goals: StudentProfile["goals"]): string {
  if (!goals || goals.length === 0) return "(not yet known — ask what they're studying for)";
  return goals.map((g: any) => `${g.subject} for ${g.target}${g.exam_date ? ` (exam: ${g.exam_date})` : ""}`).join(", ");
}
