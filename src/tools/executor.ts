import { ToolCall } from "../llm/types";
import { logger } from "../utils/logger";
import { withTransaction } from "../db/client";

import { getProfile, updateProfile } from "../memory/profile";
import { getOrCreateConcept, updateMastery, recordMisconception, scheduleReview } from "../memory/concepts";
import { addRule } from "../memory/procedural";
import { addNote } from "../memory/relational";
import { searchEpisodes, getRecentEpisodes } from "../memory/episodes";
import { embed } from "../memory/embeddings";

export interface ToolContext {
  phone: string;
  episodeId: string;
  waxId?: string;
}

export async function executeTool(
  toolCall: ToolCall,
  context: ToolContext
): Promise<string> {
  const toolName = toolCall.function.name;
  let args: any = {};

  try {
    args = JSON.parse(toolCall.function.arguments || "{}");
  } catch (e) {
    logger.warn("Failed to parse tool arguments", { toolName, args: toolCall.function.arguments });
    return JSON.stringify({ success: false, error: "Invalid JSON arguments" });
  }

  logger.info("Executing tool", { toolName, phone: context.phone });

  try {
    const result = await executeToolInternal(toolName, args, context);
    return JSON.stringify(result);
  } catch (error: any) {
    logger.error("Tool execution failed", { error: error.message, tool: toolName, phone: context.phone });
    return JSON.stringify({ success: false, error: error.message, tool: toolName });
  }
}

async function executeToolInternal(
  toolName: string,
  args: any,
  ctx: ToolContext
): Promise<any> {
  switch (toolName) {
    case "get_student_profile": {
      const profile = await getProfile(ctx.phone);
      return { success: true, profile, source: "database" };
    }

    case "update_profile": {
      const { updates } = args;
      if (!updates || typeof updates !== "object") {
        return { success: false, error: "Missing or invalid 'updates' object" };
      }

      const ALLOWED_FIELDS = new Set([
        "full_name", "preferred_name", "age", "city", "state",
        "current_level", "school_type", "preferred_language",
        "formality", "uses_code_switching", "pace", "confidence_baseline", "tutor_name"
      ]);

      const sanitized: any = {};
      for (const [key, value] of Object.entries(updates)) {
        if (ALLOWED_FIELDS.has(key)) {
          sanitized[key] = value;
        }
      }

      await updateProfile(ctx.phone, sanitized);
      return { success: true, message: "Profile updated", updatedFields: Object.keys(sanitized) };
    }

    case "search_past_conversations": {
      const { query: searchQuery, top_k = 5 } = args;
      if (!searchQuery || typeof searchQuery !== "string") {
        return { success: false, error: "Missing 'query' parameter" };
      }

      const queryEmbedding = await embed(searchQuery);
      const results = queryEmbedding.length > 0
        ? await searchEpisodes(ctx.phone, queryEmbedding, Math.min(top_k, 10))
        : await getRecentEpisodes(ctx.phone, Math.min(top_k, 10));

      return {
        success: true,
        query: searchQuery,
        resultCount: results.length,
        results: results.map((r: any) => ({
          summary: r.summary_text || r.summary,
          similarity: r.similarity,
          keyMoments: r.key_moments || [],
          endedAt: r.ended_at
        }))
      };
    }

    case "get_or_create_concept": {
      const { name, subject, description } = args;
      if (!name || !subject) {
        return { success: false, error: "Missing 'name' or 'subject' parameter" };
      }

      const concept = await getOrCreateConcept(ctx.phone, name, subject, description);
      return {
        success: true,
        concept: {
          concept_id: concept.concept_id,
          name: concept.name,
          subject: concept.subject,
          description: concept.description,
          mastery_score: concept.mastery_score,
          review_count: concept.review_count,
          common_misconceptions: concept.common_misconceptions || [],
          examples_used: concept.examples_used || [],
          prerequisite_ids: concept.prerequisite_ids || [],
          related_ids: concept.related_ids || []
        },
        isNew: concept.review_count === 0 && concept.mastery_score === 0
      };
    }

    case "update_concept_mastery": {
      const { concept_id, new_score, evidence } = args;
      if (!concept_id || typeof new_score !== "number") {
        return { success: false, error: "Missing 'concept_id' or 'new_score'" };
      }

      const clampedScore = Math.max(0, Math.min(1, new_score));
      await updateMastery(concept_id, clampedScore, evidence || "Updated via tool call");

      return { success: true, concept_id, new_score: clampedScore, evidence: evidence || null };
    }

    case "record_misconception": {
      const { concept_id, misconception } = args;
      if (!concept_id || !misconception) {
        return { success: false, error: "Missing 'concept_id' or 'misconception'" };
      }

      await recordMisconception(concept_id, misconception);
      return { success: true, concept_id, misconception, message: "Misconception recorded" };
    }

    case "add_procedural_rule": {
      const { rule_text, trigger_condition, evidence, confidence = 0.7 } = args;
      if (!rule_text || !trigger_condition) {
        return { success: false, error: "Missing 'rule_text' or 'trigger_condition'" };
      }

      await addRule(
        ctx.phone,
        rule_text,
        trigger_condition,
        evidence || "Added via tool call",
        Math.max(0, Math.min(1, confidence))
      );

      return { success: true, rule: rule_text, trigger: trigger_condition, confidence: Math.max(0, Math.min(1, confidence)) };
    }

    case "add_relational_note": {
      const { category, note_text, emotional_sensitivity = "low" } = args;
      if (!category || !note_text) {
        return { success: false, error: "Missing 'category' or 'note_text'" };
      }

      const validCategories = ["family", "friends", "aspirations", "hobbies", "emotional", "health", "significant_events", "introduction", "other"];
      if (!validCategories.includes(category)) {
        return { success: false, error: `Invalid category. Must be one of: ${validCategories.join(", ")}` };
      }

      await addNote(ctx.phone, category, note_text, emotional_sensitivity);
      return { success: true, category, note: note_text, emotional_sensitivity };
    }

    case "end_episode": {
      const { episode_id, summary, key_moments = [] } = args;
      if (!episode_id || !summary) {
        return { success: false, error: "Missing 'episode_id' or 'summary'" };
      }

      const { query } = await import("../db/client");
      await query(
        `UPDATE episodes 
         SET ended_at = NOW(), 
             summary = $1, 
             key_moments = $2::jsonb,
             message_count = (SELECT COUNT(*) FROM message_log WHERE episode_id = $3)
         WHERE episode_id = $3 AND student_phone = $4`,
        [summary, JSON.stringify(key_moments), episode_id, ctx.phone]
      );

      return { success: true, episode_id, summary, keyMoments: key_moments.length };
    }

    case "schedule_review": {
      const { concept_id, days_from_now } = args;
      if (!concept_id || typeof days_from_now !== "number") {
        return { success: false, error: "Missing 'concept_id' or 'days_from_now'" };
      }

      await scheduleReview(concept_id, ctx.phone, Math.max(1, Math.round(days_from_now)));
      return { success: true, concept_id, scheduledForDays: Math.max(1, Math.round(days_from_now)) };
    }

    case "change_student_phone": {
      const { old_phone, new_phone, wax_id, verification_notes } = args;
      if (!old_phone || !new_phone || !wax_id) {
        return { success: false, error: "Missing required phone change parameters" };
      }

      await withTransaction(async (client) => {
        const verifyResult = await client.query(
          `SELECT wax_id FROM students WHERE phone = $1`,
          [old_phone]
        );
        if (verifyResult.rows.length === 0 || verifyResult.rows[0].wax_id !== wax_id) {
          throw new Error("WAX ID verification failed");
        }

        const existing = await client.query(
          `SELECT phone FROM students WHERE phone = $1`,
          [new_phone]
        );
        if (existing.rows.length > 0) {
          throw new Error("New phone number already registered");
        }

        await client.query(`UPDATE students SET phone = $1 WHERE phone = $2`, [new_phone, old_phone]);
        await client.query(`UPDATE episodes SET student_phone = $1 WHERE student_phone = $2`, [new_phone, old_phone]);
        await client.query(`UPDATE concepts SET student_phone = $1 WHERE student_phone = $2`, [new_phone, old_phone]);
        await client.query(`UPDATE procedural_rules SET student_phone = $1 WHERE student_phone = $2`, [new_phone, old_phone]);
        await client.query(`UPDATE relational_notes SET student_phone = $1 WHERE student_phone = $2`, [new_phone, old_phone]);
        await client.query(`UPDATE message_log SET student_phone = $1 WHERE student_phone = $2`, [new_phone, old_phone]);
        await client.query(`UPDATE review_queue SET student_phone = $1 WHERE student_phone = $2`, [new_phone, old_phone]);
        await client.query(`UPDATE safety_incidents SET student_phone = $1 WHERE student_phone = $2`, [new_phone, old_phone]);
      });

      return { success: true, old_phone, new_phone, wax_id, verification_notes: verification_notes || null };
    }

    case "record_consent": {
      const { wax_id, data_retention_consent, cross_platform_sync_consent, parental_consent_for_minor, consent_method } = args;
      if (!wax_id || typeof data_retention_consent !== "boolean" || typeof cross_platform_sync_consent !== "boolean") {
        return { success: false, error: "Missing required consent parameters" };
      }

      const { query } = await import("../db/client");
      await query(
        `UPDATE students 
         SET consent_flags = consent_flags || $1::jsonb,
             consent_status = CASE 
               WHEN $2 AND $3 THEN 'full'
               WHEN $2 THEN 'partial'
               ELSE 'pending'
             END,
             consent_recorded_at = NOW()
         WHERE wax_id = $4`,
        [
          JSON.stringify({
            data_retention_consent,
            cross_platform_sync_consent,
            parental_consent_for_minor: parental_consent_for_minor || false,
            consent_method: consent_method || "unknown",
            recorded_at: new Date().toISOString()
          }),
          data_retention_consent,
          cross_platform_sync_consent,
          wax_id
        ]
      );

      return {
        success: true,
        wax_id,
        data_retention_consent,
        cross_platform_sync_consent,
        parental_consent_for_minor: parental_consent_for_minor || false,
        consent_status: data_retention_consent && cross_platform_sync_consent ? "full"
          : data_retention_consent ? "partial" : "pending"
      };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}
