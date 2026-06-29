import { config } from "../config";
import { StudentProfile } from "../memory/profile";
import { readFileSync } from "fs";
import { join } from "path";

export function buildStaticPromptParts(profile: StudentProfile): {
  identity: string;
  mission: string;
  capabilities: string;
  rules: string;
  conversational: string;
} {
  const tutorName = profile.tutor_persona?.tutor_name || config.tutor.defaultName;
  const studentName = profile.preferred_name || profile.full_name || "the student";
  const duration = profile.first_seen_at ? humanizeDuration(profile.first_seen_at) : "this is your first conversation with them";

  // Load the full v4.0 prompt from file
  const promptPath = join(__dirname, "../../prompts/wax-prompt.md");
  let fullPrompt: string;

  try {
    fullPrompt = readFileSync(promptPath, "utf-8");
  } catch (e) {
    console.error("Failed to load v4.0 prompt. Falling back to v3.0.");
    fullPrompt = buildFallbackPrompt(tutorName, studentName, duration);
  }

  // Inject student-specific context into the prompt
  const personalizedPrompt = fullPrompt
    .replace(/\{\{STUDENT_NAME\}\}/g, studentName)
    .replace(/\{\{TUTOR_NAME\}\}/g, tutorName)
    .replace(/\{\{DURATION\}\}/g, duration);

  // Split into sections for the context bundle
  // The full prompt is sent as the system message
  // These sections are for backward compatibility with existing code
  const identity = extractSection(personalizedPrompt, "CORE IDENTITY");
  const mission = extractSection(personalizedPrompt, "TEACHING PHILOSOPHY");
  const capabilities = extractSection(personalizedPrompt, "TOOLS");
  const rules = extractSection(personalizedPrompt, "META-INSTRUCTION");
  const conversational = extractSection(personalizedPrompt, "CONVERSATION ARCHITECTURE");

  return { identity, mission, capabilities, rules, conversational };
}

/**
 * Build the complete system prompt for the LLM.
 * This is what gets sent to Cerebras/Groq on every message.
 */
export function buildSystemPrompt(
  profile: StudentProfile,
  contextBundle: any
): string {
  const tutorName = profile.tutor_persona?.tutor_name || config.tutor.defaultName;
  const studentName = profile.preferred_name || profile.full_name || "the student";
  const duration = profile.first_seen_at ? humanizeDuration(profile.first_seen_at) : "this is your first conversation";

  // Load the full v4.0 prompt
  const promptPath = join(__dirname, "../../prompts/wax-prompt.md");
  let fullPrompt: string;

  try {
    fullPrompt = readFileSync(promptPath, "utf-8");
  } catch (e) {
    console.error("Failed to load v4.0 prompt. Using fallback.");
    fullPrompt = buildFallbackPrompt(tutorName, studentName, duration);
  }

  // Inject dynamic context
  const dynamicContext = buildDynamicContext(profile, contextBundle);

  // Insert dynamic context after the Core Identity section
  const promptWithContext = fullPrompt.replace(
    /(# CORE IDENTITY — WHO YOU ARE[\s\S]*?)(# TEACHING PHILOSOPHY)/,
    `$1\n\n# DYNAMIC CONTEXT — WHAT YOU KNOW RIGHT NOW\n${dynamicContext}\n\n$2`
  );

  return promptWithContext;
}

/**
 * Build dynamic context from the context bundle.
 * This tells the AI what it knows about the student RIGHT NOW.
 */
function buildDynamicContext(profile: StudentProfile, contextBundle: any): string {
  const parts: string[] = [];

  // Student basics
  if (profile.preferred_name) {
    parts.push(`The student's name is ${profile.preferred_name}.`);
  }
  if (profile.exam_preparing_for) {
    parts.push(`They are preparing for ${profile.exam_preparing_for}.`);
  }
  if (profile.subjects && profile.subjects.length > 0) {
    parts.push(`Their subjects: ${profile.subjects.join(", ")}.`);
  }
  if (profile.level) {
    parts.push(`Their level: ${profile.level}.`);
  }

  // Teaching signature (procedural rules)
  if (contextBundle.proceduralRules && contextBundle.proceduralRules.length > 0) {
    parts.push(`\nTEACHING SIGNATURE (how this student learns best):`);
    contextBundle.proceduralRules.forEach((rule: any) => {
      parts.push(`- ${rule.rule_text}`);
    });
  }

  // Relational notes (personal details)
  if (contextBundle.relationalNotes && contextBundle.relationalNotes.length > 0) {
    parts.push(`\nPERSONAL DETAILS (remember these naturally):`);
    contextBundle.relationalNotes.forEach((note: any) => {
      parts.push(`- ${note.note_text}`);
    });
  }

  // Recent episodes (conversation history)
  if (contextBundle.recentEpisodes && contextBundle.recentEpisodes.length > 0) {
    parts.push(`\nRECENT CONVERSATIONS:`);
    contextBundle.recentEpisodes.forEach((ep: any) => {
      parts.push(`- ${ep.summary}`);
    });
  }

  // Relevant concepts
  if (contextBundle.relevantConcepts && contextBundle.relevantConcepts.length > 0) {
    parts.push(`\nCONCEPTS THEY KNOW:`);
    contextBundle.relevantConcepts.forEach((concept: any) => {
      const mastery = Math.round((concept.mastery || 0) * 100);
      parts.push(`- ${concept.name}: ${mastery}% mastery`);
    });
  }

  // Engagement signal
  if (contextBundle.engagementSignal) {
    parts.push(`\nCURRENT STATE: ${contextBundle.engagementSignal}`);
  }

  return parts.join("\n");
}

/**
 * Extract a section from the prompt by header.
 */
function extractSection(prompt: string, sectionName: string): string {
  const regex = new RegExp(`# ${sectionName}[\s\S]*?(?=# [A-Z]|\Z)`);
  const match = prompt.match(regex);
  return match ? match[0].trim() : "";
}

/**
 * Fallback prompt if v4.0 file is missing.
 */
function buildFallbackPrompt(tutorName: string, studentName: string, duration: string): string {
  return `You are ${tutorName}, a personal AI tutor for Nigerian students.
You have been tutoring ${studentName} for ${duration}.
Teach naturally. Be real. Use Nigerian context. Never sound like a robot.`;
}

function humanizeDuration(firstSeenAt: string): string {
  const first = new Date(firstSeenAt);
  const now = new Date();
  const days = Math.floor((now.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return "this is your first conversation";
  if (days < 7) return `${days} days`;
  if (days < 30) return `${Math.floor(days / 7)} weeks`;
  if (days < 365) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}
