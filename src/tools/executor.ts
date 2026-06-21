import { ToolCall } from "../llm/types";
import { logger } from "../utils/logger";
import * as profile from "../memory/profile";
import * as episodes from "../memory/episodes";
import * as concepts from "../memory/concepts";
import * as procedural from "../memory/procedural";
import * as relational from "../memory/relational";
import { embed } from "../memory/embeddings";

/**
 * Executes a tool call the AI has requested.
 * Each tool has its own function here. The AI never executes these directly —
 * it returns tool_calls, and we run them and feed results back.
 */

export async function executeTool(
  toolCall: ToolCall,
  context: { phone: string; episodeId: string }
): Promise<{ tool_call_id: string; result: string }> {
  const args = JSON.parse(toolCall.function.arguments);

  try {
    let result: any;

    switch (toolCall.function.name) {
      case "get_student_profile": {
        const p = await profile.getProfile(args.phone);
        result = p;
        break;
      }

      case "update_profile": {
        await profile.updateProfile(args.phone, args.updates);
        result = { success: true, updated_fields: Object.keys(args.updates) };
        break;
      }

      case "search_past_conversations": {
        const queryEmbedding = await embed(args.query);
        const results = await episodes.searchEpisodes(
          args.phone,
          queryEmbedding,
          args.top_k || 5
        );
        result = results;
        break;
      }

      case "get_or_create_concept": {
        const c = await concepts.getOrCreateConcept(
          args.phone,
          args.name,
          args.subject,
          args.description
        );
        result = c;
        break;
      }

      case "update_concept_mastery": {
        await concepts.updateMastery(args.concept_id, args.new_score, args.evidence);
        result = { success: true, new_score: args.new_score };
        break;
      }

      case "record_misconception": {
        await concepts.recordMisconception(args.concept_id, args.misconception);
        result = { success: true };
        break;
      }

      case "add_procedural_rule": {
        await procedural.addRule(
          args.phone,
          args.rule_text,
          args.trigger_condition,
          args.evidence,
          args.confidence || 0.7
        );
        result = { success: true };
        break;
      }

      case "add_relational_note": {
        await relational.addNote(
          args.phone,
          args.category,
          args.note_text,
          args.emotional_sensitivity || "low"
        );
        result = { success: true };
        break;
      }

      case "end_episode": {
        await episodes.endEpisode(args.episode_id, args.summary, args.key_moments || []);
        // Also embed the summary for future semantic search
        const embedding = await embed(args.summary);
        await episodes.storeEpisodeEmbedding(
          args.episode_id,
          context.phone,
          embedding,
          args.summary
        );
        result = { success: true };
        break;
      }

      case "schedule_review": {
        await concepts.scheduleReview(args.concept_id, context.phone, args.days_from_now);
        result = { success: true, scheduled_for_days: args.days_from_now };
        break;
      }

      default:
        result = { error: `Unknown tool: ${toolCall.function.name}` };
    }

    return {
      tool_call_id: toolCall.id,
      result: typeof result === "string" ? result : JSON.stringify(result),
    };
  } catch (err: any) {
    logger.error("Tool execution failed", {
      tool: toolCall.function.name,
      error: err.message,
    });
    return {
      tool_call_id: toolCall.id,
      result: JSON.stringify({ error: err.message }),
    };
  }
}
