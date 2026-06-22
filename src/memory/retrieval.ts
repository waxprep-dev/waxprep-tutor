import { getProfile, StudentProfile } from "./profile";
import { getRecentEpisodes, searchEpisodes, Episode } from "./episodes";
import { getRelevantConcepts, Concept } from "./concepts";
import { getRules, ProceduralRule } from "./procedural";
import { getRecentNotes, searchNotes, RelationalNote } from "./relational";
import { embed } from "./embeddings";
import { estimateTokens } from "../llm/tokenCounter";
import { query } from "../db/client";

export interface EngagementSignal {
  avgRecentMessageLength: number | null;
  shortReplyStreak: number;
  label: "normal" | "low_effort" | "unknown";
}

export interface ContextBundle {
  wax_id?: string;
  profile: StudentProfile;
  recentEpisodes: Episode[];
  relevantEpisodes: Array<{ summary_text: string; similarity: number; summary: string; key_moments: any[]; ended_at: string }>;
  relevantConcepts: Concept[];
  relevantRules: ProceduralRule[];
  relevantNotes: RelationalNote[];
  engagement: EngagementSignal;
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
  const relevantEpisodes = queryEmbedding
    ? await searchEpisodes(phone, queryEmbedding, 5)
    : [];

  const keywords = extractKeywords(currentMessage);
  const relevantConcepts = await getRelevantConcepts(phone, keywords, 5);

  const relevantRules = await getRules(phone, 10);

  const searchedNotes = await searchNotes(phone, currentMessage.split(" ").slice(0, 3).join(" "), 3);
  const recentNotes = await getRecentNotes(phone, 5);
  const relevantNotes = mergeUnique(searchedNotes, recentNotes, (n) => n.note_id).slice(0, 5);

  const engagement = await getEngagementSignal(phone);

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
    engagement,
    tokenEstimate,
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in",
  "on", "at", "for", "and", "or", "but", "with", "this", "that", "these", "those", "i",
  "you", "he", "she", "it", "we", "they", "me", "my", "your", "his", "her", "its", "our",
  "their", "what", "when", "where", "why", "how", "do", "does", "did", "can", "could",
  "will", "would", "should", "please", "just", "like", "want", "know", "help", "explain",
  "now", "okay", "ok", "yes", "no", "thanks", "abeg", "sha",
]);

function extractKeywords(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9'-]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

async function getEngagementSignal(phone: string): Promise<EngagementSignal> {
  const rows = await query<{ raw_text: string }>(
    `SELECT raw_text FROM message_log
     WHERE student_phone = $1 AND direction = 'inbound'
     ORDER BY timestamp DESC
     LIMIT 5`,
    [phone]
  );

  if (rows.length === 0) {
    return { avgRecentMessageLength: null, shortReplyStreak: 0, label: "unknown" };
  }

  const lengths = rows.map((r) => r.raw_text.trim().length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;

  let streak = 0;
  for (const r of rows) {
    const wordCount = r.raw_text.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount <= 3) streak++;
    else break;
  }

  return {
    avgRecentMessageLength: avg,
    shortReplyStreak: streak,
    label: streak >= 2 ? "low_effort" : "normal",
  };
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
