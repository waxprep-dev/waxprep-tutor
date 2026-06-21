import { ChatMessage } from "../llm/types";
import { buildStaticPromptParts } from "./systemPrompt";
import { ContextBundle } from "../memory/retrieval";

/**
 * Assembles the 5-layer prompt for a single message.
 * Layer A (identity), B (mission), C (capabilities), E (rules) = static.
 * Layer D (context) = dynamic, built from retrieved memory.
 */

export function buildPrompt(
  context: ContextBundle,
  currentMessage: string,
  history: ChatMessage[] = []
): ChatMessage[] {
  const staticParts = buildStaticPromptParts(context.profile);

  // System message = layers A + B + C + E
  const systemContent = [
    staticParts.identity,
    "",
    "## MISSION",
    staticParts.mission,
    "",
    "## CAPABILITIES",
    staticParts.capabilities,
    "",
    "## BEHAVIORAL RULES",
    staticParts.rules,
  ].join("\n");

  // Layer D: current context (dynamic)
  const contextBlock = formatContextBlock(context);

  // First user message includes the context
  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: `${contextBlock}\n\n## INCOMING MESSAGE\n${currentMessage}`,
    },
  ];

  // Then any prior conversation history in this session
  for (const h of history) {
    messages.push(h);
  }

  return messages;
}

function formatContextBlock(context: ContextBundle): string {
  const sections: string[] = ["## CONTEXT FOR THIS MESSAGE"];

  // Profile summary
  const p = context.profile;
  sections.push(`### Student
Name: ${p.preferred_name || p.full_name || "(not yet known)"}
Level: ${p.current_level || "(not yet known)"}
School: ${p.school_type || "(not yet known)"}
Learning style: ${p.learning_style?.primary || "not yet determined"}
Pace: ${p.pace || "not yet determined"}
Confidence: ${p.confidence_baseline || "not yet determined"}
Preferred name: ${p.preferred_name || "ask what they want to be called"}
Goals: ${formatGoals(p.goals)}
Tutor name: ${p.tutor_persona?.tutor_name || "you don't have a name yet — they can give you one"}`);

  // Recent episodes
  if (context.recentEpisodes.length > 0) {
    sections.push(`### Recent conversations (most recent first)
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
    sections.push(`### Recent conversations
This is your first or one of your first conversations. No prior history.`);
  }

  // Relevant past episodes (from semantic search)
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

  // Relevant concepts
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

  // Procedural rules
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

  // Relational notes (personal context)
  if (context.relevantNotes.length > 0) {
    sections.push(`### Personal context (relational memory)
${context.relevantNotes.map((n) => `- [${n.category}] ${n.note_text}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

function formatGoals(goals: StudentProfile["goals"]): string {
  if (!goals || goals.length === 0) return "(not yet known — ask what they're studying for)";
  return goals.map((g) => `${g.subject} for ${g.target}${g.exam_date ? ` (exam: ${g.exam_date})` : ""}`).join(", ");
}
