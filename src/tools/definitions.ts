import { ToolDefinition } from "../llm/types";

export const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_student_profile",
      description: "Get the student's full profile. Use this when you need to recall what you know about them — name, level, goals, learning style.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "The student's phone number (with country code)" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_profile",
      description: "Update fields in the student's profile when you learn something new about them — name, age, school, level, goals, learning preferences, language, etc. Only update fields you actually have new information for.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          updates: {
            type: "object",
            description: "Object with profile fields to update",
            properties: {
              full_name: { type: "string" },
              preferred_name: { type: "string" },
              age: { type: "number" },
              city: { type: "string" },
              state: { type: "string" },
              current_level: { type: "string", description: "e.g., JSS2, SSS3, Undergraduate Year 2" },
              school_type: { type: "string" },
              preferred_language: { type: "string" },
              formality: { type: "string", enum: ["casual", "neutral", "formal"] },
              uses_code_switching: { type: "boolean" },
              pace: { type: "string", enum: ["slow", "medium", "fast"] },
              confidence_baseline: { type: "string", enum: ["low", "medium", "high"] },
              tutor_name: { type: "string", description: "The name the student has given you" },
            },
          },
        },
        required: ["phone", "updates"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_past_conversations",
      description: "Search past conversations with this student by topic or meaning. Use this when you want to recall what you've discussed before.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          query: { type: "string", description: "What you're looking for" },
          top_k: { type: "number", description: "How many results to return (default 5)" },
        },
        required: ["phone", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_or_create_concept",
      description: "Get mastery info for a concept, or create a new concept record if the student is encountering it for the first time.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          name: { type: "string", description: "Concept name, e.g., 'Quadratic Equations'" },
          subject: { type: "string", description: "e.g., 'Mathematics'" },
          description: { type: "string" },
        },
        required: ["phone", "name", "subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_concept_mastery",
      description: "Update how well the student has mastered a concept. Score is 0.0 to 1.0. Provide evidence — what the student said or did that led to this score.",
      parameters: {
        type: "object",
        properties: {
          concept_id: { type: "string" },
          new_score: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "string", description: "What the student did/said to justify this score" },
        },
        required: ["concept_id", "new_score", "evidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_misconception",
      description: "Record a specific misconception the student has shown about a concept. Useful for next time.",
      parameters: {
        type: "object",
        properties: {
          concept_id: { type: "string" },
          misconception: { type: "string" },
        },
        required: ["concept_id", "misconception"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_procedural_rule",
      description: "Add a learning pattern you've noticed about this student. Example: 'When stuck on word problems, use Naira examples — works better than sports examples for this student.'",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          rule_text: { type: "string" },
          trigger_condition: { type: "string", description: "When does this rule apply?" },
          evidence: { type: "string", description: "What made you notice this pattern?" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["phone", "rule_text", "trigger_condition", "evidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_relational_note",
      description: "Save a personal detail about the student — family, friends, goals, hobbies, significant events, etc. This is what makes conversation feel human.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          category: { type: "string", enum: ["family", "friends", "aspirations", "hobbies", "emotional", "health", "significant_events", "other"] },
          note_text: { type: "string" },
          emotional_sensitivity: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["phone", "category", "note_text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "end_episode",
      description: "End the current conversation episode. Provide a 2-5 sentence summary of what happened and list any key moments (breakthroughs, struggles, things to remember).",
      parameters: {
        type: "object",
        properties: {
          episode_id: { type: "string" },
          summary: { type: "string" },
          key_moments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["breakthrough", "struggle", "goal_mentioned", "personal_share", "emotional"] },
                description: { type: "string" },
              },
            },
          },
        },
        required: ["episode_id", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_review",
      description: "Schedule a spaced-repetition review for a concept. Use when the student is at medium mastery and would benefit from revisiting in a few days.",
      parameters: {
        type: "object",
        properties: {
          concept_id: { type: "string" },
          days_from_now: { type: "number" },
        },
        required: ["concept_id", "days_from_now"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_student_phone",
      description: "When a student tells you they changed their phone number, call this to update it. The WAX ID stays the same — all their memory carries over. Verify the student owns the new number somehow (e.g., asking them to send a code from the new number, or by checking they've messaged from both numbers).",
      parameters: {
        type: "object",
        properties: {
          old_phone: { type: "string" },
          new_phone: { type: "string" },
          wax_id: { type: "string" },
          verification_notes: { type: "string", description: "How you verified the student owns the new number" },
        },
        required: ["old_phone", "new_phone", "wax_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_consent",
      description: "Record that the student has given consent for data retention, cross-platform sync, and (if they're a minor) parental consent. Use this after you've explained the data policy and they've agreed. The student must clearly agree in the conversation.",
      parameters: {
        type: "object",
        properties: {
          wax_id: { type: "string" },
          data_retention_consent: { type: "boolean" },
          cross_platform_sync_consent: { type: "boolean" },
          parental_consent_for_minor: { type: "boolean" },
          consent_method: { type: "string", description: "How consent was given — e.g., 'in_app_yes_no', 'web_form'" },
        },
        required: ["wax_id", "data_retention_consent", "cross_platform_sync_consent", "consent_method"],
      },
    },
  },
];
