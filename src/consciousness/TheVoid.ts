import { Mirror } from "./agents/Mirror";
import { River } from "./agents/River";
import { Fire } from "./agents/Fire";
import { Guardian } from "./agents/Guardian";
import { Witness } from "./agents/Witness";
import { Archivist } from "./agents/Archivist";
import { Resonance } from "./agents/Resonance";
import { TheOracle, OraclePlan, OracleContext } from "./TheOracle";
import { TheSeer } from "../predictive/TheSeer";
import { circadianEngine } from "../temporal/circadianEngine";
import { auraHealer } from "../healing/auraHealer";
import { metacognitiveScaffolder } from "../teaching/metacognitiveScaffolder";
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
  private oracle: TheOracle;
  private seer: TheSeer;
  private resonance: Resonance;

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
    this.oracle = new TheOracle();
    this.seer = new TheSeer();
    this.resonance = new Resonance();

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
  // MAIN ORCHESTRATION — WITH METACOGNITIVE SCAFFOLDER
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
    const healingEvents: any[] = [];

    try {
      // ============================================================
      // STEP 0: CIRCADIAN
      // ============================================================
      console.log(`[Void] Getting Circadian context for student ${studentId}`);
      const temporalGene = await circadianEngine.getTemporalGene(studentId);
      console.log(`[Void] Circadian: ${temporalGene.geneName} — ${temporalGene.reason}`);

      // ============================================================
      // STEP 1: THE SEER
      // ============================================================
      console.log(`[Void] Calling Seer for student ${studentId}`);
      const predictions = await this.seer.generatePredictions(studentId);
      toolsCalled.push("seer");
      console.log(`[Void] Seer: burnoutRisk=${predictions.burnoutRisk}, nextStruggle=${predictions.nextStruggle}`);

      if (predictions.burnoutRisk > 0.8) {
        console.log(`[Void] Critical burnout detected for ${studentId}, switching to support mode`);
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
        };
      }

      // ============================================================
      // STEP 2: THE ORACLE
      // ============================================================
      console.log(`[Void] Calling Oracle for student ${studentId}`);
      const oracleCtx = {
        studentPhone: studentId,
        message: studentMessage,
        history: conversationHistory,
        profile: studentProfile,
        engagement: availableMemory?.engagement || {},
        recentPredictions: [predictions]
      };

      const plan = await this.oracle.generatePlan(oracleCtx);
      toolsCalled.push("oracle");
      console.log(`[Void] Oracle plan: agents=${plan.orchestration.agents.join(',')}`);

      if (plan.prompts.fire) {
        plan.prompts.fire += `\n\n${temporalGene.geneName}: ${temporalGene.reason}`;
      }

      // ============================================================
      // STEP 3: THE MIRROR
      // ============================================================
      let perception = this.getDefaultPerception();
      
      if (plan.orchestration.agents.includes("mirror")) {
        const mirrorStart = Date.now();
        try {
          console.log(`[Void] Calling Mirror for student ${studentId}`);
          perception = await this.mirror.perceive(
            studentMessage,
            conversationHistory,
            plan.prompts.mirror || this.mirrorPrompt
          );
          toolsCalled.push("mirror");

          const anomaly = await auraHealer.detectAnomaly(
            "mirror",
            perception,
            this.getDefaultPerception(),
            Date.now() - mirrorStart,
            studentId
          );
          if (anomaly) {
            const healed = await auraHealer.heal(anomaly);
            healingEvents.push({ ...anomaly, recovery: healed });
            console.log(`[Void] AURA healed mirror anomaly: ${anomaly.eventType}`);
          }

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
        } catch (error: any) {
          const healed = await auraHealer.heal({
            eventType: 'llm_timeout',
            severity: 'high',
            description: `Mirror failed: ${error.message}`,
            studentPhone: studentId
          });
          healingEvents.push({ type: 'mirror_failure', recovery: healed });
          console.log(`[Void] AURA healed mirror failure: ${error.message}`);
        }
      }

      // ============================================================
      // STEP 4: THE RIVER
      // ============================================================
      let contextBundle = this.getDefaultContextBundle();
      
      if (plan.orchestration.agents.includes("river")) {
        const riverStart = Date.now();
        try {
          console.log(`[Void] Calling River for student ${studentId}`);
          contextBundle = await this.river.buildContext(
            perception,
            studentProfile,
            availableMemory,
            plan.prompts.river || this.riverPrompt
          );
          toolsCalled.push("river");

          const anomaly = await auraHealer.detectAnomaly(
            "river",
            contextBundle,
            this.getDefaultContextBundle(),
            Date.now() - riverStart,
            studentId
          );
          if (anomaly) {
            const healed = await auraHealer.heal(anomaly);
            healingEvents.push({ ...anomaly, recovery: healed });
            console.log(`[Void] AURA healed river anomaly: ${anomaly.eventType}`);
          }

          if (!contextBundle.conversation_state) {
            contextBundle.conversation_state = {
              current_flow_state: "connection",
              recommended_next_state: "discovery",
              message_count_this_episode: 0,
              time_since_last_message: "unknown"
            };
          }

          if (meta) {
            contextBundle.conversation_state.message_count_this_episode = meta.messageCountThisEpisode || 0;
            contextBundle.conversation_state.time_since_last_message = meta.minutesSinceLast 
              ? `${meta.minutesSinceLast} minutes` 
              : "unknown";
            
            if (meta.presence?.isWithdrawing) {
              console.log(`[Void] Student ${studentId} is withdrawing.`);
              contextBundle.student_profile.current_mood = "withdrawing";
            }
            
            if (meta.presence?.isRepeating) {
              console.log(`[Void] Student ${studentId} is repeating themselves.`);
              contextBundle.student_profile.current_mood = "repeating";
            }
          }

          contextBundle.teaching_recommendations.suggested_topic = predictions.nextStruggle || "general";
          contextBundle.teaching_recommendations.suggested_pace = 
            predictions.burnoutRisk > 0.5 ? "slow" : "medium";
          
          contextBundle.student_profile.current_mood = 
            temporalGene.geneName === 'late_night' ? 'tired' : 
            temporalGene.geneName === 'morning_energy' ? 'alert' : 'neutral';
        } catch (error: any) {
          const healed = await auraHealer.heal({
            eventType: 'llm_timeout',
            severity: 'high',
            description: `River failed: ${error.message}`,
            studentPhone: studentId
          });
          healingEvents.push({ type: 'river_failure', recovery: healed });
          console.log(`[Void] AURA healed river failure: ${error.message}`);
        }
      }

      // ============================================================
      // STEP 4.5: METACOGNITIVE SCAFFOLDER — Detect student state
      // ============================================================
      let scaffoldPlan = null;
      try {
        console.log(`[Void] Running Metacognitive Scaffolder for student ${studentId}`);
        const topic = contextBundle?.teaching_recommendations?.suggested_topic || "general";
        scaffoldPlan = await metacognitiveScaffolder.generateScaffold(
          studentId,
          topic,
          studentMessage,
          conversationHistory
        );
        
        if (scaffoldPlan) {
          console.log(`[Void] Scaffold: mode=${scaffoldPlan.mode}, difficulty=${scaffoldPlan.difficulty}`);
          console.log(`[Void] Scaffold prompts: ${scaffoldPlan.prompts?.join(" | ")}`);
          
          // Inject scaffold into Fire's context
          if (scaffoldPlan.prompts && scaffoldPlan.prompts.length > 0) {
            contextBundle.scaffold = {
              mode: scaffoldPlan.mode,
              prompts: scaffoldPlan.prompts,
              expectedOutcome: scaffoldPlan.expectedOutcome,
            };
          }
        }
      } catch (error: any) {
        console.log(`[Void] Metacognitive Scaffolder failed: ${error.message}`);
        // Non-critical, continue
      }

      // ============================================================
      // STEP 5: THE FIRE
      // ============================================================
      let fireResponse = "";
      const fireStart = Date.now();
      
      // Build fire prompt with scaffold if available
      let firePrompt = plan.prompts.fire || this.firePrompt;
      if (scaffoldPlan && scaffoldPlan.prompts && scaffoldPlan.prompts.length > 0) {
        firePrompt += `\n\nMETACOGNITIVE SCAFFOLD:\nStudent needs: ${scaffoldPlan.mode}\nUse these prompts if appropriate: ${scaffoldPlan.prompts.join(" | ")}`;
      }
      
      try {
        console.log(`[Void] Calling Fire for student ${studentId}`);
        fireResponse = await this.fire.generateResponse(
          contextBundle,
          firePrompt
        );
        toolsCalled.push("fire");

        const anomaly = await auraHealer.detectAnomaly(
          "fire",
          fireResponse,
          "",
          Date.now() - fireStart,
          studentId
        );
        if (anomaly) {
          const healed = await auraHealer.heal(anomaly);
          healingEvents.push({ ...anomaly, recovery: healed });
          console.log(`[Void] AURA healed fire anomaly: ${anomaly.eventType}`);
          if (healed.success && healed.actionTaken.includes('Regenerated')) {
            fireResponse = await this.fire.generateResponse(
              contextBundle,
              firePrompt + "\n[HEALED: " + healed.actionTaken + "]"
            );
          }
        }
      } catch (error: any) {
        const healed = await auraHealer.heal({
          eventType: 'llm_timeout',
          severity: 'critical',
          description: `Fire failed: ${error.message}`,
          studentPhone: studentId
        });
        healingEvents.push({ type: 'fire_failure', recovery: healed });
        console.log(`[Void] AURA healed fire failure: ${error.message}`);
        fireResponse = "Give me a moment — trying again.";
      }

      // ============================================================
      // STEP 6: THE GUARDIAN
      // ============================================================
      let guardianDecision: GuardianDecision = {
        decision: "approve",
        reason: "Default approve",
        modified_response: null,
        quality_checks: {},
        safety_checks: {},
        escalation: { needed: false, reason: "", human_alert: "" }
      };
      const guardianStart = Date.now();
      
      try {
        console.log(`[Void] Calling Guardian for student ${studentId}`);
        guardianDecision = await this.guardian.review(
          fireResponse,
          perception,
          plan.prompts.guardian || this.guardianPrompt
        );
        toolsCalled.push("guardian");

        const anomaly = await auraHealer.detectAnomaly(
          "guardian",
          guardianDecision,
          { decision: "approve" },
          Date.now() - guardianStart,
          studentId
        );
        if (anomaly) {
          const healed = await auraHealer.heal(anomaly);
          healingEvents.push({ ...anomaly, recovery: healed });
          console.log(`[Void] AURA healed guardian anomaly: ${anomaly.eventType}`);
        }
      } catch (error: any) {
        const healed = await auraHealer.heal({
          eventType: 'llm_timeout',
          severity: 'medium',
          description: `Guardian failed: ${error.message}`,
          studentPhone: studentId
        });
        healingEvents.push({ type: 'guardian_failure', recovery: healed });
        console.log(`[Void] AURA healed guardian failure: ${error.message}`);
      }

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

      // Evaluate scaffold if used
      if (scaffoldPlan) {
        setImmediate(async () => {
          try {
            const evalResult = await metacognitiveScaffolder.evaluateScaffold(
              studentId,
              scaffoldPlan,
              finalResponse
            );
            if (evalResult.effective) {
              console.log(`[Void] Scaffold effective: ${evalResult.evidence}`);
              await metacognitiveScaffolder.updateMetacognitiveProfile(studentId, evalResult);
            }
          } catch (e) {
            // Non-critical
          }
        });
      }

      // Update circadian profile
      if (fireResponse) {
        setImmediate(() => {
          try {
            circadianEngine.updateProfile(studentId, new Date(), studentMessage.length, latencyMs);
          } catch (e) {
            // Non-critical
          }
        });
      }

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
      
      try {
        const healed = await auraHealer.heal({
          eventType: 'llm_timeout',
          severity: 'critical',
          description: `Critical orchestrator failure: ${error.message}`,
          studentPhone: studentId
        });
        console.log(`[Void] AURA healed critical failure: ${healed.actionTaken}`);
      } catch (e) {
        // Ignore
      }

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
  // EVOLUTION
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

      const pulse = this.resonance.detect(studentNextMessage, perception, contextBundle);
      
      if (pulse.shouldInject) {
        console.log(`[Void] RESONANCE PULSE: ${pulse.tone} — ${pulse.reason}`);
        if (pulse.suggestion) {
          await this.storeResonancePulse(studentId, pulse);
        }
      }

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

  private async storeResonancePulse(studentId: string, pulse: any): Promise<void> {
    console.log(`[Void] Resonance pulse stored for ${studentId}: ${pulse.tone}`);
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

  private generateBurnoutResponse(profile: any): string {
    const name = profile?.preferred_name || profile?.full_name || "Student";
    return `Hey ${name}. I can see you're going through it. We don't have to do school today. How's your head? What's one good thing that happened this week?`;
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
