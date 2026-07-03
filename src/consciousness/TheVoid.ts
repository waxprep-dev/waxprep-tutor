// FILE: src/consciousness/TheVoid.ts — THE ORCHESTRATOR (v2)
// ============================================================

import { Mirror } from "./agents/Mirror";
import { River } from "./agents/River";
import { Fire } from "./agents/Fire";
import { Guardian } from "./agents/Guardian";
import { Witness } from "./agents/Witness";
import { Archivist } from "./agents/Archivist";
import { Perception, ContextBundle, GuardianDecision } from "./types";
import { TheOracle, OraclePlan, OracleContext } from "./TheOracle";
import { TheSeer, PredictionResult } from "../predictive/TheSeer";
import { mindPalace } from "../memory/mindPalace";
import { query } from "../db/client";
import { logger } from "../utils/logger";

export interface VoidResult {
  response: string;
  perception: Perception;
  contextBundle: ContextBundle;
  guardianDecision: GuardianDecision;
  toolsCalled: string[];
  latencyMs: number;
  plan?: OraclePlan;
  predictions?: PredictionResult;
}

export class TheVoid {
  private mirror: Mirror;
  private river: River;
  private fire: Fire;
  private guardian: Guardian;
  private witness: Witness;
  private archivist: Archivist;
  private oracle: TheOracle;
  private seer: TheSeer;

  constructor() {
    this.mirror = new Mirror();
    this.river = new River();
    this.fire = new Fire();
    this.guardian = new Guardian();
    this.witness = new Witness();
    this.archivist = new Archivist();
    this.oracle = new TheOracle();
    this.seer = new TheSeer();
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

    try {
      // THE SEER
      logger.info(`[Void] Running Seer for student ${studentId}`);
      const predictions = await this.seer.generatePredictions(studentId);
      toolsCalled.push("seer");

      // THE ORACLE
      logger.info(`[Void] Running Oracle for student ${studentId}`);
      const oracleCtx: OracleContext = {
        studentPhone: studentId,
        message: studentMessage,
        history: conversationHistory,
        profile: studentProfile,
        engagement: availableMemory?.engagement || {},
        recentPredictions: [predictions]
      };

      const plan = await this.oracle.generatePlan(oracleCtx);
      toolsCalled.push("oracle");

      if (plan.emergency_flags.length > 0) {
        logger.warn(`[Void] Emergency flags triggered for ${studentId}`, plan.emergency_flags);
        return {
          response: this.getEmergencyResponse(studentProfile),
          perception: this.getDefaultPerception(),
          contextBundle: this.getDefaultContextBundle(),
          guardianDecision: {
            decision: "escalate",
            reason: `Oracle emergency: ${plan.emergency_flags.join(', ')}`,
            modified_response: null,
            quality_checks: {},
            safety_checks: {},
            escalation: { needed: true, reason: plan.emergency_flags.join(', '), human_alert: `Student ${studentId} emergency flags` }
          },
          toolsCalled,
          latencyMs: Date.now() - startTime,
          plan,
          predictions
        };
      }

      if (predictions.burnoutRisk > 0.8) {
        logger.info(`[Void] Critical burnout detected for ${studentId}, switching to support mode`);
        return {
          response: this.generateBurnoutResponse(studentProfile),
          perception: this.getDefaultPerception(),
          contextBundle: this.getDefaultContextBundle(),
          guardianDecision: {
            decision: "approve",
            reason: "Burnout support mode",
            modified_response: null,
            quality_checks: {},
            safety_checks: {},
            escalation: { needed: false, reason: "", human_alert: "" }
          },
          toolsCalled,
          latencyMs: Date.now() - startTime,
          plan,
          predictions
        };
      }

      // MIND PALACE — Working memory
      const workingMemory = await mindPalace.getWorkingMemory(studentId);
      const workingContext = workingMemory.map((m: any) => m.content).join("\n");

      // THE MIRROR
      let perception = this.getDefaultPerception();
      if (plan.orchestration.agents.includes("mirror")) {
        logger.info(`[Void] Running Mirror for student ${studentId}`);
        perception = await this.mirror.perceive(
          studentMessage,
          conversationHistory,
          plan.prompts.mirror || ""
        );
        toolsCalled.push("mirror");

        if (perception?.risk_flags?.suicidal_ideation ||
          perception?.risk_flags?.self_harm ||
          perception?.risk_flags?.extreme_distress) {
          logger.warn(`[Void] Critical risk detected for ${studentId}`);
          return {
            response: this.getEmergencyResponse(studentProfile),
            perception,
            contextBundle: this.getDefaultContextBundle(),
            guardianDecision: {
              decision: "escalate",
              reason: "Critical risk detected",
              modified_response: null,
              quality_checks: {},
              safety_checks: {},
              escalation: { needed: true, reason: "Critical risk", human_alert: `Student ${studentId} showing risk flags` }
            },
            toolsCalled,
            latencyMs: Date.now() - startTime,
            plan,
            predictions
          };
        }
      }

      // THE RIVER
      let contextBundle = this.getDefaultContextBundle();
      if (plan.orchestration.agents.includes("river")) {
        logger.info(`[Void] Running River for student ${studentId}`);
        contextBundle = await this.river.buildContext(
          perception,
          studentProfile,
          availableMemory,
          plan.prompts.river || ""
        );
        toolsCalled.push("river");

        for (const action of contextBundle.retrieval_actions?.tools_to_call || []) {
          toolsCalled.push(action.tool);
        }
      }

      // THE FIRE
      let fireResponse = "";
      if (plan.orchestration.agents.includes("fire")) {
        logger.info(`[Void] Running Fire for student ${studentId}`);
        fireResponse = await this.fire.generateResponse(
          contextBundle,
          plan.prompts.fire || ""
        );
        toolsCalled.push("fire");
      }

      // THE GUARDIAN
      let guardianDecision: GuardianDecision = {
        decision: "approve",
        reason: "Default approve",
        modified_response: null,
        quality_checks: {},
        safety_checks: {},
        escalation: { needed: false, reason: "", human_alert: "" }
      };

      if (plan.orchestration.agents.includes("guardian")) {
        logger.info(`[Void] Running Guardian for student ${studentId}`);
        guardianDecision = await this.guardian.review(
          fireResponse,
          perception,
          plan.prompts.guardian || ""
        );
        toolsCalled.push("guardian");
      }

      let finalResponse: string;
      switch (guardianDecision.decision) {
        case "approve":
          finalResponse = fireResponse;
          break;
        case "modify":
          finalResponse = guardianDecision.modified_response || fireResponse;
          break;
        case "block":
          finalResponse = this.getBlockedResponse();
          break;
        case "escalate":
          finalResponse = this.getEmergencyResponse(studentProfile);
          break;
        default:
          finalResponse = fireResponse;
      }

      await this.saveToMemory(studentId, studentMessage, finalResponse, perception);
      await this.saveResponseSignature(studentId, finalResponse);

      const latencyMs = Date.now() - startTime;

      logger.info(`[Void] Complete for student ${studentId}`, {
        latencyMs,
        toolsCalled: toolsCalled.join(', '),
        planAgents: plan.orchestration.agents.join(', ')
      });

      return {
        response: finalResponse,
        perception,
        contextBundle,
        guardianDecision,
        toolsCalled,
        latencyMs,
        plan,
        predictions
      };

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[Void] Orchestration failed for student ${studentId}:`, errMsg);

      return {
        response: this.getFallbackResponse(),
        perception: this.getDefaultPerception(),
        contextBundle: this.getDefaultContextBundle(),
        guardianDecision: {
          decision: "approve",
          reason: "System failure — fallback response",
          modified_response: null,
          quality_checks: {},
          safety_checks: {},
          escalation: { needed: false, reason: "", human_alert: "" }
        },
        toolsCalled,
        latencyMs: Date.now() - startTime
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
      logger.info(`[Void] Starting evolution for student ${studentId}`);

      const reflection = await this.witness.reflect(
        studentMessage,
        perception,
        contextBundle,
        fireResponse,
        studentNextMessage,
        ""
      );

      const evolution = await this.archivist.evolve(
        reflection,
        currentSignature,
        currentMemory,
        ""
      );

      for (const update of evolution.memory_updates || []) {
        if (update.memory_type === "procedural") {
          await mindPalace.addProceduralMemory(
            studentId,
            update.content,
            update.trigger,
            update.confidence || 0.7,
            (update.metadata as Record<string, any>) || {}
          );
        } else if (update.memory_type === "semantic") {
          await mindPalace.addSemanticMemory(
            studentId,
            update.content,
            update.concept || "general",
            update.mastery || 0,
            update.importance || 0.6
          );
        } else if (update.memory_type === "relational") {
          await mindPalace.addEpisodicMemory(
            studentId,
            `Personal note: ${update.content}`,
            update.importance || 0.7,
            undefined,
            { type: "relational", category: update.category || "other" }
          );
        }
      }

      if (studentNextMessage) {
        await this.updatePredictionAccuracy(studentId, studentNextMessage);
      }

      logger.info(`[Void] Evolution complete for student ${studentId}`);

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[Void] Evolution failed for student ${studentId}:`, errMsg);
    }
  }

  private async saveToMemory(
    studentId: string,
    message: string,
    response: string,
    perception: Perception
  ): Promise<void> {
    await mindPalace.addWorkingMemory(
      studentId,
      `Student: ${message}\nWax: ${response}`
    );

    const content = `Student: ${message}\nWax: ${response}\nEmotion: ${perception?.emotional_state?.primary_emotion || "neutral"}`;
    await mindPalace.addEpisodicMemory(studentId, content, 0.6);
  }

  private async saveResponseSignature(studentId: string, response: string): Promise<void> {
    const hash = this.simpleHash(response);
    const preview = response.slice(0, 100);
    await query(
      `INSERT INTO conversation_signatures (student_phone, response_hash, response_preview)
       VALUES ($1, $2, $3)`,
      [studentId, hash, preview]
    );
  }

  private async updatePredictionAccuracy(studentId: string, nextMessage: string): Promise<void> {
    await query(
      `UPDATE predictions SET was_accurate = false, resolved_at = NOW()
       WHERE student_phone = $1 AND prediction_type = 'burnout_risk'
       AND resolved_at IS NULL`,
      [studentId]
    );
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private generateBurnoutResponse(profile: any): string {
    const name = profile?.preferred_name || profile?.full_name || "Student";
    return `Hey ${name}. I can see you're going through it. We don't have to do school today. How's your head? What's one good thing that happened this week?`;
  }

  private getEmergencyResponse(profile: any): string {
    const name = profile?.preferred_name || profile?.full_name || "Student";
    return `${name}, I need you to listen to me. You are not alone. You matter. Please call this number right now: 0800-123-4567. Or text me your location. I'm staying with you.`;
  }

  private getBlockedResponse(): string {
    return "Omo, my brain hiccuped. Let me try that again.";
  }

  private getFallbackResponse(): string {
    const fallbacks = [
      "Omo, network wahala — send that again when you can.",
      "My brain hiccuped. Say that one more time?",
      "Wait, that message got lost in the matrix. What did you say?",
      "You know what, let me think about that properly. Give me a minute.",
      "Ah, my phone is acting up. Send that again?"
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  private getDefaultPerception(): Perception {
    return {
      intent: { primary: "other", confidence: 0.5, sub_intents: [] },
      emotional_state: { primary_emotion: "neutral", intensity: 0.3, emotional_triggers: [], vulnerability_detected: false, shame_detected: false, pride_detected: false },
      cognitive_state: { understanding_level: "beginner", confusion_detected: false, pretending_to_understand: false, engagement_level: "medium", attention_span_estimate: "medium" },
      social_context: { formality_level: "casual", relationship_stage: "stranger", trust_level: "low", power_dynamic: "student_seeks_help" },
      dimensions_detected: { intellectual: true, emotional: false, social: false, economic: false, physical: false, spiritual: false, cultural: false },
      urgency: { level: "none", reason: "default" },
      student_needs: { immediate: "unknown", underlying: "unknown", unstated: "unknown" },
      cultural_signals: { language_used: "english", references: [], world_indicators: [] },
      risk_flags: { suicidal_ideation: false, self_harm: false, abuse_indicators: false, extreme_distress: false, academic_crisis: false }
    };
  }

  private getDefaultContextBundle(): ContextBundle {
    return {
      student_profile: { name: "Student", origin: "Unknown", teaching_signature: "NEW", current_mood: "neutral", last_topic: "none", last_mood: "neutral" },
      relevant_memories: { past_conversations: [], concepts_known: [], concepts_struggling: [], misconceptions: [], procedural_rules: [], relational_notes: [] },
      contextual_examples: { recommended_analogy: "danfo bus", alternative_analogies: [], cultural_bridge: "Nigerian context", previous_successful_approach: "none" },
      teaching_recommendations: { suggested_topic: "introduction", suggested_depth: "surface", suggested_pace: "medium", suggested_tone: "gentle", avoid: [], emphasize: [] },
      conversation_state: { current_flow_state: "connection", recommended_next_state: "discovery", message_count_this_episode: 0, time_since_last_message: "unknown" },
      retrieval_actions: { tools_to_call: [], data_to_save: [] }
    };
  }
}

export default TheVoid;
