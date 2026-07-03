import { ToolCall } from "../llm/types";
import { logger } from "../utils/logger";

export async function executeTool(
  toolCall: ToolCall,
  context: { phone: string; episodeId: string }
): Promise<string> {
  try {
    const toolName = toolCall.function.name;
    let args: any = {};

    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch (e) {
      logger.warn("Failed to parse tool arguments", { toolName, args: toolCall.function.arguments });
    }

    logger.info("Executing tool", { toolName, phone: context.phone });

    // Basic tool implementation
    switch (toolName) {
      case "get_student_profile":
        return JSON.stringify({ profile: "Student profile data", phone: context.phone });
      case "update_profile":
        return JSON.stringify({ success: true, message: "Profile updated" });
      case "search_past_conversations":
        return JSON.stringify({ results: [], message: "Search results" });
      case "get_or_create_concept":
        return JSON.stringify({ concept: args.name || "unknown", mastery: 0.5 });
      case "update_concept_mastery":
        return JSON.stringify({ success: true, concept: args.concept_id, mastery: args.new_score });
      case "add_procedural_rule":
        return JSON.stringify({ success: true, rule: args.rule_text });
      case "add_relational_note":
        return JSON.stringify({ success: true, note: args.note_text });
      default:
        return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (error: any) {
    logger.error("Tool execution failed", { error: error.message, tool: toolCall.function.name });
    return JSON.stringify({ success: false, error: error.message });
  }
}

export { ToolCall };
