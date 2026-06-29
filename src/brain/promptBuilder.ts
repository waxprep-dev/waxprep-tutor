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

  // The new prompt is entirely in staticParts.identity
  const systemContent = staticParts.identity;

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
  const p = context.profile;
  const sections: string[] = [];

  sections.push(`Student: ${p.preferred_name || p.full_name || "new"}`);
  if (p.current_level) sections.push(`Level: ${p.current_level}`);
  
  const goals = formatGoals(p.goals);
  if (goals) sections.push(`Goals: ${goals}`);
  
  if (p.learning_style?.primary) sections.push(`Learning style: ${p.learning_style.primary}`);
  if (p.pace) sections.push(`Pace: ${p.pace}`);

  if (context.relevantConcepts && context.relevantConcepts.length > 0) {
    const concepts = context.relevantConcepts
      .map((c: any) => `${c.name} (${c.subject}): ${Math.round(c.mastery_score * 100)}%`)
      .join(", ");
    sections.push(`Concepts: ${concepts}`);
  }

  if (context.relevantNotes && context.relevantNotes.length > 0) {
    const notes = context.relevantNotes
      .map((n: any) => `[${n.category}] ${n.note_text}`)
      .join("; ");
    sections.push(`Notes: ${notes}`);
  }

  if (context.engagement && context.engagement.label !== "unknown") {
    sections.push(`Engagement: ${context.engagement.label}`);
  }

  return sections.join("\n");
}

function formatGoals(goals: StudentProfile["goals"]): string {
  if (!goals || !Array.isArray(goals) || goals.length === 0) return "";
  return goals.map((g: any) => `${g.subject} for ${g.target}${g.exam_date ? ` (exam: ${g.exam_date})` : ""}`).join(", ");
}
