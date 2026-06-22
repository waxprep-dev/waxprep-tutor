import { query, queryOne } from "../db/client";

export interface Concept {
  concept_id: string;
  student_phone: string;
  name: string;
  subject: string;
  description: string | null;
  mastery_score: number;
  mastery_history: any[];
  first_seen: string;
  last_reviewed: string | null;
  review_count: number;
  common_misconceptions: string[];
  examples_used: string[];
  prerequisite_ids: string[];
  related_ids: string[];
}

export async function getOrCreateConcept(
  phone: string,
  name: string,
  subject: string,
  description?: string
): Promise<Concept> {
  const existing = await queryOne<Concept>(
    `SELECT * FROM concepts WHERE student_phone = $1 AND LOWER(name) = LOWER($2) AND LOWER(subject) = LOWER($3)`,
    [phone, name, subject]
  );
  if (existing) return existing;

  const created = await queryOne<Concept>(
    `INSERT INTO concepts (student_phone, name, subject, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [phone, name, subject, description || null]
  );
  return created!;
}

export async function updateMastery(
  conceptId: string,
  newScore: number,
  evidence: string
): Promise<void> {
  const clamped = Math.max(0, Math.min(1, newScore));
  await query(
    `UPDATE concepts
     SET mastery_score = $1,
         mastery_history = mastery_history || $2::jsonb,
         last_reviewed = NOW(),
         review_count = review_count + 1
     WHERE concept_id = $3`,
    [clamped, JSON.stringify([{ at: new Date().toISOString(), score: clamped, evidence }]), conceptId]
  );
}

export async function recordMisconception(conceptId: string, misconception: string): Promise<void> {
  await query(
    `UPDATE concepts
     SET common_misconceptions = ARRAY(SELECT DISTINCT unnest(common_misconceptions || $1::text[]))
     WHERE concept_id = $2`,
    [[misconception], conceptId]
  );
}

export async function recordExample(conceptId: string, example: string): Promise<void> {
  await query(
    `UPDATE concepts
     SET examples_used = ARRAY(SELECT DISTINCT unnest(examples_used || $1::text[]))
     WHERE concept_id = $2`,
    [[example], conceptId]
  );
}

/**
 * Get concepts relevant to a set of keywords pulled straight from the
 * student's message. No subject whitelist — this matches against
 * whatever subject/name the AI itself saved when it called
 * get_or_create_concept, so it works for Yoruba, Further Maths, Agric
 * Science, or anything else, automatically.
 */
export async function getRelevantConcepts(
  phone: string,
  keywords: string[],
  limit: number = 5
): Promise<Concept[]> {
  if (keywords.length === 0) {
    return query<Concept>(
      `SELECT * FROM concepts
       WHERE student_phone = $1
       ORDER BY mastery_score ASC, last_reviewed ASC NULLS FIRST
       LIMIT $2`,
      [phone, limit]
    );
  }

  const patterns = keywords.map((k) => `%${k}%`);
  return query<Concept>(
    `SELECT * FROM concepts
     WHERE student_phone = $1
       AND (
         LOWER(name) LIKE ANY($2)
         OR LOWER(COALESCE(description, '')) LIKE ANY($2)
         OR LOWER(subject) LIKE ANY($2)
       )
     ORDER BY last_reviewed DESC NULLS LAST
     LIMIT $3`,
    [phone, patterns, limit]
  );
}

export async function getConcept(conceptId: string): Promise<Concept | null> {
  return queryOne<Concept>(`SELECT * FROM concepts WHERE concept_id = $1`, [conceptId]);
}

export async function scheduleReview(conceptId: string, phone: string, daysFromNow: number): Promise<void> {
  await query(
    `INSERT INTO review_queue (concept_id, student_phone, scheduled_for)
     VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`,
    [conceptId, phone, daysFromNow.toString()]
  );
}

export async function getDueReviews(phone: string): Promise<any[]> {
  return query(
    `SELECT rq.*, c.name as concept_name, c.subject, c.mastery_score
     FROM review_queue rq
     JOIN concepts c ON c.concept_id = rq.concept_id
     WHERE rq.student_phone = $1
       AND rq.completed = FALSE
       AND rq.scheduled_for <= NOW()
     ORDER BY rq.scheduled_for ASC
     LIMIT 5`,
    [phone]
  );
}
