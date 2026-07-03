// FILE: src/consciousness/TheOracle.ts
// THE ORACLE — Meta-Agent Supervisor

import { callLLM } from "../llm/client";
import { query, queryOne } from "../db/client";
import { logger } from "../utils/logger";

export interface OraclePlan {
  orchestration: {
    agents: string[];
    skip: string[];
    reason: string;
  };
  prompts: Record<string, string>;
  tools: string[];
  predictions: {
    next_struggle?: string;
    burnout_risk: number;
    recommended_action: string;
    emotional_shift?: string;
  };
  emergency_flags: string[];
  meta_directives: string[];
}

export interface OracleContext {
  studentPhone: string;
  message: string;
  history: string[];
  profile: any;
  engagement: any;
  recentPredictions: any[];
}

export class TheOracle {
  private maxRetries = 2;

  async generatePlan(ctx: OracleContext): Promise<OraclePlan> {
    const startTime = Date.now();

    // FIX: Don't use fast path if burnout risk is high
    // Check if burnout risk is high from recent predictions
    const burnoutRisk = ctx.recentPredictions?.[0]?.burnoutRisk || 0;
    const isHighBurnout = burnoutRisk > 0.7;

    if (this.shouldUseFastPath(ctx) && !isHighBurnout) {
      logger.info("Oracle using fast path", {
        student: ctx.studentPhone,
        messageLength: ctx.message.length
      });
      return this.getFastPathPlan(ctx);
    }

    const timeoutMs = this.calculateTimeout(ctx);

    try {
      const result = await Promise.race([
        this.generatePlanWithRetry(ctx, startTime),
        this.timeoutPlan(ctx, timeoutMs)
      ]);
      return result;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn("Oracle plan generation failed", {
        error: errMsg,
        student: ctx.studentPhone
      });
      return this.getDefaultPlan();
    }
  }

  private shouldUseFastPath(ctx: OracleContext): boolean {
    if (!ctx.engagement || ctx.engagement.avgRecentMessageLength === null) {
      return ctx.message.length < 5;
    }

    const avgLength = ctx.engagement.avgRecentMessageLength;
    const threshold = Math.max(avgLength * 0.3, 3);

    const quickResponses = ['hi', 'hey', 'hello', 'ok', 'okay', 'yes', 'no',
      'thanks', 'thank you', 'cool', 'fine', 'good',
      'hmm', 'aha', 'alright', 'sure', 'yeah', 'na'];
    const isQuickResponse = quickResponses.some(
      g => ctx.message.toLowerCase().trim() === g
    );

    return ctx.message.length < threshold || isQuickResponse;
  }

  private getFastPathPlan(ctx: OracleContext): OraclePlan {
    return {
      orchestration: {
        // FIX: Always include mirror to perceive the message
        agents: ["mirror", "fire"],
        skip: ["river", "guardian", "witness", "archivist"],
        reason: "Fast path: short message or greeting"
      },
      prompts: {},
      tools: ["get_student_profile"],
      predictions: {
        burnout_risk: 0.2,
        recommended_action: "casual_response"
      },
      emergency_flags: [],
      meta_directives: [
        "Student sent a short message. Respond casually and warmly.",
        "Keep response under 15 words.",
        "Match their energy — if they sent 3 words, reply with 3-5 words."
      ]
    };
  }

  private calculateTimeout(ctx: OracleContext): number {
    let timeoutMs = 3000;

    if (ctx.engagement?.label === "low_effort") {
      timeoutMs = 2000;
    } else if (ctx.engagement?.label === "normal") {
      timeoutMs = 3000;
    } else {
      timeoutMs = 2500;
    }

    if (ctx.message.length > 100) {
      timeoutMs += 1000;
    }
    if (ctx.message.length > 200) {
      timeoutMs += 1000;
    }

    if (ctx.profile?.confidence_baseline === "low") {
      timeoutMs += 1000;
    }

    return Math.min(timeoutMs, 5000);
  }

  private timeoutPlan(ctx: OracleContext, timeoutMs: number): Promise<OraclePlan> {
    return new Promise((resolve) => {
      setTimeout(() => {
        logger.info("Oracle timeout — using fallback", {
          student: ctx.studentPhone,
          timeoutMs,
          messagePreview: ctx.message.slice(0, 30)
        });
        resolve({
          orchestration: {
            agents: ["mirror", "river", "fire", "guardian"],
            skip: ["witness", "archivist"],
            reason: `Oracle timeout after ${timeoutMs}ms — using default pipeline`
          },
          prompts: {},
          tools: ["get_student_profile", "search_past_conversations"],
          predictions: {
            burnout_risk: 0.3,
            recommended_action: "continue"
          },
          emergency_flags: [],
          meta_directives: []
        });
      }, timeoutMs);
    });
  }

  private calculateTemperature(ctx: OracleContext): number {
    const confidence = ctx.profile?.confidence_baseline || "medium";

    const temperatureMap: Record<string, number> = {
      "high": 0.7,
      "medium": 0.4,
      "low": 0.2,
      "unknown": 0.3
    };

    let temp = temperatureMap[confidence] || 0.3;

    if (ctx.engagement?.label === "low_effort") {
      temp = Math.min(temp + 0.2, 0.8);
    }

    if (ctx.recentPredictions?.some((p: any) => p.burnoutRisk > 0.5)) {
      temp = Math.min(temp + 0.3, 0.8);
    }

    const frustrationWords = ['dont get', 'confus', 'terrible', 'hate', 'fail', 'stupid'];
    if (frustrationWords.some(w => ctx.message.toLowerCase().includes(w))) {
      temp = Math.max(temp - 0.2, 0.1);
    }

    return Math.min(Math.max(temp, 0.1), 0.8);
  }

  private async generatePlanWithRetry(ctx: OracleContext, startTime: number): Promise<OraclePlan> {
    const archetype = await this.detectArchetype(ctx.profile);
    const successfulPatterns = await this.loadPatternsForArchetype(archetype);
    const recentPlans = await this.loadRecentPlans(ctx.studentPhone);

    const oraclePrompt = await this.buildOraclePrompt(
      ctx,
      archetype,
      successfulPatterns,
      recentPlans
    );

    const temperature = this.calculateTemperature(ctx);

    const messages = [
      { role: "system", content: oraclePrompt },
      {
        role: "user",
        content: `Student message: "${ctx.message}"\n\nGenerate the orchestration plan as JSON only.`
      }
    ];

    const response = await this.callWithRetry(messages, {
      temperature: temperature,
      max_tokens: 1500,
      model: "groq"
    });

    const plan = this.parsePlan(response);
    plan.prompts = await this.generateDynamicPrompts(plan, ctx, archetype);

    await this.logPlan(ctx.studentPhone, ctx.message, plan, Date.now() - startTime);

    return plan;
  }

  private async detectArchetype(profile: any): Promise<any> {
    const features = {
      learning_style: profile?.learning_style?.primary || "unknown",
      background: profile?.city ? "city" : "village",
      subject: profile?.goals?.[0]?.subject || "any",
      confidence: profile?.confidence_baseline || "medium",
      language: profile?.preferred_language || "english"
    };

    const row = await queryOne(
      `SELECT * FROM student_archetypes 
       ORDER BY feature_vector <-> $1::jsonb 
       LIMIT 1`,
      [JSON.stringify(features)]
    );

    return row || { archetype_name: "unknown", archetype_id: null };
  }

  private async loadPatternsForArchetype(archetype: any): Promise<any[]> {
    if (!archetype?.archetype_id) return [];

    return query(
      `SELECT * FROM teaching_patterns 
       WHERE archetype_signature @> $1::jsonb
       AND success_rate > 0.6
       ORDER BY success_rate DESC 
       LIMIT 5`,
      [JSON.stringify({ archetype_id: archetype.archetype_id })]
    );
  }

  private async loadRecentPlans(studentPhone: string): Promise<any[]> {
    return query(
      `SELECT plan, predictions, was_successful 
       FROM orchestration_plans 
       WHERE student_phone = $1 
       ORDER BY executed_at DESC 
       LIMIT 5`,
      [studentPhone]
    );
  }

  private async buildOraclePrompt(
    ctx: OracleContext,
    archetype: any,
    patterns: any[],
    recentPlans: any[]
  ): Promise<string> {
    return `You are THE ORACLE — the meta-consciousness of Wax.

Your job: Analyze the student and generate an ORCHESTRATION PLAN.

## STUDENT CONTEXT
- Phone: ${ctx.studentPhone}
- Archetype: ${archetype?.archetype_name || "unknown"}
- Profile: ${JSON.stringify(ctx.profile, null, 2)}
- Engagement: ${JSON.stringify(ctx.engagement, null, 2)}
- Recent predictions: ${JSON.stringify(ctx.recentPredictions, null, 2)}

## SUCCESSFUL PATTERNS FOR THIS ARCHETYPE
${patterns.map((p: any) => `- ${p.pattern_type}: ${JSON.stringify(p.pattern_data)} (success: ${p.success_rate})`).join('\n')}

## RECENT ORCHESTRATION HISTORY
${recentPlans.map((p: any) => `- Agents: ${p.plan?.orchestration?.agents?.join(',')}, Success: ${p.was_successful}`).join('\n')}

## AGENTS AVAILABLE
- mirror: Perceives emotion, intent, risk, cultural signals (REQUIRED for context)
- river: Retrieves context, memories, concepts
- fire: Generates the actual response (ONLY agent that speaks to student)
- guardian: Reviews output for safety and quality
- witness: Reflects on interaction quality (background only)
- archivist: Updates memory (background only)

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "orchestration": {
    "agents": ["mirror", "river", "fire", "guardian"],
    "skip": ["witness", "archivist"],
    "reason": "Student is in casual chat mode, no need for deep reflection"
  },
  "tools": ["get_student_profile", "search_past_conversations"],
  "predictions": {
    "next_struggle": "kinematics",
    "burnout_risk": 0.3,
    "recommended_action": "switch_to_story_mode",
    "emotional_shift": "increasing_confidence"
  },
  "emergency_flags": [],
  "meta_directives": ["Use wheelbarrow analogies", "Student is ashamed of physics foundation"]
}

## RULES
- If burnout_risk > 0.7, still run Mirror to understand the student's message. Skip River and Guardian for speed.
- If student said "I don't get it" 3+ times, add directive: "Switch analogy completely"
- If student is new (< 5 messages), ALWAYS include mirror and river.
- NEVER skip mirror completely. It's needed to perceive the student's actual message.
- NEVER skip guardian unless in burnout mode.
- Witness and archivist are background-only. They never block the response.`;
  }

  private parsePlan(raw: string): OraclePlan {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        orchestration: parsed.orchestration || {
          agents: ["mirror", "river", "fire", "guardian"],
          skip: ["witness", "archivist"],
          reason: "default"
        },
        prompts: parsed.prompts || {},
        tools: parsed.tools || [],
        predictions: parsed.predictions || {
          burnout_risk: 0.3,
          recommended_action: "continue"
        },
        emergency_flags: parsed.emergency_flags || [],
        meta_directives: parsed.meta_directives || []
      };
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("Oracle parse error", { error: errMsg });
      return this.getDefaultPlan();
    }
  }

  private getDefaultPlan(): OraclePlan {
    return {
      orchestration: {
        agents: ["mirror", "river", "fire", "guardian"],
        skip: ["witness", "archivist"],
        reason: "Oracle failed — defaulting to full pipeline"
      },
      prompts: {},
      tools: ["get_student_profile"],
      predictions: {
        burnout_risk: 0.3,
        recommended_action: "continue"
      },
      emergency_flags: [],
      meta_directives: []
    };
  }

  private async generateDynamicPrompts(
    plan: OraclePlan,
    ctx: OracleContext,
    archetype: any
  ): Promise<Record<string, string>> {
    const prompts: Record<string, string> = {};
    const genes = await this.fetchRelevantGenes(ctx, archetype, plan);

    for (const agent of plan.orchestration.agents) {
      prompts[agent] = await this.composePromptForAgent(agent, genes, ctx, plan);
    }

    return prompts;
  }

  private async fetchRelevantGenes(
    ctx: OracleContext,
    archetype: any,
    plan: OraclePlan
  ): Promise<any[]> {
    const conditions: string[] = [];

    if (ctx.profile.formality === "casual") conditions.push("pidgin_casual");
    else if (ctx.profile.formality === "formal") conditions.push("formal_nigerian");

    if (ctx.profile.city?.toLowerCase().includes("lagos")) conditions.push("danfo_context");
    else if (!ctx.profile.city) conditions.push("farm_context");

    if (plan.predictions.burnout_risk > 0.5) conditions.push("burnout_detected");
    if (ctx.message.toLowerCase().includes("foundation") ||
      ctx.message.toLowerCase().includes("terrible")) {
      conditions.push("shame_safety");
    }

    conditions.push("socratic_question", "analogy_first");
    conditions.push("character_lock", "repetition_guard");
    conditions.push("whatsapp_short");

    if (plan.meta_directives.length > 0) {
      conditions.push("oracle_directive");
    }

    if (conditions.length === 0) return [];

    const placeholders = conditions.map((_, i) => `$${i + 1}`).join(',');
    return query(
      `SELECT * FROM prompt_genes WHERE gene_name IN (${placeholders})`,
      conditions
    );
  }

  private async composePromptForAgent(
    agent: string,
    genes: any[],
    ctx: OracleContext,
    plan: OraclePlan
  ): Promise<string> {
    const agentSpecificGenes = genes.filter((g: any) => {
      if (agent === "fire") return !["meta"].includes(g.gene_type);
      if (agent === "mirror") return ["persona", "emotional", "safety"].includes(g.gene_type);
      if (agent === "river") return ["persona", "teaching", "meta"].includes(g.gene_type);
      if (agent === "guardian") return ["safety", "format", "character_lock"].includes(g.gene_type);
      return true;
    });

    let prompt = "";

    const personaGene = agentSpecificGenes.find((g: any) => g.gene_type === "persona");
    if (personaGene) {
      prompt += this.fillTemplate(personaGene.gene_template, ctx) + "\n\n";
    }

    const agentIdentity = this.getAgentIdentity(agent);
    prompt += agentIdentity + "\n\n";

    for (const gene of agentSpecificGenes.filter((g: any) => g.gene_type !== "persona")) {
      const filled = this.fillTemplate(gene.gene_template, ctx, plan);
      prompt += filled + "\n\n";
    }

    for (const directive of plan.meta_directives) {
      prompt += `DIRECTIVE: ${directive}\n`;
    }

    if (agent === "fire") {
      const recentHashes = await this.getRecentResponseHashes(ctx.studentPhone);
      prompt += `\nRECENT RESPONSE SIGNATURES (DO NOT REPEAT THESE):\n${recentHashes.join('\n')}\n`;
    }

    return prompt.trim();
  }

  private getAgentIdentity(agent: string): string {
    const identities: Record<string, string> = {
      mirror: "You are the Mirror. You perceive the student. Read their message and detect intent, emotion, shame signals, risk flags, and cultural signals. Output a structured perception as JSON. Never speak to the student.",
      river: "You are the River. You retrieve and build context. Based on the perception and student profile, retrieve relevant memories, concepts, and relational notes. Output a context bundle as JSON. Never speak to the student.",
      fire: "You are Wax. You generate responses to the student. You are the ONLY agent that speaks to the student. Acknowledge emotion. Use examples from their world. Keep messages short and human. Never mention tools or agents. Never break character.",
      guardian: "You are the Guardian. Review every response before it reaches the student. Check for harmful content, leaked tool names, markdown formatting, inappropriate tone, cultural insensitivity, and missed distress signals. Output JSON decision. Never speak to the student.",
      witness: "You are the Witness. Observe and reflect on every interaction. Identify what worked, what failed, missed emotional cues, and patterns. Output reflection as JSON. Never speak to the student.",
      archivist: "You are the Archivist. Take the Witness reflection and update memory. Save relational notes, update concepts, generate procedural rules, evolve the Teaching Signature. Output memory actions as JSON. Never speak to the student."
    };
    return identities[agent] || "";
  }

  private fillTemplate(template: string, ctx: OracleContext, plan?: OraclePlan): string {
    let filled = template;
    filled = filled.replace(/{student_world}/g, ctx.profile.city || "Nigeria");
    filled = filled.replace(/{tone}/g, ctx.profile.formality || "casual");
    filled = filled.replace(/{village_type}/g, ctx.profile.state || "the village");
    filled = filled.replace(/{oracle_insight}/g, plan?.meta_directives?.join("; ") || "none");
    return filled;
  }

  private async getRecentResponseHashes(studentPhone: string): Promise<string[]> {
    const rows = await query<{ response_preview: string }>(
      `SELECT response_preview FROM conversation_signatures 
       WHERE student_phone = $1 
       ORDER BY created_at DESC 
       LIMIT 3`,
      [studentPhone]
    );
    return rows.map((r: any) => r.response_preview);
  }

  private async callWithRetry(messages: any[], opts: any): Promise<string> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await callLLM({
          messages,
          temperature: opts.temperature || 0.2,
          max_tokens: opts.max_tokens || 1500,
          model: opts.model || "groq"
        });
        return res.content || "";
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (i === this.maxRetries - 1) throw new Error(errMsg);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
    return "";
  }

  private async logPlan(
    studentPhone: string,
    message: string,
    plan: OraclePlan,
    latencyMs: number
  ): Promise<void> {
    await query(
      `INSERT INTO orchestration_plans (student_phone, message_fingerprint, plan, predictions, latency_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        studentPhone,
        message.slice(0, 100),
        JSON.stringify({
          orchestration: plan.orchestration,
          tools: plan.tools,
          meta_directives: plan.meta_directives
        }),
        JSON.stringify(plan.predictions),
        latencyMs
      ]
    );
  }
}

export default TheOracle;
