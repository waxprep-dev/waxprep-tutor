import { Mirror } from "./agents/Mirror";
import { River } from "./agents/River";
import { Fire } from "./agents/Fire";
import { Guardian } from "./agents/Guardian";
import { Witness } from "./agents/Witness";
import { Archivist } from "./agents/Archivist";
import { Perception, ContextBundle, GuardianDecision, Reflection, ArchivistOutput } from "./types";
import { config } from "../config";
import { logger } from "../utils/logger";
import { safeJsonStringify } from "../utils/security";
import { recordCrisisEscalation } from "../memory/profile";
import { query } from "../db/client";

export interface VoidResult {
  response: string;
  perception: Perception;
  contextBundle: ContextBundle;
  guardianDecision: GuardianDecision;
  toolsCalled: string[];
  latencyMs: number;
}

async function triggerCrisisAlert(
  studentId: string, 
  perception: Perception,
  episodeId?: string
): Promise<void> {
  logger.error("CRISIS ALERT TRIGGERED", { 
    studentId, 
    risk_flags: perception.risk_flags,
    episodeId 
  });

  await query(
    `INSERT INTO crisis_escalations (student_phone, episode_id, risk_level, risk_flags, status)
     VALUES ($1, $2, $3, $4, 'open')`,
    [
      studentId,
      episodeId || null,
      perception.risk_flags.suicidal_ideation ? "critical" : "high",
      safeJsonStringify(perception.risk_flags)
    ]
  );

  await recordCrisisEscalation(studentId, perception.risk_flags);

  if (config.emergency.webhookUrl) {
    try {
      const fetch = require("node-fetch");
      await fetch(config.emergency.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: safeJsonStringify({
          type: "crisis_escalation",
          student_phone: studentId,
          risk_flags: perception.risk_flags,
          timestamp: new Date().toISOString(),
          recommended_action: "Immediate human intervention required",
        }),
      });
    } catch (err: any) {
      logger.error("Failed to send crisis webhook", { error: err.message });
    }
  }

  if (config.emergency.alertEmail) {
    logger.info("Crisis email alert would be sent", { email: config.emergency.alertEmail });
  }
}

export class TheVoid {
  private mirror: Mirror;
  private river: River;
  private fire: Fire;
  private guardian: Guardian;
  private witness: Witness;
  private archivist: Archivist;

  constructor() {
    this.mirror = new Mirror();
    this.river = new River();
    this.fire = new Fire();
    this.guardian = new Guardian();
    this.witness = new Witness();
    this.archivist = new Archivist();
  }

  private get mirrorPrompt(): string {
    return process.env.MIRROR_PROMPT || "You are The Mirror...";
  }
  private get riverPrompt(): string {
    return process.env.RIVER_PROMPT || "You are The River...";
  }
  private get firePrompt(): string {
    return process.env.FIRE_PROMPT || "You are The Fire...";
  }
  private get guardianPrompt(): string {
    return process.env.GUARDIAN_PROMPT || "You are The Guardian...";
  }
  private get witnessPrompt(): string {
    return process.env.WITNESS_PROMPT || "You are The Witness...";
  }
  private get archivistPrompt(): string {
    return process.env.ARCHIVIST_PROMPT || "You are The Archivist...";
  }

  async processMessage(
    studentId: string,
    studentMessage: string,
    conversationHistory: string[],
    studentProfile: any,
    availableMemory: any
  ): Promise<VoidResult> {
    const startTime = Date.now();
    const toolsCalled: string[] = [];
    let episodeId: string | undefined;

    try {
      episodeId = availableMemory?.currentEpisodeId;

      logger.info("Calling Mirror", { studentId });
      const perception = await this.mirror.perceive(
        studentMessage,
        conversationHistory,
        this.mirrorPrompt
      );
      toolsCalled.push("mirror");

      if (perception.risk_flags.suicidal_ideation ||
          perception.risk_flags.self_harm ||
          perception.risk_flags.extreme_distress) {
        
        logger.error("CRITICAL RISK detected", { studentId, flags: perception.risk_flags });
        await triggerCrisisAlert(studentId, perception, episodeId);

        const emergencyNumber = config.emergency.phoneNumber || "0800-123-4567";
        return {
          response: `Hey. I need you to listen to me. You are not alone. You matter. Please reach out right now:\n\n📞 Emergency: ${emergencyNumber}\n\nI'm staying with you.`,
          perception,
          contextBundle: this.getDefaultContextBundle(),
          guardianDecision: {
            decision: "escalate",
            reason: "Critical risk detected — human alerted",
            modified_response: null,
            quality_checks: {},
            safety_checks: {},
            escalation: { 
              needed: true, 
              reason: "Critical risk", 
              human_alert: `Student ${studentId} showing risk flags at ${new Date().toISOString()}` 
            },
          },
          toolsCalled,
          latencyMs: Date.now() - startTime,
        };
      }

      logger.info("Calling River", { studentId });
      const contextBundle = await this.river.buildContext(
        perception,
        studentProfile,
        availableMemory,
        this.riverPrompt
      );
      toolsCalled.push("river");

      logger.info("Calling Fire", { studentId });
      const fireResponse = await this.fire.generateResponse(
        contextBundle,
        this.firePrompt,
        studentMessage  // Pass the student message as third argument
      );
      toolsCalled.push("fire");

      logger.info("Calling Guardian", { studentId });
      const guardianDecision = await this.guardian.review(
        fireResponse,
        perception,
        this.guardianPrompt
      );
      toolsCalled.push("guardian");

      let finalResponse: string;
      switch (guardianDecision.decision) {
        case "approve":
          finalResponse = fireResponse;
          break;
        case "modify":
          finalResponse = guardianDecision.modified_response || fireResponse;
          break;
        case "block":
          finalResponse = "Omo, my brain hiccuped. Let me try that again.";
          break;
        case "escalate":
          await triggerCrisisAlert(studentId, perception, episodeId);
          const emergencyNumber = config.emergency.phoneNumber || "0800-123-4567";
          finalResponse = `Hey. You are not alone. Please reach out: ${emergencyNumber}. I'm staying with you.`;
          break;
        default:
          finalResponse = fireResponse;
      }

      const latencyMs = Date.now() - startTime;

      return {
        response: finalResponse,
        perception,
        contextBundle,
        guardianDecision,
        toolsCalled,
        latencyMs,
      };

    } catch (error: any) {
      logger.error("TheVoid orchestration failed", { studentId, error: error.message });
      
      return {
        response: "Omo, network wahala — send that again when you can.",
        perception: this.getDefaultPerception(),
        contextBundle: this.getDefaultContextBundle(),
        guardianDecision: {
          decision: "approve",
          reason: "System failure — fallback response",
          modified_response: null,
          quality_checks: {},
          safety_checks: {},
          escalation: { needed: false, reason: "", human_alert: "" },
        },
        toolsCalled,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  async evolve(
    studentId: string,
    studentMessage: string,
    perception: Perception,
    contextBundle: ContextBundle,
    fireResponse: string,
    studentNextMessage: string | null,
    currentSignature: any,
    currentMemory: any
  ): Promise<void> {
    try {
      logger.info("Starting evolution", { studentId });

      const reflection = await this.witness.reflect(
        studentMessage,
        perception,
        contextBundle,
        fireResponse,
        studentNextMessage,
        this.witnessPrompt
      );

      const evolution = await this.archivist.evolve(
        reflection,
        currentSignature,
        currentMemory,
        this.archivistPrompt
      );

      await this.applyEvolution(studentId, evolution);

      logger.info("Evolution complete", { studentId });

    } catch (error: any) {
      logger.error("Evolution failed", { studentId, error: error.message });
    }
  }

  private async applyEvolution(studentId: string, evolution: ArchivistOutput): Promise<void> {
    for (const update of evolution.memory_updates || []) {
      if (!update.table || !update.action) continue;
      
      try {
        switch (update.table) {
          case "relational_notes":
            if (update.action === "insert") {
              await query(
                `INSERT INTO relational_notes (student_phone, note_text, category, confidence, source)
                 VALUES ($1, $2, $3, $4, 'archivist')`,
                [studentId, update.data.note_text, update.data.category || "general", update.data.confidence || 0.5]
              );
            }
            break;
          case "concepts":
            if (update.action === "upsert") {
              await query(
                `INSERT INTO concepts (student_phone, name, description, mastery_level, last_encountered_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (student_phone, name) DO UPDATE SET
                   description = COALESCE(EXCLUDED.description, concepts.description),
                   mastery_level = EXCLUDED.mastery_level,
                   last_encountered_at = NOW(),
                   success_count = concepts.success_count + 1`,
                [studentId, update.data.name, update.data.description, update.data.mastery_level || 0.5]
              );
            }
            break;
          case "procedural_rules":
            if (update.action === "insert") {
              await query(
                `INSERT INTO procedural_rules (student_phone, rule_text, priority)
                 VALUES ($1, $2, $3)`,
                [studentId, update.data.rule_text, update.data.priority || 50]
              );
            }
            break;
          case "students":
            if (update.action === "update" && update.data.signature) {
              await query(
                `UPDATE students SET teaching_signature = $1 WHERE phone = $2`,
                [safeJsonStringify(update.data.signature), studentId]
              );
            }
            break;
        }

        await query(
          `INSERT INTO memory_evolution_log 
           (student_phone, agent_name, action, table_name, record_id, reason, new_value)
           VALUES ($1, 'archivist', $2, $3, $4, $5, $6)`,
          [studentId, update.action, update.table, update.record_id || null, update.reason, safeJsonStringify(update.data)]
        );

      } catch (err: any) {
        logger.error("Failed to apply memory update", { 
          studentId, 
          table: update.table, 
          error: err.message 
        });
      }
    }

    for (const alert of evolution.alerts || []) {
      if (alert.severity === "critical") {
        logger.error("CRITICAL ALERT from Archivist", { studentId, message: alert.message });
        await query(
          `INSERT INTO crisis_escalations (student_phone, risk_level, risk_flags, status)
           VALUES ($1, 'medium', $2, 'open')`,
          [studentId, safeJsonStringify({ archivist_alert: alert.message })]
        );
      }
    }
  }

  private getDefaultPerception(): Perception {
    return {
      intent: { primary: "other", confidence: 0.5, sub_intents: [] },
      emotional_state: { 
        primary_emotion: "neutral", 
        intensity: 0.3, 
        emotional_triggers: [], 
        vulnerability_detected: false, 
        shame_detected: false, 
        pride_detected: false 
      },
      cognitive_state: { 
        understanding_level: "beginner", 
        confusion_detected: false, 
        pretending_to_understand: false, 
        engagement_level: "medium", 
        attention_span_estimate: "medium" 
      },
      social_context: { 
        formality_level: "casual", 
        relationship_stage: "stranger", 
        trust_level: "low", 
        power_dynamic: "student_seeks_help" 
      },
      dimensions_detected: { 
        intellectual: true, 
        emotional: false, 
        social: false, 
        economic: false, 
        physical: false, 
        spiritual: false, 
        cultural: false 
      },
      urgency: { level: "none", reason: "default" },
      student_needs: { immediate: "unknown", underlying: "unknown", unstated: "unknown" },
      cultural_signals: { language_used: "english", references: [], world_indicators: [] },
      risk_flags: { 
        suicidal_ideation: false, 
        self_harm: false, 
        abuse_indicators: false, 
        extreme_distress: false, 
        academic_crisis: false 
      },
    };
  }

  private getDefaultContextBundle(): ContextBundle {
    return {
      student_profile: { 
        name: "Student", 
        origin: "Unknown", 
        teaching_signature: "NEW", 
        current_mood: "neutral", 
        last_topic: "none", 
        last_mood: "neutral" 
      },
      relevant_memories: { 
        past_conversations: [], 
        concepts_known: [], 
        concepts_struggling: [], 
        misconceptions: [], 
        procedural_rules: [], 
        relational_notes: [] 
      },
      contextual_examples: { 
        recommended_analogy: "danfo bus", 
        alternative_analogies: [], 
        cultural_bridge: "Nigerian context", 
        previous_successful_approach: "none" 
      },
      teaching_recommendations: { 
        suggested_topic: "introduction", 
        suggested_depth: "surface", 
        suggested_pace: "medium", 
        suggested_tone: "gentle", 
        avoid: [], 
        emphasize: [] 
      },
      conversation_state: { 
        current_flow_state: "connection", 
        recommended_next_state: "discovery", 
        message_count_this_episode: 0, 
        time_since_last_message: "unknown" 
      },
      retrieval_actions: { tools_to_call: [], data_to_save: [] },
    };
  }
}

export default TheVoid;
