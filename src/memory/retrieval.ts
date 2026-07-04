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

// ============================================================
// SAFE KEYWORD EXTRACTION (No Regex DoS)
// ============================================================
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "to", "of", "in",
  "on", "at", "for", "and", "or", "but", "with", "this", "that", "these", "those", "i",
  "you", "he", "she", "it", "we", "they", "me", "my", "your", "his", "her", "its", "our",
  "their", "what", "when", "where", "why", "how", "do", "does", "did", "can", "could",
  "will", "would", "should", "please", "just", "like", "want", "know", "help", "explain",
  "now", "okay", "ok", "yes", "no", "thanks", "abeg", "sha",
]);

function extractKeywords(message: string): string[] {
  if (!message || typeof message !== "string") return [];
  
  const MAX_LENGTH = 10000;
  const text = message.length > MAX_LENGTH ? message.slice(0, MAX_LENGTH) : message;
  
  const keywords: string[] = [];
  let currentWord = "";
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i].toLowerCase();
    const code = text.charCodeAt(i);
    
    const isValid = (code >= 97 && code <= 122) ||
                    (code >= 48 && code <= 57) ||
                    code === 39 ||
                    code === 45;
    
    if (isValid) {
      currentWord += char;
    } else {
      if (currentWord.length > 2 && !STOPWORDS.has(currentWord)) {
        keywords.push(currentWord);
      }
      currentWord = "";
    }
  }
  
  if (currentWord.length > 2 && !STOPWORDS.has(currentWord)) {
    keywords.push(currentWord);
  }
  
  return [...new Set(keywords)];
}

export async function assembleContext(
  phone: string,
  currentMessage: string,
  waxId?: string
): Promise<ContextBundle> {
  const profile = await getProfile(phone);
  
  const recentEpisodes = await getRecentEpisodes(phone, 3);
  
  const queryEmbedding = await embed(currentMessage);
  const relevantEpisodes = queryEmbedding && Array.isArray(queryEmbedding)
    ? await searchEpisodes(phone, queryEmbedding, 5)
    : [];

  const keywords = extractKeywords(currentMessage);
  const relevantConcepts = keywords.length > 0 
    ? await getRelevantConcepts(phone, keywords, 5)
    : [];

  const relevantRules = await getRules(phone, 10);

  const searchQuery = keywords.slice(0, 5).join(" ");
  const searchedNotes = searchQuery 
    ? await searchNotes(phone, searchQuery, 3)
    : [];
    
  const recentNotes = await getRecentNotes(phone, 5);
  const relevantNotes = mergeUnique(searchedNotes, recentNotes, (n) => n.note_id).slice(0, 5);

  const engagement = await getEngagementSignal(phone);

  const TOKEN_OVERHEAD = 200;
  const tokenEstimate =
    TOKEN_OVERHEAD +
    estimateTokens(JSON.stringify(profile)) +
    recentEpisodes.reduce((sum, e) => sum + estimateTokens(e.summary || ""), 0) +
    relevantEpisodes.reduce((sum, e) => sum + estimateTokens(e.summary_text || ""), 0) +
    relevantConcepts.reduce((sum, c) => sum + estimateTokens((c.name || "") + (c.description || "")), 0) +
    relevantRules.reduce((sum, r) => sum + estimateTokens(r.rule_text || ""), 0) +
    relevantNotes.reduce((sum, n) => sum + estimateTokens(n.note_text || ""), 0);

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

  const lengths = rows.map((r) => r.raw_text?.trim().length || 0);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;

  let streak = 0;
  for (const r of rows) {
    const wordCount = r.raw_text?.trim().split(/\s+/).filter(Boolean).length || 0;
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
