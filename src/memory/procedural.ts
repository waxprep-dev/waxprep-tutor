import { query } from "../db/client";

export interface ProceduralRule {
  rule_id: string;
  student_phone: string;
  rule_text: string;
  trigger_condition: string | null;
  evidence: string | null;
  confidence: number;
  created_at: string;
  last_validated_at: string | null;
}

/**
 * Add a procedural rule the AI has learned about this student.
 * Example: "When stuck on word problems, use Naira examples."
 */
export async function addRule(
  phone: string,
  ruleText: string,
  triggerCondition: string,
  evidence: string,
  confidence: number = 0.7
): Promise<void> {
  await query(
    `INSERT INTO procedural_rules (student_phone, rule_text, trigger_condition, evidence, confidence)
     VALUES ($1, $2, $3, $4, $5)`,
    [phone, ruleText, triggerCondition, evidence, confidence]
  );
}

export async function getRules(phone: string, limit: number = 20): Promise<ProceduralRule[]> {
  return query<ProceduralRule>(
    `SELECT * FROM procedural_rules
     WHERE student_phone = $1
     ORDER BY confidence DESC, created_at DESC
     LIMIT $2`,
    [phone, limit]
  );
}
