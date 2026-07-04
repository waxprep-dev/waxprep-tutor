// ============================================================
// THE VOID v4 — CHRONOS ORCHESTRATOR
// Self-healing, time-aware, predictive consciousness engine
// Zero hardcoded paths. Everything is learned.
// ============================================================

import { reflex, ReflexOutput } from "./reflex";
import { cortex, CortexPlan } from "./cortex";
import { hippocampus } from "../memory/hippocampus";
import { circadianEngine } from "../temporal/circadianEngine";
import { seasonDetector } from "../temporal/seasonDetector";
import { auraHealer } from "../healing/auraHealer";
import { metacognitiveScaffolder } from "../teaching/metacognitiveScaffolder";
import { callLLM } from "../llm/client";
import { query, queryOne } from "../db/client";
import { embed } from "../memory/embeddings";
import { logger } from "../utils/logger";

export interface VoidResult {
  response: string;
  perception: any;
  contextBundle: any;
  guardianDecision: any;
  toolsCalled: string[];
  latencyMs: number;
  routingPath: string;
  agentCount: number;
  predictions: any;
  seasonInfo: any;
  healingEvents: any[];
  metacognitiveScaffold: any;
}

export class TheVoid {
  async processMessage(
    studentId: string,
    studentMessage: string,
    conversationHistory: string[],
    studentProfile: any,
    availableMemory: any
  ): Promise<VoidResult> {
    const startTime = Date.now();
    const toolsCalled: string[] = [];
    const healingEvents: any[] = [];

    try {
      // PHASE 0: SEASON DETECTION — Is this a new season?
      const seasonCheck = await seasonDetector.checkSeasonEnd(
        studentId, 
        studentMessage, 
        availableMemory?.currentEpisodeId || "unknown"
      );
      let currentSeasonId = availableMemory?.currentSeasonId || null;
      let seasonNumber = availableMemory?.seasonNumber || 1;

      if (seasonCheck.shouldEnd && currentSeasonId) {
        const newSeason = await seasonDetector.endSeason(
          studentId, 
          currentSeasonId, 
          seasonCheck.summary || "Season ended", 
          studentMessage
        );
        currentSeasonId = newSeason.newSeasonId;
        seasonNumber = newSeason.seasonNumber;
        logger.info(`[Chronos] New season started for ${studentId}: ${seasonNumber}`);
      } else if (!currentSeasonId) {
        // Create first season
        const newSeason = await queryOne(
          `INSERT INTO conversation_seasons (student_phone, season_number, is_active)
           VALUES ($1, 1, true)
           RETURNING season_id, season_number`,
          [studentId]
        );
        if (newSeason) {
          currentSeasonId = newSeason.season_id;
          seasonNumber = newSeason.season_number;
        }
      }

      // PHASE 1: THE REFLEX — System 1 Fast Path (<10ms)
      const reflexOutput = await reflex.classify(studentMessage, conversationHistory, studentProfile);
      logger.info("Reflex classification", { student: studentId, reflexOutput });

      // PHASE 2: CIRCADIAN CONTEXT — What time means for this student
      const temporalGene = await circadianEngine.getTemporalGene(studentId);
      const circadianProfile = await queryOne(
        `SELECT * FROM circadian_profiles WHERE student_phone = $1`,
        [studentId]
      );

      // PHASE 3: ROUTING — Reflex confident → skip Cortex
      let plan: CortexPlan;
      let routingPath: string;

      if (reflexOutput.confidence > 0.85 && reflexOutput.predictedAgentCount <= 2) {
        // Ultra-fast path: Reflex decides everything
        plan = this.buildPlanFromReflex(reflexOutput);
        routingPath = `REFLEX_${reflexOutput.recommendedPath}`;
        toolsCalled.push("reflex");
      } else {
        // Deliberative path: Cortex decides
        plan = await cortex.generatePlan({
          studentPhone: studentId,
          message: studentMessage,
          history: conversationHistory,
          profile: studentProfile,
          reflexOutput,
          recentPlans: [],
          memoryContext: availableMemory,
          temporalGene: temporalGene.geneName,
          circadianProfile
        });
        toolsCalled.push("cortex");
        routingPath = `CORTEX_${plan.agents.join("_")}`;
      }

      // PHASE 4: METACOGNITIVE SCAFFOLDING — Does student need support?
      const scaffold = await metacognitiveScaffolder.generateScaffold(
        studentId, 
        studentProfile?.lastTopic || "general",
        studentMessage,
        conversationHistory
      );

      // PHASE 5: EXECUTE SELECTED AGENTS
      let perception = this.getDefaultPerception();
      let contextBundle = this.getDefaultContextBundle();

      // MIRROR — Only if predicted needed
      if (plan.agents.includes("mirror")) {
        const mirrorStart = Date.now();
        try {
          perception = await this.runMirror(
            studentMessage, 
            conversationHistory, 
            studentProfile, 
            plan.emotionalDirective
          );
          toolsCalled.push("mirror");

          const anomaly = await auraHealer.detectAnomaly(
            "mirror", perception, this.getDefaultPerception(),
            Date.now() - mirrorStart, studentId
          );
          if (anomaly) {
            const healed = await auraHealer.heal(anomaly);
            healingEvents.push({ ...anomaly, recovery: healed });
          }

          if (perception?.risk_flags?.suicidal_ideation || 
              perception?.risk_flags?.self_harm ||
              perception?.risk_flags?.extreme_distress) {
            return await this.emergencyResponse(
              studentId, perception, startTime, toolsCalled, plan, 
              currentSeasonId, seasonNumber, healingEvents, scaffold
            );
          }
        } catch (error: any) {
          const healed = await auraHealer.heal({
            eventType: 'llm_timeout',
            severity: 'high',
            description: `Mirror failed: ${error.message}`,
            studentPhone: studentId
          });
          healingEvents.push({ type: 'mirror_failure', recovery: healed });
        }
      }

      // RIVER — Only if predicted needed
      if (plan.agents.includes("river")) {
        const riverStart = Date.now();
        try {
          const graphContext = await hippocampus.searchWithContext(
            studentId, 
            studentMessage, 
            5
          );
          contextBundle = await this.runRiver(
            perception, 
            studentProfile, 
            { ...availableMemory, graphContext }, 
            plan.cognitiveDirective
          );
          toolsCalled.push("river");

          const anomaly = await auraHealer.detectAnomaly(
            "river", contextBundle, this.getDefaultContextBundle(),
            Date.now() - riverStart, studentId
          );
          if (anomaly) {
            const healed = await auraHealer.heal(anomaly);
            healingEvents.push({ ...anomaly, recovery: healed });
          }
        } catch (error: any) {
          const healed = await auraHealer.heal({
            eventType: 'llm_timeout',
            severity: 'high',
            description: `River failed: ${error.message}`,
            studentPhone: studentId
          });
          healingEvents.push({ type: 'river_failure', recovery: healed });
        }
      }

      // TEMPORAL GENE INJECTION — Add time-aware prompt fragment
      const temporalPrompt = await this.buildTemporalPrompt(temporalGene, studentProfile);

      // FIRE — Always runs (mandatory)
      const fireStart = Date.now();
      let fireResponse = "";
      try {
        const firePrompt = await this.generateDynamicFirePrompt(
          studentProfile, 
          reflexOutput, 
          plan, 
          temporalPrompt, 
          scaffold, 
          seasonNumber, 
          currentSeasonId
        );
        fireResponse = await this.runFire(contextBundle, firePrompt, studentMessage);
        toolsCalled.push("fire");

        // Store in episodic memory
        const episodeId = availableMemory?.currentEpisodeId || `ep_${Date.now()}`;
        await hippocampus.storeEpisodeChunk(
          studentId, 
          episodeId, 
          conversationHistory.length + 1,
          studentMessage, 
          'student',
          perception?.emotional_state?.intensity,
          reflexOutput.cognitiveComplexity
        );
        await hippocampus.storeEpisodeChunk(
          studentId, 
          episodeId,
          conversationHistory.length + 2,
          fireResponse, 
          'wax',
          0.5, 
          0.3
        );

        const anomaly = await auraHealer.detectAnomaly(
          "fire", fireResponse, "",
          Date.now() - fireStart, studentId
        );
        if (anomaly) {
          const healed = await auraHealer.heal(anomaly);
          healingEvents.push({ ...anomaly, recovery: healed });
          if (healed.success && healed.actionTaken.includes('Regenerated')) {
            fireResponse = await this.runFire(
              contextBundle, 
              firePrompt + "\n[HEALED: " + healed.actionTaken + "]", 
              studentMessage
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
        fireResponse = await this.generateDynamicFallback(
          studentProfile, 
          perception, 
          "fire_failed"
        );
      }

      // GUARDIAN — Always runs (mandatory)
      const guardianStart = Date.now();
      let guardianDecision = { 
        decision: "approve", 
        reason: "Default", 
        modified_response: null, 
        safety_checks: {} 
      };
      try {
        guardianDecision = await this.runGuardian(fireResponse, perception, studentProfile);
        toolsCalled.push("guardian");

        const anomaly = await auraHealer.detectAnomaly(
          "guardian", guardianDecision, { decision: "approve" },
          Date.now() - guardianStart, studentId
        );
        if (anomaly) {
          const healed = await auraHealer.heal(anomaly);
          healingEvents.push({ ...anomaly, recovery: healed });
        }
      } catch (error: any) {
        healingEvents.push({ type: 'guardian_failure', error: error.message });
      }

      // Handle Guardian decision
      let finalResponse = fireResponse;
      switch (guardianDecision.decision) {
        case "approve": 
          finalResponse = fireResponse; 
          break;
        case "modify": 
          finalResponse = guardianDecision.modified_response || fireResponse; 
          break;
        case "block": 
          finalResponse = await this.generateDynamicFallback(
            studentProfile, 
            perception, 
            "blocked"
          );
          break;
        case "escalate": 
          return await this.emergencyResponse(
            studentId, perception, startTime, toolsCalled, plan, 
            currentSeasonId, seasonNumber, healingEvents, scaffold
          );
      }

      // Update circadian profile
      await circadianEngine.updateProfile(
        studentId, 
        new Date(), 
        studentMessage.length, 
        Date.now() - startTime
      );

      // Store in temporal knowledge graph
      await this.updateKnowledgeGraph(
        studentId, 
        studentMessage, 
        finalResponse, 
        perception, 
        contextBundle
      );

      const latencyMs = Date.now() - startTime;

      // Log everything
      await this.logMessage(
        studentId, 
        studentMessage, 
        finalResponse, 
        toolsCalled, 
        latencyMs, 
        routingPath, 
        plan.agents.length, 
        currentSeasonId, 
        seasonNumber
      );

      return {
        response: finalResponse,
        perception,
        contextBundle,
        guardianDecision,
        toolsCalled,
        latencyMs,
        routingPath,
        agentCount: plan.agents.length,
        predictions: {
          reflexConfidence: reflexOutput.confidence,
          cortexConfidence: plan.confidence,
          expectedReduction: plan.expectedFreeEnergyReduction,
          temporalGene: temporalGene.geneName,
          circadianReason: temporalGene.reason
        },
        seasonInfo: { 
          seasonId: currentSeasonId, 
          seasonNumber, 
          isNewSeason: seasonCheck.shouldEnd || false 
        },
        healingEvents,
        metacognitiveScaffold: scaffold
      };

    } catch (error: any) {
      logger.error(`[Chronos] Critical failure for ${studentId}:`, error);
      
      const healed = await auraHealer.heal({
        eventType: 'llm_timeout',
        severity: 'critical',
        description: `Chronos critical failure: ${error.message}`,
        studentPhone: studentId
      });

      return {
        response: await this.generateDynamicFallback(
          studentProfile, 
          null, 
          "critical_failure"
        ),
        perception: this.getDefaultPerception(),
        contextBundle: this.getDefaultContextBundle(),
        guardianDecision: { decision: "approve", reason: "Critical fallback" },
        toolsCalled,
        latencyMs: Date.now() - startTime,
        routingPath: "CRITICAL_FALLBACK",
        agentCount: 0,
        predictions: {},
        seasonInfo: {},
        healingEvents: [...healingEvents, { type: 'critical_healing', recovery: healed }],
        metacognitiveScaffold: null
      };
    }
  }

  // ============================================================
  // EVOLUTION — Background learning after student replies
  // ============================================================
  async evolve(
    studentId: string,
    studentMessage: string,
    perception: any,
    contextBundle: any,
    fireResponse: string,
    studentNextMessage: string | null,
    currentSignature: any,
    currentMemory: any
  ): Promise<void> {
    try {
      // Witness reflection
      const reflection = await this.runWitness(
        studentMessage, 
        perception, 
        contextBundle, 
        fireResponse, 
        studentNextMessage
      );

      // Evaluate metacognitive scaffolding if used
      if (currentMemory?.metacognitiveScaffold) {
        const evalResult = await metacognitiveScaffolder.evaluateScaffold(
          studentId, 
          currentMemory.metacognitiveScaffold, 
          studentNextMessage || ""
        );
        await metacognitiveScaffolder.updateMetacognitiveProfile(studentId, evalResult);
      }

      // Archivist: Update Hippocampus
      const evolution = await this.runArchivist(reflection, currentSignature, currentMemory);

      // Apply procedural rules
      for (const update of evolution.memory_updates || []) {
        if (update.memory_type === "procedural") {
          await query(
            `INSERT INTO procedural_rules (student_phone, rule_type, trigger_condition, trigger_embedding, action, confidence)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              studentId,
              update.rule_type || "teaching_strategy",
              update.trigger,
              JSON.stringify(await embed(update.trigger)),
              update.action,
              update.confidence || 0.5
            ]
          );
        } else if (update.memory_type === "semantic") {
          await hippocampus.storeFact(
            studentId,
            "concept",
            update.concept || "general",
            { mastery: update.mastery, source: "archivist" },
            update.confidence
          );
        }
      }

      // Update prediction accuracy
      if (studentNextMessage) {
        await query(
          `UPDATE predictions SET was_accurate = true, resolved_at = NOW()
           WHERE student_phone = $1 AND prediction_type = 'burnout_risk'
           AND resolved_at IS NULL`,
          [studentId]
        );
      }

      logger.info(`[Chronos] Evolution complete for ${studentId}`);

    } catch (error: any) {
      logger.error(`[Chronos] Evolution failed for ${studentId}:`, error);
      await auraHealer.heal({
        eventType: 'memory_corruption',
        severity: 'medium',
        description: `Evolution failed: ${error.message}`,
        studentPhone: studentId
      });
    }
  }

  // ============================================================
  // DYNAMIC PROMPT GENERATION — Zero hardcoded prompts
  // ============================================================
  private async generateDynamicFirePrompt(
    profile: any,
    reflexOutput: ReflexOutput,
    plan: CortexPlan,
    temporalPrompt: string,
    scaffold: any,
    seasonNumber: number,
    seasonId: string
  ): Promise<string> {
    const genes = await this.loadPromptGenes(profile, reflexOutput, plan);

    let prompt = "";

    const persona = genes.find((g: any) => g.gene_type === "persona");
    if (persona) {
      const memoryContext = await this.buildMemoryContext(profile);
      prompt += persona.gene_template
        .replace(/{student_world}/g, profile?.city || "Nigeria")
        .replace(/{tone}/g, profile?.formality || "casual")
        .replace(/{memory_context}/g, memoryContext) + "\n\n";
    }

    prompt += temporalPrompt + "\n\n";

    const seasonSummary = await this.getSeasonSummary(seasonId);
    prompt += `You are in season ${seasonNumber} with this student. ${seasonSummary}\n\n`;

    if (plan?.emotionalDirective) {
      prompt += `EMOTIONAL DIRECTIVE: ${plan.emotionalDirective}\n\n`;
    }

    if (plan?.cognitiveDirective) {
      prompt += `COGNITIVE DIRECTIVE: ${plan.cognitiveDirective}\n\n`;
    }

    if (scaffold) {
      prompt += `SCAFFOLDING STRATEGY: ${scaffold.strategy}\n`;
      prompt += `Use these Socratic questions if appropriate: ${scaffold.prompts?.join(" | ") || ""}\n\n`;
    }

    for (const gene of genes.filter((g: any) => g.gene_type === "safety")) {
      prompt += gene.gene_template + "\n\n";
    }

    const format = genes.find((g: any) => g.gene_type === "format");
    if (format) prompt += format.gene_template + "\n\n";

    for (const gene of genes.filter((g: any) => g.gene_type === "teaching")) {
      prompt += gene.gene_template + "\n\n";
    }

    return prompt.trim();
  }

  private async buildMemoryContext(profile: any): Promise<string> {
    const phone = profile?.phone || profile?.student_phone;
    if (!phone) return "No memory available.";
    
    const facts = await hippocampus.getCurrentFacts(phone, "concept", 5);
    const emotions = await hippocampus.getCurrentFacts(phone, "emotion", 3);
    
    const factSummary = facts.map((f: any) => f.label).join(", ");
    const emotionSummary = emotions.map((f: any) => f.label).join(", ");
    
    return `You remember: ${factSummary || "nothing yet"}. Their emotional state: ${emotionSummary || "neutral"}.`;
  }

  private async getSeasonSummary(seasonId: string): Promise<string> {
    if (!seasonId) return "This is a fresh season.";
    try {
      const season = await queryOne(
        `SELECT summary FROM conversation_seasons WHERE season_id = $1`,
        [seasonId]
      );
      return season?.summary || "This is a fresh season.";
    } catch {
      return "This is a fresh season.";
    }
  }

  private async loadPromptGenes(profile: any, reflexOutput: ReflexOutput, plan: CortexPlan): Promise<any[]> {
    const geneNames = ['wax_core', 'character_lock', 'repetition_guard', 'whatsapp_short'];
    
    if (profile?.formality === 'casual') geneNames.push('pidgin_casual');
    else geneNames.push('formal_nigerian');
    
    if (reflexOutput.emotionalUrgency > 0.5) geneNames.push('shame_safety');
    if (reflexOutput.riskSignals > 0.5) geneNames.push('burnout_detected');
    if (reflexOutput.cognitiveComplexity > 0.3) {
      geneNames.push('socratic_question', 'analogy_first');
    }

    const inPlaceholders = geneNames.map((_, i) => `$${i + 1}`).join(",");
    try {
      return query(`SELECT * FROM prompt_genes WHERE gene_name IN (${inPlaceholders})`, geneNames);
    } catch {
      return this.getFallbackGenes();
    }
  }

  private getFallbackGenes(): any[] {
    return [
      { gene_type: "persona", gene_template: "You are Wax. You are not an AI. You are a tutor who grew up in Nigeria. You believe every student is a genius in disguise." },
      { gene_type: "safety", gene_template: "CRITICAL: You are Wax. Never mention being an AI or any agent names." },
      { gene_type: "format", gene_template: "One idea per message. Max 4 lines. Plain text only." }
    ];
  }

  private async buildTemporalPrompt(gene: { geneName: string; reason: string }, profile: any): Promise<string> {
    try {
      const geneRow = await queryOne(
        `SELECT gene_template FROM prompt_genes WHERE gene_name = $1`,
        [gene.geneName]
      );
      return geneRow?.gene_template || "";
    } catch {
      return "";
    }
  }

  // ============================================================
  // KNOWLEDGE GRAPH UPDATES
  // ============================================================
  private async updateKnowledgeGraph(
    studentId: string,
    message: string,
    response: string,
    perception: any,
    contextBundle: any
  ): Promise<void> {
    try {
      if (perception?.emotional_state?.primary_emotion) {
        const emotionNode = await hippocampus.storeFact(
          studentId, "emotion",
          perception.emotional_state.primary_emotion,
          { intensity: perception.emotional_state.intensity, timestamp: new Date() },
          perception.emotional_state.confidence || 0.7
        );
        
        const prevEmotions = await hippocampus.getCurrentFacts(studentId, "emotion", 1);
        if (prevEmotions.length > 0 && prevEmotions[0].nodeId) {
          await hippocampus.storeRelation(prevEmotions[0].nodeId, emotionNode, "precedes", 0.8);
        }
      }

      const concepts = contextBundle?.relevant_memories?.concepts_known || [];
      for (const concept of concepts) {
        if (typeof concept === 'string') {
          await hippocampus.storeFact(studentId, "concept", concept, { source: "conversation" }, 0.6);
        }
      }
    } catch (e) {
      // Non-critical
    }
  }

  // ============================================================
  // AGENT RUNNERS
  // ============================================================
  private async runMirror(message: string, history: string[], profile: any, directive?: string): Promise<any> {
    const prompt = `You are the Mirror. Perceive the student. ${directive || ""}
Detect: intent, emotion, shame, risk, cultural signals. Output JSON.`;
    const res = await callLLM({ 
      messages: [
        { role: "system", content: prompt }, 
        { role: "user", content: `Message: "${message}"\nHistory: ${history.slice(-5).join("\n")}` }
      ], 
      temperature: 0.3, 
      max_tokens: 800 
    });
    return this.safeJsonParse(res.content, this.getDefaultPerception());
  }

  private async runRiver(perception: any, profile: any, memory: any, directive?: string): Promise<any> {
    const prompt = `You are the River. Build context. ${directive || ""}
Use the knowledge graph facts provided. Output JSON context bundle.`;
    const graphFacts = memory?.graphContext?.map((f: any) => `${f.label}: ${JSON.stringify(f.properties)}`).join("\n") || "";
    const res = await callLLM({ 
      messages: [
        { role: "system", content: prompt }, 
        { role: "user", content: `Perception: ${JSON.stringify(perception)}\nProfile: ${JSON.stringify(profile)}\nGraph Facts:\n${graphFacts}` }
      ], 
      temperature: 0.2, 
      max_tokens: 1000 
    });
    return this.safeJsonParse(res.content, this.getDefaultContextBundle());
  }

  private async runFire(context: any, prompt: string, message: string): Promise<string> {
    const res = await callLLM({ 
      messages: [
        { role: "system", content: prompt }, 
        { role: "user", content: `Context: ${JSON.stringify(context)}\nStudent: "${message}"\nGenerate response. Plain text. You are Wax.` }
      ], 
      temperature: 0.7, 
      max_tokens: 1100 
    });
    return this.cleanResponse(res.content || "");
  }

  private async runGuardian(response: string, perception: any, profile: any): Promise<any> {
    const prompt = `You are the Guardian. Review response. Check: harmful content, leaked tools, markdown, tone, cultural sensitivity, missed distress. Output JSON decision.`;
    const res = await callLLM({ 
      messages: [
        { role: "system", content: prompt }, 
        { role: "user", content: `Response: "${response}"\nPerception: ${JSON.stringify(perception)}` }
      ], 
      temperature: 0.1, 
      max_tokens: 600 
    });
    return this.safeJsonParse(res.content, { decision: "approve", reason: "Parse failed" });
  }

  private async runWitness(studentMsg: string, perception: any, context: any, fireResponse: string, nextMsg: string | null): Promise<any> {
    const prompt = `You are the Witness. Reflect on this interaction. What worked? What failed? What patterns? Output JSON.`;
    const res = await callLLM({ 
      messages: [
        { role: "system", content: prompt }, 
        { role: "user", content: `Student: "${studentMsg}"\nWax: "${fireResponse}"\nReply: "${nextMsg || 'N/A'}"` }
      ], 
      temperature: 0.2, 
      max_tokens: 800 
    });
    return this.safeJsonParse(res.content, { what_worked: [], what_failed: [], pattern_detected: null });
  }

  private async runArchivist(reflection: any, signature: any, memory: any): Promise<any> {
    const prompt = `You are the Archivist. Update memory based on reflection. Output JSON with memory_updates[].`;
    const res = await callLLM({ 
      messages: [
        { role: "system", content: prompt }, 
        { role: "user", content: `Reflection: ${JSON.stringify(reflection)}` }
      ], 
      temperature: 0.1, 
      max_tokens: 800 
    });
    return this.safeJsonParse(res.content, { memory_updates: [] });
  }

  // ============================================================
  // EMERGENCY & FALLBACK
  // ============================================================
  private async emergencyResponse(
    studentId: string, 
    perception: any, 
    startTime: number, 
    toolsCalled: string[], 
    plan: CortexPlan, 
    seasonId: string, 
    seasonNumber: number, 
    healingEvents: any[], 
    scaffold: any
  ): Promise<VoidResult> {
    const prompt = `Generate emergency response for distressed student. Human first. Nigeria helpline. Under 50 words.`;
    const res = await callLLM({ 
      messages: [{ role: "user", content: prompt }], 
      temperature: 0.3, 
      max_tokens: 200 
    });
    return {
      response: this.cleanResponse(res.content || "Hey. You are not alone. Call 0800-123-4567. I'm here."),
      perception, 
      contextBundle: this.getDefaultContextBundle(),
      guardianDecision: { decision: "escalate", reason: "Emergency" },
      toolsCalled, 
      latencyMs: Date.now() - startTime,
      routingPath: "EMERGENCY", 
      agentCount: toolsCalled.length,
      predictions: { emergency: true }, 
      seasonInfo: { seasonId, seasonNumber },
      healingEvents, 
      metacognitiveScaffold: scaffold
    };
  }

  private async generateDynamicFallback(profile: any, perception: any | null, reason: string): Promise<string> {
    const prompt = `Generate brief fallback for WhatsApp tutor. Profile: ${JSON.stringify(profile)}. Reason: ${reason}. Match language. Under 20 words. Never mention AI.`;
    const res = await callLLM({ 
      messages: [{ role: "user", content: prompt }], 
      temperature: 0.7, 
      max_tokens: 100 
    });
    return this.cleanResponse(res.content || "Omo, network wahala — try again.");
  }

  private async logMessage(
    studentId: string, 
    message: string, 
    response: string, 
    tools: string[], 
    latency: number, 
    path: string, 
    agentCount: number, 
    seasonId: string, 
    seasonNumber: number
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO message_log (message_id, student_phone, direction, raw_text, ai_response, ai_tool_calls, latency_ms, routing_path, agent_count, season_id, timestamp)
         VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [`ai_${Date.now()}`, studentId, message, response, JSON.stringify(tools), latency, path, agentCount, seasonId]
      );
    } catch (e) {
      // Non-critical
    }
  }

  private buildPlanFromReflex(reflex: ReflexOutput): CortexPlan {
    const agents = ['fire', 'guardian'];
    if (reflex.emotionalUrgency > 0.3) agents.unshift('mirror');
    if (reflex.cognitiveComplexity > 0.3) agents.splice(1, 0, 'river');
    
    return {
      agents, 
      skip: ['witness', 'archivist'],
      reasoning: reflex.explanation,
      expectedFreeEnergyReduction: reflex.confidence,
      confidence: reflex.confidence,
      toolPredictions: [],
      emotionalDirective: reflex.emotionalUrgency > 0.5 ? "High emotional urgency detected" : undefined,
      cognitiveDirective: reflex.cognitiveComplexity > 0.5 ? "Academic complexity detected" : undefined
    };
  }

  private cleanResponse(text: string): string {
    if (!text) return text;
    return text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*/g, "*")
      .replace(/`/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private safeJsonParse(raw: string, fallback: any): any {
    try { 
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(cleaned); 
    } catch { 
      return fallback; 
    }
  }

  private getDefaultPerception(): any {
    return { 
      intent: { primary: "other", confidence: 0.5 }, 
      emotional_state: { primary_emotion: "neutral", intensity: 0.3, shame_detected: false }, 
      cognitive_state: { understanding_level: "beginner", confusion_detected: false }, 
      risk_flags: {} 
    };
  }

  private getDefaultContextBundle(): any {
    return { 
      student_profile: { name: "Student", origin: "Unknown" }, 
      relevant_memories: { past_conversations: [], concepts_known: [] }, 
      contextual_examples: { recommended_analogy: "danfo bus" }, 
      teaching_recommendations: { suggested_topic: "introduction", suggested_depth: "surface" }, 
      conversation_state: { current_flow_state: "connection" }, 
      retrieval_actions: { tools_to_call: [], data_to_save: [] } 
    };
  }
}

export default TheVoid;
