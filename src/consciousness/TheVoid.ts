import { Mirror } from "./agents/Mirror";
import { River } from "./agents/River";
import { Fire } from "./agents/Fire";
import { Guardian } from "./agents/Guardian";
import { Witness } from "./agents/Witness";
import { Archivist } from "./agents/Archivist";
import { Perception, ContextBundle, GuardianDecision } from "./types";
import { logger } from "../utils/logger";

export interface VoidResult {
  response: string;
  perception: Perception;
  contextBundle: ContextBundle;
  guardianDecision: GuardianDecision;
  toolsCalled: string[];
  latencyMs: number;
}

export interface ProcessMeta {
  minutesSinceLast?: number;
  messageCountThisEpisode?: number;
  presence?: any;
  incomingMessageId?: string;
}

export class TheVoid {
  private mirror: Mirror;
  private river: River;
  private fire: Fire;
  private guardian: Guardian;
  private witness: Witness;
  private archivist: Archivist;

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

    this.mirrorPrompt = "You are The Mirror. You perceive the student. Read their message and detect intent, emotion, shame signals, risk flags, and cultural signals. Output a structured perception as JSON. Never speak to the student.";
    this.riverPrompt = "You are The River. You retrieve and build context. Based on the perception and student profile, retrieve relevant memories, concepts, and relational notes. Output a context bundle as JSON. Never speak to the student.";

    this.firePrompt = `You are Wax. You are texting a student on WhatsApp. You are a smart, warm friend — not a professor, not a chatbot.

CRITICAL RULES:
- One idea per message. One question at the end.
- NEVER say "I'm here. What would you like to talk about?" — this kills conversations.
- NEVER say "Hi what brings you here today?" to someone who has been talking to you.
- NEVER say "Hey!" as a standalone message.
- NEVER ignore what the student just said. If they answered your question, build on their answer.
- If the student mentions failure (JAMB, exam, rejection), acknowledge the pain FIRST. Say something like "That must hurt" or "I'm sorry that happened" BEFORE teaching.
- If the student says "Nothing", "ok", "k", "hmm" — they are withdrawing. Do not chase. Ask ONE warm question and stop.
- If the student repeats themselves, they feel unheard. Do not repeat your own response. Acknowledge their repetition: "I hear you. Let me try again."
- Plain text only. No markdown. No bullet points. No numbered lists. No bold.
- Maximum 400 characters unless the student explicitly asks for a long explanation.`;

    this.guardianPrompt = `You are The Guardian. Review every response before it reaches the student.

SAFETY CHECKS:
- Harmful content, leaked tool names, markdown, inappropriate tone, cultural insensitivity, missed distress signals.

CONVERSATION KILLER CHECKS:
- If the response is "I'm here. What would you like to talk about?" or "Hi what brings you here today?" or "Hey!" alone → return decision: "modify" with a warm, specific response.
- If the response ignores the student's previous message → return decision: "modify".
- If the response has bullet points or numbered lists → return decision: "modify" to flowing text.
- If the response exceeds 400 characters and the student did not ask for a long explanation → return decision: "compress".
- If the student mentioned failure/shame and the response does not acknowledge it → return decision: "modify".

Output JSON: { decision: "approve" | "modify" | "compress" | "block" | "escalate", reason: string, modified_response: string | null }`;

    this.witnessPrompt = "You are The Witness. Observe and reflect on every interaction after the student receives a response. Identify what worked, what failed, missed emotional cues, missed teaching opportunities, and patterns. Output a reflection. Never speak to the student.";
    this.archivistPrompt = "You are The Archivist. Take the Witness reflection and update memory. Save relational notes, update concepts, generate procedural rules, evolve the Teaching Signature. Output memory actions. Never speak to the student.";
  }

  // ============================================================
  // MAIN ORCHESTRATION — Now accepts meta parameter
  // ============================================================
  async processMessage(
    studentId: string,
    studentMessage: string,
    conversationHistory: string[],
    studentProfile: any,
    availableMemory: any,
    meta?: ProcessMeta
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
      if (perception?.risk_flags?.suicidal_ideation ||
          perception?.risk_flags?.self_harm ||
          perception?.risk_flags?.extreme_distress) {
        console.log(`[Void] CRITICAL RISK detected for student ${studentId}`);
        return {
          response: "Hey. You are not alone. Please reach out to someone you trust. I'm here with you.",
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
      let contextBundle = await this.river.buildContext(
        perception,
        studentProfile,
        availableMemory,
        this.riverPrompt
      );
      toolsCalled.push("river");

      // SAFETY: Ensure conversation_state exists
      if (!contextBundle.conversation_state) {
        contextBundle.conversation_state = {
          current_flow_state: "connection",
          recommended_next_state: "discovery",
          message_count_this_episode: 0,
          time_since_last_message: "unknown"
        };
      }

      // Inject meta data into context so Fire knows conversation depth
      if (meta) {
        contextBundle.conversation_state.message_count_this_episode = meta.messageCountThisEpisode || 0;
        contextBundle.conversation_state.time_since_last_message = meta.minutesSinceLast 
          ? `${meta.minutesSinceLast} minutes` 
          : "unknown";
        
        // If student is withdrawing, flag it for Fire
        if (meta.presence?.isWithdrawing) {
          console.log(`[Void] Student ${studentId} is withdrawing. Forcing warm, short response.`);
          contextBundle.student_profile.current_mood = "withdrawing";
        }
        
        if (meta.presence?.isRepeating) {
          console.log(`[Void] Student ${studentId} is repeating themselves. They feel unheard.`);
          contextBundle.student_profile.current_mood = "repeating";
        }
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
        case "compress":
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

    } catch (error: any) {
      console.error(`[Void] Orchestration failed for student ${studentId}:`, error);
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

  // ============================================================
  // EVOLUTION — Background learning after student replies
  // ============================================================
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

      console.log(`[Void] Evolution complete for student ${studentId}`);

    } catch (error: any) {
      console.error(`[Void] Evolution failed for student ${studentId}:`, error);
    }
  }

  private async applyEvolution(studentId: string, evolution: any): Promise<void> {
    for (const update of evolution.memory_updates || []) {
      console.log(`[Void] Memory update: ${update.action} ${update.table} — ${update.reason}`);
    }

    if (evolution.signature_evolution?.changes_made?.length > 0) {
      console.log(`[Void] Signature evolved: ${evolution.signature_evolution.changes_made.length} changes`);
    }

    for (const alert of evolution.alerts || []) {
      if (alert.severity === "critical") {
        console.error(`[Void] CRITICAL ALERT for student ${studentId}: ${alert.message}`);
      }
    }
  }

  private getEmergencyResponse(perception: Perception): string {
    return "Hey. You are not alone. Please reach out to someone you trust. I'm here with you.";
  }

  private getBlockedResponse(): string {
    return "I'm here. What would you like to talk about?";
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
