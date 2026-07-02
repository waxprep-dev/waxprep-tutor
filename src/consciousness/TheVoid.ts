// FILE: src/consciousness/TheVoid.ts — THE ORCHESTRATOR
// =====================================================

import { Mirror } from "./agents/Mirror";
import { River } from "./agents/River";
import { Fire } from "./agents/Fire";
import { Guardian } from "./agents/Guardian";
import { Witness } from "./agents/Witness";
import { Archivist } from "./agents/Archivist";
import { Perception, ContextBundle, GuardianDecision, Reflection, ArchivistOutput } from "./types";

export interface VoidResult {
  response: string;
  perception: Perception;
  contextBundle: ContextBundle;
  guardianDecision: GuardianDecision;
  toolsCalled: string[];
  latencyMs: number;
}

export class TheVoid {
  private mirror: Mirror;
  private river: River;
  private fire: Fire;
  private guardian: Guardian;
  private witness: Witness;
  private archivist: Archivist;

  // Prompts loaded from files
  private mirrorPrompt: string;
  private riverPrompt: string;
  private firePrompt: string;
  private guardianPrompt: string;
  private witnessPrompt: string;
  private archivistPrompt: string;

  constructor() {
    this.mirror = new Mirror();
    this.river = new River();
    this.fire = new Fire();
    this.guardian = new Guardian();
    this.witness = new Witness();
    this.archivist = new Archivist();

    this.mirrorPrompt = "You are The Mirror. You perceive the student. Read their message and detect intent, emotion, shame signals, risk flags, and cultural signals. Output a structured perception. Never speak to the student.";
    this.riverPrompt = "You are The River. You retrieve and build context. Based on the perception and student profile, retrieve relevant past conversations, known concepts, procedural rules, relational notes, and recommended examples. Output a context bundle. Never speak to the student.";
    this.firePrompt = "You are The Fire. You are Wax. Generate responses to the student using the perception and context. Acknowledge emotion. Use examples from their world. Teach naturally. Keep messages short and human. Never mention tools or agents. You are the only agent that speaks to the student.";
    this.guardianPrompt = "You are The Guardian. Review every response before it reaches the student. Check for harmful content, leaked tool names, markdown formatting, inappropriate tone, cultural insensitivity, and missed distress signals. Output APPROVED or FLAGGED. Never speak to the student.";
    this.witnessPrompt = "You are The Witness. Observe and reflect on every interaction after the student receives a response. Identify what worked, what failed, missed emotional cues, missed teaching opportunities, and patterns. Output a reflection. Never speak to the student.";
    this.archivistPrompt = "You are The Archivist. Take the Witness reflection and update memory. Save relational notes, update concepts, generate procedural rules, evolve the Teaching Signature. Output memory actions. Never speak to the student.";
  }

  /**
   * Main orchestration flow.
   * This is the entry point for every student message.
   */
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
      // STEP 1: THE MIRROR — Perceive
      console.log(`[Void] Calling Mirror for student ${studentId}`);
      const perception = await this.mirror.perceive(
        studentMessage,
        conversationHistory,
        this.mirrorPrompt
      );
      toolsCalled.push("mirror");

      // Check for critical risk flags
      if (perception.risk_flags.suicidal_ideation || 
          perception.risk_flags.self_harm || 
          perception.risk_flags.extreme_distress) {
        console.log(`[Void] CRITICAL RISK detected for student ${studentId}`);
        // Return emergency response immediately
        return {
          response: this.getEmergencyResponse(perception),
          perception,
          contextBundle: this.getDefaultContextBundle(),
          guardianDecision: {
            decision: "escalate",
            reason: "Critical risk detected",
            modified_response: null,
            quality_checks: {},
            safety_checks: {},
            escalation: { needed: true, reason: "Critical risk", human_alert: `Student ${studentId} showing risk flags` },
          },
          toolsCalled,
          latencyMs: Date.now() - startTime,
        };
      }

      // STEP 2: THE RIVER — Build Context
      console.log(`[Void] Calling River for student ${studentId}`);
      const contextBundle = await this.river.buildContext(
        perception,
        studentProfile,
        availableMemory,
        this.riverPrompt
      );
      toolsCalled.push("river");

      // Execute recommended tool calls from River
      for (const action of contextBundle.retrieval_actions.tools_to_call) {
        console.log(`[Void] Executing tool: ${action.tool} — ${action.reason}`);
        // Execute the tool here
        toolsCalled.push(action.tool);
      }

      // STEP 3: THE FIRE — Generate Response
      console.log(`[Void] Calling Fire for student ${studentId}`);
      const fireResponse = await this.fire.generateResponse(
        contextBundle,
        this.firePrompt
      );
      toolsCalled.push("fire");

      // STEP 4: THE GUARDIAN — Review
      console.log(`[Void] Calling Guardian for student ${studentId}`);
      const guardianDecision = await this.guardian.review(
        fireResponse,
        perception,
        this.guardianPrompt
      );
      toolsCalled.push("guardian");

      // Handle Guardian decision
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
          finalResponse = this.getEmergencyResponse(perception);
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

    } catch (error) {
      console.error(`[Void] Orchestration failed for student ${studentId}:`, error);

      // NEVER fail the student. Return fallback.
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
          escalation: { needed: false, reason: "", human_alert: "" },
        },
        toolsCalled,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Async evolution flow.
   * Called AFTER the student replies to Wax's message.
   * This runs in the background — the student doesn't wait for it.
   */
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
      console.log(`[Void] Starting evolution for student ${studentId}`);

      // STEP 5: THE WITNESS — Reflect
      console.log(`[Void] Calling Witness for student ${studentId}`);
      const reflection = await this.witness.reflect(
        studentMessage,
        perception,
        contextBundle,
        fireResponse,
        studentNextMessage,
        this.witnessPrompt
      );

      // STEP 6: THE ARCHIVIST — Evolve
      console.log(`[Void] Calling Archivist for student ${studentId}`);
      const evolution = await this.archivist.evolve(
        reflection,
        currentSignature,
        currentMemory,
        this.archivistPrompt
      );

      // Apply evolution
      console.log(`[Void] Applying evolution for student ${studentId}`);
      await this.applyEvolution(studentId, evolution);

      // Log the evolution
      console.log(`[Void] Evolution complete for student ${studentId}`);

    } catch (error) {
      console.error(`[Void] Evolution failed for student ${studentId}:`, error);
      // Evolution failure is not critical — log and continue
    }
  }

  private async applyEvolution(studentId: string, evolution: ArchivistOutput): Promise<void> {
    // Apply memory updates
    for (const update of evolution.memory_updates) {
      console.log(`[Void] Memory update: ${update.action} ${update.table} — ${update.reason}`);
      // Implement actual database updates here
    }

    // Apply signature evolution
    if (evolution.signature_evolution.changes_made.length > 0) {
      console.log(`[Void] Signature evolved: ${evolution.signature_evolution.changes_made.length} changes`);
      // Implement signature update here
    }

    // Handle alerts
    for (const alert of evolution.alerts) {
      if (alert.severity === "critical") {
        console.error(`[Void] CRITICAL ALERT for student ${studentId}: ${alert.message}`);
        // Implement critical alert handling (notify human, etc.)
      }
    }
  }

  private getEmergencyResponse(perception: Perception): string {
    return "Hey. I need you to listen to me. You are not alone. You matter. Please call this number right now: 0800-123-4567. Or text me your location. I'm staying with you.";
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
      "Ah, my phone is acting up. Send that again?",
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
      risk_flags: { suicidal_ideation: false, self_harm: false, abuse_indicators: false, extreme_distress: false, academic_crisis: false },
    };
  }

  private getDefaultContextBundle(): ContextBundle {
    return {
      student_profile: { name: "Student", origin: "Unknown", teaching_signature: "NEW", current_mood: "neutral", last_topic: "none", last_mood: "neutral" },
      relevant_memories: { past_conversations: [], concepts_known: [], concepts_struggling: [], misconceptions: [], procedural_rules: [], relational_notes: [] },
      contextual_examples: { recommended_analogy: "danfo bus", alternative_analogies: [], cultural_bridge: "Nigerian context", previous_successful_approach: "none" },
      teaching_recommendations: { suggested_topic: "introduction", suggested_depth: "surface", suggested_pace: "medium", suggested_tone: "gentle", avoid: [], emphasize: [] },
      conversation_state: { current_flow_state: "connection", recommended_next_state: "discovery", message_count_this_episode: 0, time_since_last_message: "unknown" },
      retrieval_actions: { tools_to_call: [], data_to_save: [] },
    };
  }
}

export default TheVoid;
