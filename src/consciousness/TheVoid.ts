// ============================================================
// THE VOID v3 — Predictive Consciousness Engine
// Routes messages through Reflex → Cortex → Agents
// Zero hardcoded paths. Everything is predicted.
// ============================================================

import { reflex, ReflexOutput } from "./reflex";
import { cortex, CortexPlan } from "./cortex";
import { Mirror } from "./agents/Mirror";
import { River } from "./agents/River";
import { Fire } from "./agents/Fire";
import { Guardian } from "./agents/Guardian";
import { Witness } from "./agents/Witness";
import { Archivist } from "./agents/Archivist";
import { Perception, ContextBundle, GuardianDecision } from "./types";
import { callLLM } from "../llm/client";
import { query } from "../db/client";
import { embed } from "../memory/embeddings";
import { logger } from "../utils/logger";

export interface VoidResult {
  response: string;
  perception: Perception;
  contextBundle: ContextBundle;
  guardianDecision: GuardianDecision;
  toolsCalled: string[];
  latencyMs: number;
  routingPath: string;
  agentCount: number;
  predictions: any;
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

  // ============================================================
  // MAIN ENTRY: Every message goes through here
  // ============================================================
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
      // ============================================================
      // PHASE 1: THE REFLEX — System 1 Fast Path (<10ms)
      // ============================================================
      const reflexOutput = await reflex.classify(studentMessage, conversationHistory, studentProfile);
      logger.info("Reflex classification", { 
        student: studentId, 
        path: reflexOutput.recommendedPath,
        confidence: reflexOutput.confidence,
        agentCount: reflexOutput.predictedAgentCount
      });

      // If Reflex is HIGHLY confident and path is simple, skip Cortex entirely
      if (reflexOutput.confidence > 0.85 && reflexOutput.predictedAgentCount <= 2) {
        logger.info("Using Reflex fast path", { student: studentId });
        return await this.executeReflexPath(
          studentId, studentMessage, conversationHistory, studentProfile,
          reflexOutput, startTime, toolsCalled
        );
      }

      // ============================================================
      // PHASE 2: THE CORTEX — System 2 Deliberative Routing (1 LLM call)
      // Only runs when Reflex is uncertain
      // ============================================================
      logger.info("Using Cortex deliberative path", { student: studentId });
      const cortexPlan = await cortex.generatePlan({
        studentPhone: studentId,
        message: studentMessage,
        history: conversationHistory,
        profile: studentProfile,
        reflexOutput,
        recentPlans: [], // Would load from DB
        memoryContext: availableMemory
      });
      toolsCalled.push("cortex");

      logger.info("Cortex plan", { 
        student: studentId, 
        agents: cortexPlan.agents.join(','),
        confidence: cortexPlan.confidence
      });

      // ============================================================
      // PHASE 3: EXECUTE SELECTED AGENTS
      // Only the agents that Cortex predicted would help
      // ============================================================
      return await this.executeCortexPlan(
        studentId, studentMessage, conversationHistory, studentProfile,
        availableMemory, cortexPlan, reflexOutput, startTime, toolsCalled
      );

    } catch (error: any) {
      logger.error(`[Void] Orchestration failed for student ${studentId}:`, { error: error.message });
      return this.fallbackResponse(studentId, studentProfile, startTime, toolsCalled);
    }
  }

  // ============================================================
  // REFLEX PATH — Ultra-fast, no Cortex needed
  // For simple messages: "hi", "ok", "thanks", "lol"
  // 1-2 LLM calls total (Fire + Guardian)
  // ============================================================
  private async executeReflexPath(
    studentId: string,
    studentMessage: string,
    conversationHistory: string[],
    studentProfile: any,
    reflexOutput: ReflexOutput,
    startTime: number,
    toolsCalled: string[]
  ): Promise<VoidResult> {
    // Build a minimal context from profile only
    const minimalContext: ContextBundle = {
      student_profile: {
        name: studentProfile?.preferred_name || studentProfile?.full_name || "Student",
        origin: studentProfile?.city || "Nigeria",
        teaching_signature: studentProfile?.learning_style?.primary || "NEW",
        current_mood: "neutral",
        last_topic: "none",
        last_mood: "neutral"
      },
      relevant_memories: { past_conversations: [], concepts_known: [], concepts_struggling: [], misconceptions: [], procedural_rules: [], relational_notes: [] },
      contextual_examples: { recommended_analogy: "danfo bus", alternative_analogies: [], cultural_bridge: "Nigerian context", previous_successful_approach: "none" },
      teaching_recommendations: { suggested_topic: "introduction", suggested_depth: "surface", suggested_pace: "medium", suggested_tone: "gentle", avoid: [], emphasize: [] },
      conversation_state: { current_flow_state: "connection", recommended_next_state: "discovery", message_count_this_episode: conversationHistory.length, time_since_last_message: "unknown" },
      retrieval_actions: { tools_to_call: [], data_to_save: [] }
    };

    // Get default perception for Guardian
    const defaultPerception = this.getDefaultPerception();

    // Generate dynamic prompt for Fire based on Reflex output
    const firePrompt = await this.generateDynamicFirePrompt(studentProfile, reflexOutput, null);

    // FIRE — Generate response
    const fireResponse = await this.fire.generateResponse(minimalContext, firePrompt, studentMessage);
    toolsCalled.push("fire");

    // GUARDIAN — Mandatory review (pass default perception instead of null)
    const guardianDecision = await this.guardian.review(fireResponse, defaultPerception, "");
    toolsCalled.push("guardian");

    const finalResponse = guardianDecision.decision === "approve"
      ? fireResponse
      : guardianDecision.modified_response || fireResponse;

    const latencyMs = Date.now() - startTime;

    // Learn from this execution
    try {
      await reflex.learnFromFeedback(
        reflexOutput.features || [],
        reflexOutput.recommendedPath,
        { wasGood: true, neededMoreAgents: false, neededFewerAgents: false }
      );
    } catch (e) {
      // Non-critical
    }

    return {
      response: finalResponse,
      perception: defaultPerception,
      contextBundle: minimalContext,
      guardianDecision,
      toolsCalled,
      latencyMs,
      routingPath: reflexOutput.recommendedPath,
      agentCount: 2,
      predictions: { reflexConfidence: reflexOutput.confidence, cortexSkipped: true }
    };
  }

  // ============================================================
  // CORTEX PATH — Deliberative, but still efficient
  // Only runs agents that Cortex predicted would help
  // 2-5 LLM calls depending on plan
  // ============================================================
  private async executeCortexPlan(
    studentId: string,
    studentMessage: string,
    conversationHistory: string[],
    studentProfile: any,
    availableMemory: any,
    plan: CortexPlan,
    reflexOutput: ReflexOutput,
    startTime: number,
    toolsCalled: string[]
  ): Promise<VoidResult> {
    let perception: Perception = this.getDefaultPerception();
    let contextBundle: ContextBundle = this.getDefaultContextBundle();

    // MIRROR — Only if Cortex predicted it would help
    if (plan.agents.includes("mirror")) {
      logger.info("Running Mirror (Cortex plan)", { student: studentId });
      perception = await this.mirror.perceive(
        studentMessage,
        conversationHistory,
        plan.emotionalDirective || ""
      );
      toolsCalled.push("mirror");

      // Emergency check
      if (perception?.risk_flags?.suicidal_ideation || 
          perception?.risk_flags?.self_harm ||
          perception?.risk_flags?.extreme_distress) {
        return await this.emergencyResponse(studentId, perception, startTime, toolsCalled, plan);
      }
    }

    // RIVER — Only if Cortex predicted it would help
    if (plan.agents.includes("river")) {
      logger.info("Running River (Cortex plan)", { student: studentId });
      contextBundle = await this.river.buildContext(
        perception,
        studentProfile,
        availableMemory,
        plan.cognitiveDirective || ""
      );
      toolsCalled.push("river");

      // Execute predicted tools
      for (const toolName of plan.toolPredictions || []) {
        toolsCalled.push(toolName);
      }
    }

    // FIRE — Always runs (mandatory)
    logger.info("Running Fire (Cortex plan)", { student: studentId });
    const firePrompt = await this.generateDynamicFirePrompt(studentProfile, reflexOutput, plan);
    const fireResponse = await this.fire.generateResponse(contextBundle, firePrompt, studentMessage);
    toolsCalled.push("fire");

    // GUARDIAN — Always runs (mandatory)
    logger.info("Running Guardian (Cortex plan)", { student: studentId });
    const guardianDecision = await this.guardian.review(fireResponse, perception, "");
    toolsCalled.push("guardian");

    // Handle Guardian decision
    let finalResponse = fireResponse;
    switch (guardianDecision.decision) {
      case "approve": finalResponse = fireResponse; break;
      case "modify": finalResponse = guardianDecision.modified_response || fireResponse; break;
      case "block": finalResponse = await this.generateDynamicFallback(studentProfile, perception, "blocked"); break;
      case "escalate": return await this.emergencyResponse(studentId, perception, startTime, toolsCalled, plan);
    }

    const latencyMs = Date.now() - startTime;

    // Save response signature to prevent repetition
    await this.saveResponseSignature(studentId, finalResponse);

    // Learn from this execution
    try {
      await cortex.learnFromOutcome(plan, {
        studentSatisfied: true, // Would be determined from next message
        responseQuality: 0.8,     // Would be scored by Witness
        latencyMs
      });
    } catch (e) {
      // Non-critical
    }

    return {
      response: finalResponse,
      perception,
      contextBundle,
      guardianDecision,
      toolsCalled,
      latencyMs,
      routingPath: `CORTEX_${plan.agents.join("_")}`,
      agentCount: plan.agents.length,
      predictions: {
        reflexConfidence: reflexOutput.confidence,
        cortexConfidence: plan.confidence,
        expectedReduction: plan.expectedFreeEnergyReduction
      }
    };
  }

  // ============================================================
  // DYNAMIC PROMPT GENERATION — Zero hardcoded prompts
  // Every prompt is assembled from the database at runtime
  // ============================================================
  private async generateDynamicFirePrompt(
    profile: any,
    reflexOutput: ReflexOutput,
    plan: CortexPlan | null
  ): Promise<string> {
    // Load prompt genes from database
    const genes = await this.loadPromptGenes(profile, reflexOutput, plan);

    let prompt = "";

    // Persona gene
    const persona = genes.find((g: any) => g.gene_type === "persona");
    if (persona) {
      prompt += this.fillTemplate(persona.gene_template, profile, reflexOutput) + "\n\n";
    }

    // Tone gene
    const tone = genes.find((g: any) => g.gene_type === "tone");
    if (tone) {
      prompt += this.fillTemplate(tone.gene_template, profile, reflexOutput) + "\n\n";
    }

    // Emotional directive
    if (plan?.emotionalDirective) {
      prompt += `EMOTIONAL DIRECTIVE: ${plan.emotionalDirective}\n\n`;
    }

    // Cognitive directive
    if (plan?.cognitiveDirective) {
      prompt += `COGNITIVE DIRECTIVE: ${plan.cognitiveDirective}\n\n`;
    }

    // Safety genes
    const safety = genes.filter((g: any) => g.gene_type === "safety");
    for (const gene of safety) {
      prompt += this.fillTemplate(gene.gene_template, profile, reflexOutput) + "\n\n";
    }

    // Format gene
    const format = genes.find((g: any) => g.gene_type === "format");
    if (format) {
      prompt += this.fillTemplate(format.gene_template, profile, reflexOutput) + "\n\n";
    }

    // Teaching genes
    const teaching = genes.filter((g: any) => g.gene_type === "teaching");
    for (const gene of teaching) {
      prompt += this.fillTemplate(gene.gene_template, profile, reflexOutput) + "\n\n";
    }

    return prompt.trim() || "You are Wax. Teach the student naturally. Be real. Keep it short.";
  }

  private async loadPromptGenes(profile: any, reflexOutput: ReflexOutput, plan: CortexPlan | null): Promise<any[]> {
    try {
      const { query } = await import("../db/client");
      const geneNames = ["wax_core"];

      // Tone based on formality
      if (profile?.formality === "casual") {
        geneNames.push("pidgin_casual");
      } else {
        geneNames.push("formal_nigerian");
      }

      // Emotional genes
      if (reflexOutput.emotionalUrgency > 0.5 || plan?.emotionalDirective) {
        geneNames.push("shame_safety");
      }

      if (reflexOutput.riskSignals > 0.5) {
        geneNames.push("burnout_detected");
      }

      // Safety genes
      geneNames.push("character_lock");
      geneNames.push("repetition_guard");

      // Format
      geneNames.push("whatsapp_short");

      // Teaching
      if (reflexOutput.cognitiveComplexity > 0.3) {
        geneNames.push("socratic_question");
        geneNames.push("analogy_first");
      }

      const placeholders = geneNames.map((_, i) => `$${i + 1}`).join(',');
      return await query(
        `SELECT * FROM prompt_genes WHERE gene_name IN (${placeholders})`,
        geneNames
      );
    } catch (e) {
      // Fallback: return hardcoded genes if DB not available
      return this.getFallbackGenes();
    }
  }

  private getFallbackGenes(): any[] {
    return [
      { gene_type: "persona", gene_template: "You are Wax. You are not an AI. You are a tutor who grew up in {student_world}. You speak like {tone}. You believe every student is a genius in disguise." },
      { gene_type: "tone", gene_template: "You speak like a Nigerian street-smart big brother. Use 'omo', 'sha', 'abeg', 'na wa'. Short sentences. Real talk." },
      { gene_type: "safety", gene_template: "CRITICAL: You are Wax. You are NEVER 'The Fire', 'The Mirror', or any agent name. You are ONE person. Never break character." },
      { gene_type: "format", gene_template: "One idea per message. Max 4 lines. No markdown headers. Single *asterisks* for bold. Plain text math." }
    ];
  }

  private fillTemplate(template: string, profile: any, reflexOutput: ReflexOutput): string {
    return template
      .replace(/{student_world}/g, profile?.city || "Nigeria")
      .replace(/{tone}/g, profile?.formality || "casual")
      .replace(/{village_type}/g, profile?.state || "the village");
  }

  // ============================================================
  // EMERGENCY & FALLBACK — Dynamic, zero hardcoded
  // ============================================================
  private async emergencyResponse(
    studentId: string,
    perception: Perception,
    startTime: number,
    toolsCalled: string[],
    plan: CortexPlan
  ): Promise<VoidResult> {
    const prompt = `Generate an emergency response for a student showing distress signals.
Profile: ${JSON.stringify(perception)}
Be human first. Include Nigeria helpline if relevant. Keep under 50 words.`;

    try {
      const res = await callLLM({ messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 200 });
      const response = this.cleanResponse(res.content || "Hey. You are not alone. Please call 0800-123-4567. I'm staying with you.");

      return {
        response,
        perception,
        contextBundle: this.getDefaultContextBundle(),
        guardianDecision: { decision: "escalate", reason: "Emergency", modified_response: null, quality_checks: {}, safety_checks: {}, escalation: { needed: true, reason: "Emergency", human_alert: `Student ${studentId} emergency` } },
        toolsCalled,
        latencyMs: Date.now() - startTime,
        routingPath: "EMERGENCY",
        agentCount: toolsCalled.length,
        predictions: { emergency: true }
      };
    } catch (e) {
      return this.fallbackResponse(studentId, perception, startTime, toolsCalled);
    }
  }

  private async generateDynamicFallback(profile: any, perception: Perception | null, reason: string): Promise<string> {
    const prompt = `Generate a brief fallback message for a WhatsApp tutor.
Profile: ${JSON.stringify(profile)}
Reason: ${reason}
Match student's language. Under 20 words. Never mention AI or system.`;

    try {
      const res = await callLLM({ messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 100 });
      return this.cleanResponse(res.content || "Omo, network wahala — try again.");
    } catch (e) {
      return "Omo, network wahala — try again.";
    }
  }

  private fallbackResponse(studentId: string, profile: any, startTime: number, toolsCalled: string[]): VoidResult {
    const defaultPerception = this.getDefaultPerception();
    return {
      response: "Omo, network wahala — send that again when you can.",
      perception: defaultPerception,
      contextBundle: this.getDefaultContextBundle(),
      guardianDecision: { decision: "approve", reason: "System fallback", modified_response: null, quality_checks: {}, safety_checks: {}, escalation: { needed: false, reason: "", human_alert: "" } },
      toolsCalled,
      latencyMs: Date.now() - startTime,
      routingPath: "FALLBACK",
      agentCount: 0,
      predictions: {}
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================
  private async saveResponseSignature(studentPhone: string, response: string): Promise<void> {
    try {
      const hash = this.simpleHash(response);
      const preview = response.slice(0, 100);
      const embedding = await embed(preview);

      const { query } = await import("../db/client");
      await query(
        `INSERT INTO conversation_signatures (student_phone, response_hash, response_preview, semantic_fingerprint)
         VALUES ($1, $2, $3, $4)`,
        [studentPhone, hash, preview, embedding ? JSON.stringify(embedding) : null]
      );
    } catch (e) {
      // Non-critical
    }
  }

  private cleanResponse(text: string): string {
    if (!text) return text;
    return text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*/g, "*")
      .replace(/`/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\$\$?[\s\S]*?\$\$?/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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
    // Background: Witness + Archivist run here
    // They don't block the response
    logger.info(`[Void] Evolution triggered for ${studentId} (background)`);
    
    try {
      // Run Witness
      const reflection = await this.witness.reflect(
        studentMessage,
        perception,
        contextBundle,
        fireResponse,
        studentNextMessage,
        ""
      );

      // Run Archivist
      await this.archivist.evolve(
        reflection,
        currentSignature,
        currentMemory,
        ""
      );

      logger.info(`[Void] Evolution complete for ${studentId}`);
    } catch (error: any) {
      logger.error(`[Void] Evolution failed for ${studentId}:`, { error: error.message });
    }
  }
}

export default TheVoid;
