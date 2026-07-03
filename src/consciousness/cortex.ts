// ============================================================
// THE CORTEX — System 2 Deliberative Router
// When the Reflex is uncertain, the Cortex decides.
// Uses ONE LLM call to predict which agents will reduce prediction error.
// Inspired by Intermittent Active Inference and Predictive Processing
// ============================================================

import { callLLM } from "../llm/client";
import { query } from "../db/client";
import { logger } from "../utils/logger";

export interface CortexPlan {
  agents: string[];
  skip: string[];
  reasoning: string;
  expectedFreeEnergyReduction: number; // How much will this plan reduce uncertainty?
  confidence: number;
  toolPredictions: string[]; // Which tools will likely be needed?
  emotionalDirective?: string;
  cognitiveDirective?: string;
}

export interface CortexContext {
  studentPhone: string;
  message: string;
  history: string[];
  profile: any;
  reflexOutput: any;
  recentPlans: any[];
  memoryContext: any;
}

export class Cortex {
  // ============================================================
  // THE CORE FUNCTION: Predict, don't execute
  // One LLM call → full routing plan
  // ============================================================
  async generatePlan(ctx: CortexContext): Promise<CortexPlan> {
    const prompt = this.buildPredictivePrompt(ctx);

    try {
      const response = await callLLM({
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Student message: "${ctx.message}"\n\nGenerate the routing plan as JSON only.` }
        ],
        temperature: 0.2,
        max_tokens: 800,
        agent: "cortex"
      });

      return this.parsePlan(response.content || "", ctx);
    } catch (error: any) {
      logger.error("Cortex generation failed", { error: error.message });
      return this.getDefaultPlan();
    }
  }

  // ============================================================
  // PROMPT: The Cortex is a predictive planner
  // It predicts which agents will reduce prediction error
  // ============================================================
  private buildPredictivePrompt(ctx: CortexContext): string {
    return `You are the CORTEX — the deliberative routing layer of Wax.

Your job is NOT to respond to the student. Your job is to PREDICT which cognitive resources are needed.

## ACTIVE INFERENCE PRINCIPLE
An agent should only activate resources that will reduce "expected free energy" — the gap between what we predict and what we need to know.

## STUDENT CONTEXT
- Message: "${ctx.message}"
- History (last 5): ${ctx.history.slice(-5).join(" | ")}
- Profile: ${JSON.stringify(ctx.profile, null, 2)}
- Reflex assessment: ${JSON.stringify(ctx.reflexOutput, null, 2)}
- Recent routing plans: ${ctx.recentPlans.slice(-3).map((p: any) => `${p.plan} (success: ${p.was_successful})`).join("; ")}

## AVAILABLE AGENTS
1. mirror — Perceives emotion, intent, risk, cultural signals (cost: 1 LLM call)
2. river — Retrieves context, memories, concepts (cost: 1 LLM call)
3. fire — Generates the actual response (cost: 1 LLM call, MANDATORY)
4. guardian — Reviews output for safety (cost: 1 LLM call, MANDATORY)
5. witness — Reflects on interaction quality (cost: 1 LLM call, BACKGROUND ONLY)
6. archivist — Updates memory (cost: 1 LLM call, BACKGROUND ONLY)

## DECISION RULES
- If the message is a simple greeting/acknowledgment (< 10 words, no academic content, no emotional distress): ONLY fire + guardian
- If the message contains shame, confusion, or academic struggle: mirror + river + fire + guardian
- If the message is a follow-up to a teaching moment: river + fire + guardian
- If the message contains risk signals (suicide, abuse, extreme distress): ALL agents + emergency mode
- If the Reflex is confident in a low-complexity path: TRUST THE REFLEX
- If the Reflex is uncertain: BE CONSERVATIVE, run more agents

## OUTPUT FORMAT
Return ONLY valid JSON:
{
  "agents": ["mirror", "river", "fire", "guardian"],
  "skip": ["witness", "archivist"],
  "reasoning": "Student is confused about physics foundation. Mirror needed for emotion detection. River needed for context retrieval. Fire generates response. Guardian mandatory.",
  "expectedFreeEnergyReduction": 0.7,
  "confidence": 0.85,
  "toolPredictions": ["get_student_profile", "search_past_conversations"],
  "emotionalDirective": "Student is ashamed. Start teaching immediately. Do NOT ask 'which topic?'",
  "cognitiveDirective": "Use wheelbarrow analogy. Student is from village, visual learner."
}

## CRITICAL RULES
- expectedFreeEnergyReduction must be between 0 and 1
- confidence must be between 0 and 1
- fire and guardian are ALWAYS included in agents
- witness and archivist are NEVER in the main path (they run background only)
- If expectedFreeEnergyReduction < 0.3, consider skipping mirror or river
- If confidence < 0.5, include all agents except witness/archivist`;
  }

  private parsePlan(raw: string, ctx: CortexContext): CortexPlan {
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      // Enforce mandatory agents
      const agents = new Set(parsed.agents || []);
      agents.add("fire");
      agents.add("guardian");

      // Remove background agents from main path
      agents.delete("witness");
      agents.delete("archivist");

      // Build skip list
      const allAgents = ["mirror", "river", "fire", "guardian", "witness", "archivist"];
      const skip = allAgents.filter(a => !agents.has(a));

      return {
        agents: Array.from(agents),
        skip,
        reasoning: parsed.reasoning || "No reasoning provided",
        expectedFreeEnergyReduction: Math.min(Math.max(parsed.expectedFreeEnergyReduction || 0.5, 0), 1),
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
        toolPredictions: parsed.toolPredictions || [],
        emotionalDirective: parsed.emotionalDirective,
        cognitiveDirective: parsed.cognitiveDirective
      };
    } catch (e: any) {
      logger.error("Cortex parse error", { error: e.message, raw: raw.slice(0, 200) });
      return this.getDefaultPlan();
    }
  }

  private getDefaultPlan(): CortexPlan {
    return {
      agents: ["mirror", "river", "fire", "guardian"],
      skip: ["witness", "archivist"],
      reasoning: "Cortex parse failed — defaulting to conservative plan",
      expectedFreeEnergyReduction: 0.5,
      confidence: 0.5,
      toolPredictions: ["get_student_profile", "search_past_conversations"]
    };
  }

  // ============================================================
  // LEARNING: Update from outcomes
  // Did the plan actually reduce prediction error?
  // ============================================================
  async learnFromOutcome(
    plan: CortexPlan,
    outcome: { studentSatisfied: boolean; responseQuality: number; latencyMs: number }
  ): Promise<void> {
    try {
      const { query } = await import("../db/client");
      
      await query(
        `INSERT INTO cortex_learning_log (plan_agents, skip_agents, expected_reduction, actual_quality, latency_ms, learned_adjustment)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          JSON.stringify(plan.agents),
          JSON.stringify(plan.skip),
          plan.expectedFreeEnergyReduction,
          outcome.responseQuality,
          outcome.latencyMs,
          JSON.stringify({ 
            studentSatisfied: outcome.studentSatisfied,
            agentsUsed: plan.agents.join(',')
          })
        ]
      );

      // Simple heuristic-based learning
      const learningRate = 0.05;

      if (!outcome.studentSatisfied && plan.skip.includes("mirror")) {
        // We probably missed emotional cues — increase mirror weight
        await this.updateAgentWeight("mirror", learningRate);
      }

      if (!outcome.studentSatisfied && plan.skip.includes("river")) {
        // We probably missed context — increase river weight
        await this.updateAgentWeight("river", learningRate);
      }

      if (outcome.latencyMs > 4000 && plan.agents.includes("mirror") && plan.agents.includes("river")) {
        // Maybe we didn't need both — decrease weights slightly
        await this.updateAgentWeight("mirror", -learningRate * 0.5);
      }

      logger.info("Cortex learning updated", { 
        studentSatisfied: outcome.studentSatisfied,
        quality: outcome.responseQuality,
        latency: outcome.latencyMs
      });

    } catch (error: any) {
      logger.error("Cortex learning failed", { error: error.message });
    }
  }

  private async updateAgentWeight(agent: string, delta: number): Promise<void> {
    // In production: update learned weights in database
    // For now: log only
    logger.info("Cortex learning update", { agent, delta });
  }
}

export const cortex = new Cortex();
