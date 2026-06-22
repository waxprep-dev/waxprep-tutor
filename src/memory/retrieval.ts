import { getProfile, StudentProfile } from "./profile";
import { getRecentEpisodes, searchEpisodes, Episode } from "./episodes";
import { getRelevantConcepts, Concept } from "./concepts";
import { getRules, ProceduralRule } from "./procedural";
import { getRecentNotes, searchNotes, RelationalNote } from "./relational";
import { embed } from "./embeddings";
import { estimateTokens } from "../llm/tokenCounter";

export interface ContextBundle {
  wax_id?: string;
  profile: StudentProfile;
  recentEpisodes: Episode[];
  relevantEpisodes: Array<{ summary_text: string; similarity: number; summary: string; key_moments: any[]; ended_at: string }>;
  relevantConcepts: Concept[];
  relevantRules: ProceduralRule[];
  relevantNotes: RelationalNote[];
  tokenEstimate: number;
}

export async function assembleContext(
  phone: string,
  currentMessage: string,
  waxId?: string
): Promise<ContextBundle> {
  const profile = await getProfile(phone);

  const recentEpisodes = await getRecentEpisodes(phone, 3);

  const queryEmbedding = await embed(currentMessage);
  const relevantEpisodes = await searchEpisodes(phone, queryEmbedding, 5);

  const topicGuess = extractTopic(currentMessage);
  const relevantConcepts = await getRelevantConcepts(phone, topicGuess, 5);

  const relevantRules = await getRules(phone, 10);

  const searchedNotes = await searchNotes(phone, currentMessage.split(" ").slice(0, 3).join(" "), 3);
  const recentNotes = await getRecentNotes(phone, 5);
  const relevantNotes = mergeUnique(searchedNotes, recentNotes, (n) => n.note_id).slice(0, 5);

  const tokenEstimate =
    estimateTokens(JSON.stringify(profile)) +
    recentEpisodes.reduce((sum, e) => sum + estimateTokens(e.summary || ""), 0) +
    relevantEpisodes.reduce((sum, e) => sum + estimateTokens(e.summary_text), 0) +
    relevantConcepts.reduce((sum, c) => sum + estimateTokens(c.name + (c.description || "")), 0) +
    relevantRules.reduce((sum, r) => sum + estimateTokens(r.rule_text), 0) +
    relevantNotes.reduce((sum, n) => sum + estimateTokens(n.note_text), 0);

  return {
    wax_id: waxId,
    profile,
    recentEpisodes,
    relevantEpisodes,
    relevantConcepts,
    relevantRules,
    relevantNotes,
    tokenEstimate,
  };
}

function extractTopic(message: string): string {
  const subjects = [
    "math", "mathematics", "algebra", "geometry", "calculus", "trigonometry", "quadratic", "equation",
    "english", "grammar", "literature", "essay",
    "physics", "chemistry", "biology", "science",
    "history", "government", "economics", "geography",
    "yoruba", "hausa", "igbo", "french",
    "crk", "irk", "civic",
  ];
  const lower = message.toLowerCase();
  for (const s of subjects) {
    if (lower.includes(s)) return s;
  }
  const words = lower.split(/\s+/).filter((w) => w.length > 4);
  return words[0] || message.slice(0, 20);
}

function mergeUnique<T>(arr1: T[], arr2: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of [...arr1, ...arr2]) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}
