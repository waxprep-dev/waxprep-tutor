import { ToolCall } from "../llm/types";
import { logger } from "../utils/logger";
import * as profile from "../memory/profile";
import * as episodes from "../memory/episodes";
import * as concepts from "../memory/concepts";
import * as procedural from "../memory/procedural";
import * as relational from "../memory/relational";
import { embed } from "../memory/embeddings";
import { changePhoneNumber } from "../identity/waxId";
import { recordConsent } from "../identity/consent";
import * as difficulty from "../interactive/difficulty";
import * as quiz from "../interactive/quiz";
import * as topicPicker from "../interactive/topicPicker";
import { sendButtonMessage } from "../whatsapp/interactive";

export async function executeTool(
  toolCall: ToolCall,
  context: { phone: string; episodeId: string }
): Promise<{ tool_call_id: string; result: string }> {
  const args = JSON.parse(toolCall.function.arguments);

  try {
    let result: any;

    switch (toolCall.function.name) {
      case "get_student_profile": {
        const p = await profile.getProfile(context.phone);
        result = p;
        break;
      }

      case "update_profile": {
        await profile.updateProfile(context.phone, args.updates);
        result = { success: true, updated_fields: Object.keys(args.updates) };
        break;
      }

      case "search_past_conversations": {
        const queryEmbedding = await embed(args.query);
        if (!queryEmbedding) {
          result = { success: false, message: "Semantic search is temporarily unavailable." };
          break;
        }
        const results = await episodes.searchEpisodes(
          context.phone,
          queryEmbedding,
          args.top_k || 5
        );
        result = results;
        break;
      }

      case "get_or_create_concept": {
        const c = await concepts.getOrCreateConcept(
          context.phone,
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
          context.phone,
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
          context.phone,
          args.category,
          args.note_text,
          args.emotional_sensitivity || "low"
        );
        result = { success: true };
        break;
      }

      case "end_episode": {
        await episodes.endEpisode(args.episode_id, args.summary, args.key_moments || []);
        const embedding = await embed(args.summary);
        if (embedding) {
          await episodes.storeEpisodeEmbedding(
            args.episode_id,
            context.phone,
            embedding,
            args.summary
          );
        }
        result = { success: true };
        break;
      }

      case "schedule_review": {
        await concepts.scheduleReview(args.concept_id, context.phone, args.days_from_now);
        result = { success: true, scheduled_for_days: args.days_from_now };
        break;
      }

      case "change_student_phone": {
        await changePhoneNumber(args.wax_id, args.old_phone, args.new_phone);
        result = { success: true, message: "Phone number updated. Student's memory is preserved." };
        break;
      }

      case "record_consent": {
        await recordConsent(args.wax_id, {
          data_retention_consent: args.data_retention_consent,
          cross_platform_sync_consent: args.cross_platform_sync_consent,
          parental_consent_for_minor: args.parental_consent_for_minor || false,
          consent_method: args.consent_method,
        });
        result = { success: true };
        break;
      }

      case "send_difficulty_check": {
        const conceptId = args.concept_id;
        const sendResult = await difficulty.sendDifficultyCheck(
          context.phone,
          conceptId,
          args.concept_name,
          args.follow_up_message || ""
        );
        result = { success: true, message_id: sendResult.message_id };
        break;
      }

      case "send_quiz_question": {
        const options = args.options.map((label: string, i: number) => ({
          id: `opt_${i}`,
          label,
        }));
        const quizResult = await quiz.sendQuiz(
          context.phone,
          args.question,
          options,
          args.correct_index,
          args.concept_id,
          args.context
        );
        result = { success: true, quiz_id: quizResult.quiz_id, message_id: quizResult.message_id };
        break;
      }

      case "send_topic_picker": {
        const sections = args.sections.map((s: any) => ({
          title: s.title,
          topics: s.topics,
        }));
        const pickerResult = await topicPicker.sendTopicPicker(context.phone, args.prompt, sections);
        result = { success: true, message_id: pickerResult.message_id };
        break;
      }

      case "send_concept_card": {
        await sendButtonMessage(context.phone, `📘 *${args.name}*\n\n${args.description}`, [
          { id: `concept:teach:${args.concept_id}`, title: "Teach me" },
          { id: `concept:quiz:${args.concept_id}`, title: "Quiz me" },
          { id: `concept:skip:${args.concept_id}`, title: "Skip for now" },
        ], { header: args.subject, footer: "Tap to get started" });
        result = { success: true };
        break;
      }

      case "send_quick_replies": {
        const clampedOptions = args.options.slice(0, 3);
        const buttons = clampedOptions.map((o: any) => ({ id: `quick:${o.id}`, title: o.title }));
        const sendResult = await sendButtonMessage(context.phone, args.body, buttons, {
          footer: args.footer || "Or just type your own answer",
        });
        result = { success: true, message_id: sendResult.message_id };
        break;
      }

      case "generate_concept_image": {
        result = { success: false, message: "Image generation is a v2 feature. Not yet available." };
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
