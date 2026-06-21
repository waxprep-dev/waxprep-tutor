import { query } from "../db/client";

export interface RelationalNote {
  note_id: string;
  student_phone: string;
  category: string;
  note_text: string;
  emotional_sensitivity: "low" | "medium" | "high";
  mentioned_at: string;
  last_referenced_at: string | null;
}

/**
 * Add a personal detail about a student.
 * Example: "Wants to study engineering at UNILAG."
 */
export async function addNote(
  phone: string,
  category: string,
  noteText: string,
  emotionalSensitivity: "low" | "medium" | "high" = "low"
): Promise<void> {
  await query(
    `INSERT INTO relational_notes (student_phone, category, note_text, emotional_sensitivity)
     VALUES ($1, $2, $3, $4)`,
    [phone, category, noteText, emotionalSensitivity]
  );
}

export async function getRecentNotes(phone: string, limit: number = 20): Promise<RelationalNote[]> {
  return query<RelationalNote>(
    `SELECT * FROM relational_notes
     WHERE student_phone = $1
     ORDER BY mentioned_at DESC
     LIMIT $2`,
    [phone, limit]
  );
}

export async function searchNotes(phone: string, queryText: string, limit: number = 5): Promise<RelationalNote[]> {
  return query<RelationalNote>(
    `SELECT * FROM relational_notes
     WHERE student_phone = $1 AND LOWER(note_text) LIKE LOWER($2)
     ORDER BY mentioned_at DESC
     LIMIT $3`,
    [phone, `%${queryText}%`, limit]
  );
}
