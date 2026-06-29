import { ToolDefinition } from "../llm/types";

export const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_student_profile",
      description: "Get the student's full profile. Use this when you need to recall what you know about them — name, level, goals, learning style.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_profile",
      description: "Update fields in the student's profile when you learn something new about them.",
      parameters: {
        type: "object",
        properties: {
          updates: {
            type: "object",
            properties: {
              full_name: { type: "string" },
              preferred_name: { type: "string" },
              age: { type: "number" },
              city: { type: "string" },
              state: { type: "string" },
              current_level: { type: "string" },
              school_type: { type: "string" },
              preferred_language: { type: "string" },
              formality: { type: "string", enum: ["casual", "neutral", "formal"] },
              uses_code_switching: { type: "boolean" },
              pace: { type: "string", enum: ["slow", "medium", "fast", "unknown"] },
              confidence_baseline: { type: "string", enum: ["low", "medium", "high", "unknown"] },
              tutor_name: { type: "string" },
            },
          },
        },
        required: ["updates"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_past_conversations",
      description: "Search past conversations with this student by topic or meaning.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, top_k: { type: "number" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_or_create_concept",
      description: "Get mastery info for a concept, or create a new concept record.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, subject: { type: "string" }, description: { type: "string" } },
        required: ["name", "subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_concept_mastery",
      description: "Update how well the student has mastered a concept. Score is 0.0 to 1.0.",
      parameters: {
        type: "object",
        properties: { concept_id: { type: "string" }, new_score: { type: "number", minimum: 0, maximum: 1 }, evidence: { type: "string" } },
        required: ["concept_id", "new_score", "evidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_misconception",
      description: "Record a specific misconception the student has shown about a concept.",
      parameters: {
        type: "object",
        properties: { concept_id: { type: "string" }, misconception: { type: "string" } },
        required: ["concept_id", "misconception"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_procedural_rule",
      description: "Add a learning pattern you've noticed about this student.",
      parameters: {
        type: "object",
        properties: { rule_text: { type: "string" }, trigger_condition: { type: "string" }, evidence: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 } },
        required: ["rule_text", "trigger_condition", "evidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_relational_note",
      description: "Save a personal detail about the student.",
      parameters: {
        type: "object",
        properties: { category: { type: "string", enum: ["family", "friends", "aspirations", "hobbies", "emotional", "health", "significant_events", "introduction", "other"] }, note_text: { type: "string" }, emotional_sensitivity: { type: "string", enum: ["low", "medium", "high"] } },
        required: ["category", "note_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_episode",
      description: "End the current conversation episode with a summary.",
      parameters: {
        type: "object",
        properties: {
          episode_id: { type: "string" },
          summary: { type: "string" },
          key_moments: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["breakthrough", "struggle", "goal_mentioned", "personal_share", "emotional"] }, description: { type: "string" } } } },
        },
        required: ["episode_id", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_review",
      description: "Schedule a spaced-repetition review for a concept.",
      parameters: {
        type: "object",
        properties: { concept_id: { type: "string" }, days_from_now: { type: "number" } },
        required: ["concept_id", "days_from_now"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_student_phone",
      description: "Update a student's phone number while keeping their WAX ID and memory.",
      parameters: {
        type: "object",
        properties: { old_phone: { type: "string" }, new_phone: { type: "string" }, wax_id: { type: "string" }, verification_notes: { type: "string" } },
        required: ["old_phone", "new_phone", "wax_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_consent",
      description: "Record student consent for data retention and cross-platform sync.",
      parameters: {
        type: "object",
        properties: { wax_id: { type: "string" }, data_retention_consent: { type: "boolean" }, cross_platform_sync_consent: { type: "boolean" }, parental_consent_for_minor: { type: "boolean" }, consent_method: { type: "string" } },
        required: ["wax_id", "data_retention_consent", "cross_platform_sync_consent", "consent_method"],
      },
    },
];
