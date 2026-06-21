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

/**
 * Get or create a concept for a student. If they encounter "Quadratic Equations"
 * for the first time, this creates the record at mastery 0.0.
 */
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

/**
 * Update mastery based on student performance. Called by AI via tool.
 */
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
 * Get concepts relevant to a topic. Used for context assembly.
 */
export async function getRelevantConcepts(
  phone: string,
  topic: string,
  limit: number = 5
): Promise<Concept[]> {
  // Simple approach: get all concepts for student, filter by name match
  // For v1 this is fine. For scale, use embeddings or full-text search.
  return query<Concept>(
    `SELECT * FROM concepts
     WHERE student_phone = $1
       AND (LOWER(name) LIKE LOWER($2) OR LOWER(description) LIKE LOWER($2))
     ORDER BY last_reviewed DESC NULLS LAST
     LIMIT $3`,
    [phone, `%${topic}%`, limit]
  );
}

export async function getConcept(conceptId: string): Promise<Concept | null> {
  return queryOne<Concept>(`SELECT * FROM concepts WHERE concept_id = $1`, [conceptId]);
}

/**
 * Schedule a spaced-repetition review.
 */
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
