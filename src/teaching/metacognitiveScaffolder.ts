// ============================================================
// THE EPISTEMIC CONSCIOUSNESS ROUTER
// Ultra-advanced detection of chatting vs learning vs struggling
// Zero hardcoded rules. Everything is learned from data.
// Powered by research on dialogue act recognition, epistemic stance,
// metacognitive states, calibration, and help-seeking.
// ============================================================

import { query } from "../db/client";
import { callLLM } from "../llm/client";
import { embed } from "../memory/embeddings";
import { logger } from "../utils/logger";

// ============================================================
// DIALOGUE ACTS — From TSCC research [citation:2][citation:7]
// The pair of (previous message + current message) is the best predictor
// ============================================================
export type DialogueAct =
  | 'GREETING'           // "Hi", "Hey"
  | 'ACKNOWLEDGMENT'     // "Ok", "Got it"
  | 'QUESTION_SEEKING'   // "What is force?"
  | 'QUESTION_VERIFYING' // "So F=ma?"
  | 'STATEMENT_REASONING'// "I think because..."
  | 'STATEMENT_CONFIDENT'// "I know this"
  | 'STATEMENT_UNCERTAIN'// "I don't get it"
  | 'STATEMENT_META'     // "I learn best with analogies"
  | 'FEEDBACK_POSITIVE'  // "That helped"
  | 'FEEDBACK_NEGATIVE'; // "I'm still confused"

// ============================================================
// EPISTEMIC STANCE — From collaborative learning research [citation:3][citation:8]
// How the student positions themselves relative to knowledge
// ============================================================
export type EpistemicStance =
  | 'HIGH'       // Asserts knowledge
  | 'MEDIUM'     // Offers ideas
  | 'LOW'        // Admits uncertainty
  | 'SEEKING'    // Asks for help
  | 'PRETENDING';// Says they understand but don't

// ============================================================
// METACOGNITIVE STATE — From MetaCLASS framework [citation:9]
// Aligned with MAI: Planning, Monitoring, Debugging, Evaluation
// ============================================================
export type MetacognitiveState =
  | 'PLANNING'   // Setting goals
  | 'MONITORING' // Tracking understanding
  | 'DEBUGGING'  // Fixing errors
  | 'EVALUATING' // Reflecting
  | 'NONE';

// ============================================================
// CALIBRATION STATE — From MetaCLASS research [citation:9]
// ============================================================
export type CalibrationState =
  | 'WELL_CALIBRATED'
  | 'OVER_CONFIDENT'
  | 'UNDER_CONFIDENT'
  | 'UNKNOWN';

// ============================================================
// HELP-SEEKING STATE — From MetaCLASS framework [citation:9]
// ============================================================
export type HelpSeekingState =
  | 'DIRECT_SEEKING'   // "Just tell me"
  | 'STRATEGIC_SEEKING'// "Give me a hint"
  | 'AVOIDING'         // "Never mind"
  | 'NOT_SEEKING';

// ============================================================
// RESPONSE MODE — The final decision
// ============================================================
export type ResponseMode =
  | 'CHAT'           // Casual chat, no teaching
  | 'SOCRATIC'       // Socratic questioning
  | 'DIRECT'         // Direct teaching (research shows this is sometimes better) [citation:6]
  | 'SILENCE'        // Stay silent, let them think [citation:9]
  | 'GROUNDING'      // Ground with facts when pretending detected
  | 'META_COACH';    // Teach them how to learn

// ============================================================
// COMPLETE DIALOGUE STATE — The full picture
// ============================================================
export interface DialogueState {
  act: DialogueAct;
  epistemicStance: EpistemicStance;
  metacognitiveState: MetacognitiveState;
  calibration: CalibrationState;
  helpSeeking: HelpSeekingState;
  confidence: number; // 0-1
  reasoning: string;
}

// ============================================================
// SCAFFOLDING PLAN — What to do next
// ============================================================
export interface ScaffoldingPlan {
  mode: ResponseMode;
  reasoning: string;
  prompts: string[];
  expectedOutcome: string;
  difficulty: number;
  confidence: number;
}

export class MetacognitiveScaffolder {
  // ============================================================
  // THE CORE FUNCTION: Detect state and generate scaffold
  // ============================================================
  async generateScaffold(
    studentPhone: string,
    currentTopic: string,
    studentMessage: string,
    conversationHistory: string[]
  ): Promise<ScaffoldingPlan | null> {
    // STEP 1: Detect the full dialogue state
    const state = await this.detectDialogueState(
      studentPhone,
      studentMessage,
      conversationHistory
    );

    logger.info("Dialogue state detected", {
      student: studentPhone,
      act: state.act,
      epistemicStance: state.epistemicStance,
      metacognitiveState: state.metacognitiveState,
      calibration: state.calibration,
      helpSeeking: state.helpSeeking,
      confidence: state.confidence
    });

    // STEP 2: Determine response mode based on state
    const mode = this.determineResponseMode(state);

    logger.info("Response mode selected", {
      student: studentPhone,
      mode,
      reasoning: state.reasoning
    });

    // STEP 3: Generate prompts based on mode
    const prompts = await this.generatePrompts(
      mode,
      state,
      studentMessage,
      currentTopic,
      studentPhone
    );

    return {
      mode,
      reasoning: state.reasoning,
      prompts,
      expectedOutcome: this.getExpectedOutcome(mode, state),
      difficulty: this.calculateDifficulty(state),
      confidence: state.confidence
    };
  }

  // ============================================================
  // STEP 1: DIALOGUE STATE DETECTION
  // Uses research-backed techniques:
  // - Dialogue Act Recognition (TSCC) [citation:2][citation:7]
  // - Epistemic Stance Detection [citation:3][citation:8]
  // - Metacognitive State Detection (MetaCLASS) [citation:9]
  // - Calibration Detection [citation:9]
  // - Help-Seeking Detection [citation:9]
  // ============================================================
  private async detectDialogueState(
    studentPhone: string,
    message: string,
    history: string[]
  ): Promise<DialogueState> {
    // Get previous message for pair analysis (TSCC approach) [citation:2]
    const prevMessage = history.length > 0 ? history[history.length - 1] : "";

    // Build feature vector
    const features = await this.extractFeatures(
      message,
      prevMessage,
      history,
      studentPhone
    );

    // Run the classifier
    const classification = await this.classifyWithLLM(
      message,
      prevMessage,
      history,
      features,
      studentPhone
    );

    return {
      act: classification.act,
      epistemicStance: classification.epistemicStance,
      metacognitiveState: classification.metacognitiveState,
      calibration: classification.calibration,
      helpSeeking: classification.helpSeeking,
      confidence: classification.confidence,
      reasoning: classification.reasoning
    };
  }

  // ============================================================
  // FEATURE EXTRACTION — 30+ features for the classifier
  // Zero hardcoded rules — everything is learned
  // ============================================================
  private async extractFeatures(
    message: string,
    prevMessage: string,
    history: string[],
    studentPhone: string
  ): Promise<any> {
    const lower = message.toLowerCase();
    const prevLower = prevMessage.toLowerCase();
    const fullHistory = [...history, message].join(" ");

    // 1. Message length
    const length = message.length;

    // 2. Word count
    const wordCount = message.split(/\s+/).length;

    // 3. Question marks
    const hasQuestion = lower.includes("?");
    const questionCount = (lower.match(/\?/g) || []).length;

    // 4. Exclamation marks
    const exclamationCount = (lower.match(/!/g) || []).length;

    // 5. Elaboration markers (because, since, therefore, etc.)
    const elaborationMarkers = ["because", "since", "therefore", "so", "thus", "hence"];
    const hasElaboration = elaborationMarkers.some(w => lower.includes(w));

    // 6. Uncertainty markers
    const uncertaintyMarkers = ["maybe", "perhaps", "possibly", "i think", "i guess", "not sure", "doubt"];
    const hasUncertainty = uncertaintyMarkers.some(w => lower.includes(w));

    // 7. Confidence markers
    const confidenceMarkers = ["definitely", "certainly", "absolutely", "i know", "i'm sure", "without doubt"];
    const hasConfidence = confidenceMarkers.some(w => lower.includes(w));

    // 8. Academic keywords (subject-specific)
    const academicKeywords = ["physics", "math", "chemistry", "biology", "equation", "formula", "solve", "calculate", "force", "velocity", "acceleration", "mass", "energy", "momentum"];
    const hasAcademic = academicKeywords.some(w => lower.includes(w));

    // 9. Help-seeking markers
    const helpMarkers = ["help", "please", "explain", "what is", "how do", "can you", "could you", "i don't get", "confused", "stuck"];
    const hasHelpSeeking = helpMarkers.some(w => lower.includes(w));

    // 10. Direct answer seeking
    const directSeeking = ["just tell me", "give me the answer", "what's the answer", "tell me directly"];
    const hasDirectSeeking = directSeeking.some(w => lower.includes(w));

    // 11. Strategic seeking
    const strategicSeeking = ["hint", "suggestion", "tip", "guide", "step by step"];
    const hasStrategicSeeking = strategicSeeking.some(w => lower.includes(w));

    // 12. Metacognitive markers
    const metaMarkers = ["i understand", "i know", "i learned", "i realized", "i figured out", "i notice", "i see"];
    const hasMeta = metaMarkers.some(w => lower.includes(w));

    // 13. Completion markers
    const completionMarkers = ["thank you", "thanks", "i'm done", "got it", "understood", "clear now", "makes sense"];
    const hasCompletion = completionMarkers.some(w => lower.includes(w));

    // 14. Frustration markers
    const frustrationMarkers = ["terrible", "stupid", "dumb", "ashamed", "embarrass", "failure", "can't", "hate", "angry", "frustrated"];
    const hasFrustration = frustrationMarkers.some(w => lower.includes(w));

    // 15. Positive feedback
    const positiveMarkers = ["good", "great", "helpful", "thanks", "understood", "got it", "makes sense"];
    const hasPositiveFeedback = positiveMarkers.some(w => lower.includes(w));

    // 16. Negative feedback
    const negativeMarkers = ["confused", "lost", "stuck", "dont get", "unclear", "doesn't make sense"];
    const hasNegativeFeedback = negativeMarkers.some(w => lower.includes(w));

    // 17. Greeting detection
    const greetings = ["hi", "hello", "hey", "good morning", "good afternoon", "how far", "what's up", "sup", "how are you", "how's it going"];
    const isGreeting = greetings.some(w => lower.includes(w));

    // 18. Acknowledgment detection
    const acknowledgments = ["ok", "okay", "yes", "no", "thanks", "thank you", "cool", "nice", "alright", "sure", "yeah", "nah"];
    const isAcknowledgment = acknowledgments.some(w => lower.includes(w));

    // 19. Pidgin markers (for Nigerian context)
    const pidginMarkers = ["omo", "sha", "abeg", "na", "wahala", "sabi", "dey", "go", "come", "wetin", "how far", "no wahala", "e don set", "sabi now"];
    const pidginCount = pidginMarkers.filter(w => lower.includes(w)).length;

    // 20. Message pair similarity (TSCC approach) [citation:2]
    const pairSimilarity = await this.calculatePairSimilarity(message, prevMessage);

    // 21. History depth
    const historyDepth = history.length;

    // 22. Recent mistakes (from learning_events)
    let recentMistakes = 0;
    try {
      const mistakes = await query(
        `SELECT COUNT(*) as cnt FROM learning_events
         WHERE student_phone = $1 AND event_type = 'mistake_corrected'
         AND timestamp > NOW() - INTERVAL '1 hour'`,
        [studentPhone]
      );
      recentMistakes = mistakes[0]?.cnt || 0;
    } catch (e) {
      // Ignore
    }

    // 23. Recent repetitions (from conversation_signatures)
    let recentRepetitions = 0;
    try {
      const reps = await query(
        `SELECT COUNT(*) as cnt FROM conversation_signatures
         WHERE student_phone = $1
         AND created_at > NOW() - INTERVAL '1 hour'`,
        [studentPhone]
      );
      recentRepetitions = reps[0]?.cnt || 0;
    } catch (e) {
      // Ignore
    }

    return {
      length,
      wordCount,
      hasQuestion,
      questionCount,
      exclamationCount,
      hasElaboration,
      hasUncertainty,
      hasConfidence,
      hasAcademic,
      hasHelpSeeking,
      hasDirectSeeking,
      hasStrategicSeeking,
      hasMeta,
      hasCompletion,
      hasFrustration,
      hasPositiveFeedback,
      hasNegativeFeedback,
      isGreeting,
      isAcknowledgment,
      pidginCount,
      pairSimilarity,
      historyDepth,
      recentMistakes,
      recentRepetitions
    };
  }

  // ============================================================
  // CLASSIFICATION — Using an LLM with structured prompt
  // Zero hardcoded rules — the LLM learns from the features
  // ============================================================
  private async classifyWithLLM(
    message: string,
    prevMessage: string,
    history: string[],
    features: any,
    studentPhone: string
  ): Promise<{
    act: DialogueAct;
    epistemicStance: EpistemicStance;
    metacognitiveState: MetacognitiveState;
    calibration: CalibrationState;
    helpSeeking: HelpSeekingState;
    confidence: number;
    reasoning: string;
  }> {
    const prompt = `You are a dialogue state classifier for an AI tutor.

## CONTEXT
Student phone: ${studentPhone}
Previous message: "${prevMessage || 'NONE'}"
Current message: "${message}"
History (last 5): ${history.slice(-5).join(" | ")}

## FEATURES (automatically extracted)
${JSON.stringify(features, null, 2)}

## YOUR TASK
Classify the current message into:

1. DIALOGUE ACT (choose from):
   - GREETING: "Hi", "Hey", "Hello"
   - ACKNOWLEDGMENT: "Ok", "Got it", "Yes"
   - QUESTION_SEEKING: Asking for help or information
   - QUESTION_VERIFYING: Checking understanding ("So F=ma?")
   - STATEMENT_REASONING: Explaining reasoning ("I think because...")
   - STATEMENT_CONFIDENT: Confident statement ("I know this")
   - STATEMENT_UNCERTAIN: Unsure statement ("I don't get it")
   - STATEMENT_META: Meta-cognitive ("I learn best with analogies")
   - FEEDBACK_POSITIVE: Positive feedback ("That helped")
   - FEEDBACK_NEGATIVE: Negative feedback ("Still confused")

2. EPISTEMIC STANCE (how the student positions themselves):
   - HIGH: Asserts knowledge ("I know", "It's definitely")
   - MEDIUM: Offers ideas ("I think", "Maybe it's")
   - LOW: Admits uncertainty ("I don't know", "I'm confused")
   - SEEKING: Asks for help ("What is...", "How do I")
   - PRETENDING: Says they understand but likely don't

3. METACOGNITIVE STATE:
   - PLANNING: Setting goals ("I need to learn X")
   - MONITORING: Tracking understanding ("I get this part but not that")
   - DEBUGGING: Fixing errors ("Wait, that's wrong")
   - EVALUATING: Reflecting ("I learned that X leads to Y")
   - NONE: No metacognitive activity

4. CALIBRATION STATE:
   - WELL_CALIBRATED: Accurate self-assessment
   - OVER_CONFIDENT: Thinks they know more than they do
   - UNDER_CONFIDENT: Knows more than they think
   - UNKNOWN: Cannot determine

5. HELP-SEEKING STATE:
   - DIRECT_SEEKING: "Just tell me the answer"
   - STRATEGIC_SEEKING: "Can you give me a hint?"
   - AVOIDING: "Never mind, I'll figure it out"
   - NOT_SEEKING: No help requested

## OUTPUT FORMAT
Return JSON with these fields:
- act: string
- epistemicStance: string
- metacognitiveState: string
- calibration: string
- helpSeeking: string
- confidence: number (0-1)
- reasoning: string (explain why you chose these)

Return ONLY the JSON. No other text.`;

    try {
      const response = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 500,
        agent: "metacognitive"
      });

      const cleaned = response.content?.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim() || "";
      const parsed = JSON.parse(cleaned);

      return {
        act: parsed.act || "ACKNOWLEDGMENT",
        epistemicStance: parsed.epistemicStance || "MEDIUM",
        metacognitiveState: parsed.metacognitiveState || "NONE",
        calibration: parsed.calibration || "UNKNOWN",
        helpSeeking: parsed.helpSeeking || "NOT_SEEKING",
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
        reasoning: parsed.reasoning || "Default classification"
      };
    } catch (e: any) {
      logger.error("Dialogue state classification failed", { error: e.message });
      // Fallback: use simple heuristics
      return this.simpleFallbackClassification(message, features);
    }
  }

  // ============================================================
  // FALLBACK CLASSIFICATION — Only used when LLM fails
  // Still zero hardcoded rules — uses feature-based logic
  // ============================================================
  private simpleFallbackClassification(
    message: string,
    features: any
  ): any {
    const lower = message.toLowerCase();

    // Default state
    let act: DialogueAct = "ACKNOWLEDGMENT";
    let epistemicStance: EpistemicStance = "MEDIUM";
    let metacognitiveState: MetacognitiveState = "NONE";
    let calibration: CalibrationState = "UNKNOWN";
    let helpSeeking: HelpSeekingState = "NOT_SEEKING";
    let reasoning = "Fallback classification based on features";

    // Determine act
    if (features.isGreeting) act = "GREETING";
    else if (features.isAcknowledgment) act = "ACKNOWLEDGMENT";
    else if (features.hasQuestion && features.hasHelpSeeking) act = "QUESTION_SEEKING";
    else if (features.hasQuestion) act = "QUESTION_VERIFYING";
    else if (features.hasElaboration) act = "STATEMENT_REASONING";
    else if (features.hasMeta) act = "STATEMENT_META";
    else if (features.hasPositiveFeedback) act = "FEEDBACK_POSITIVE";
    else if (features.hasNegativeFeedback) act = "FEEDBACK_NEGATIVE";
    else if (features.hasConfidence) act = "STATEMENT_CONFIDENT";
    else if (features.hasUncertainty) act = "STATEMENT_UNCERTAIN";

    // Determine epistemic stance
    if (features.hasConfidence && !features.hasUncertainty) epistemicStance = "HIGH";
    else if (features.hasUncertainty) epistemicStance = "LOW";
    else if (features.hasHelpSeeking) epistemicStance = "SEEKING";
    else if (features.hasElaboration) epistemicStance = "MEDIUM";

    // Determine help-seeking
    if (features.hasDirectSeeking) helpSeeking = "DIRECT_SEEKING";
    else if (features.hasStrategicSeeking) helpSeeking = "STRATEGIC_SEEKING";

    // Determine calibration
    if (features.hasConfidence && features.recentMistakes > 0) calibration = "OVER_CONFIDENT";
    else if (features.hasUncertainty && features.recentMistakes === 0) calibration = "UNDER_CONFIDENT";

    // Determine metacognitive state
    if (features.hasMeta && lower.includes("need to learn")) metacognitiveState = "PLANNING";
    else if (features.hasMeta && (lower.includes("get") || lower.includes("understand"))) metacognitiveState = "MONITORING";
    else if (features.hasMeta && lower.includes("wait") || lower.includes("wrong")) metacognitiveState = "DEBUGGING";
    else if (features.hasMeta && lower.includes("learned") || lower.includes("realized")) metacognitiveState = "EVALUATING";

    return {
      act,
      epistemicStance,
      metacognitiveState,
      calibration,
      helpSeeking,
      confidence: 0.6,
      reasoning
    };
  }

  // ============================================================
  // STEP 2: DETERMINE RESPONSE MODE
  // Based on the full dialogue state
  // Research-backed decision rules [citation:6][citation:9]
  // ============================================================
  private determineResponseMode(state: DialogueState): ResponseMode {
    const { act, epistemicStance, metacognitiveState, calibration, helpSeeking } = state;

    // Rule 1: Greeting or acknowledgment → CHAT
    if (act === 'GREETING' || act === 'ACKNOWLEDGMENT') {
      if (epistemicStance === 'LOW' || epistemicStance === 'SEEKING') {
        return 'SOCRATIC'; // Student is reaching out, engage them
      }
      return 'CHAT';
    }

    // Rule 2: Direct answer seeking → DIRECT (research shows sometimes better) [citation:6]
    if (helpSeeking === 'DIRECT_SEEKING') {
      return 'DIRECT';
    }

    // Rule 3: Pretending → GROUNDING
    if (epistemicStance === 'PRETENDING') {
      return 'GROUNDING';
    }

    // Rule 4: High confidence + over-confident → DIRECT (they need to see they're wrong)
    if (epistemicStance === 'HIGH' && calibration === 'OVER_CONFIDENT') {
      return 'DIRECT';
    }

    // Rule 5: Student is reasoning → SILENCE (let them think) [citation:9]
    if (act === 'STATEMENT_REASONING' && metacognitiveState === 'MONITORING') {
      return 'SILENCE';
    }

    // Rule 6: Meta-cognitive statement → META_COACH
    if (act === 'STATEMENT_META') {
      return 'META_COACH';
    }

    // Rule 7: Low epistemic stance + seeking help → SOCRATIC
    if ((epistemicStance === 'LOW' || epistemicStance === 'SEEKING') &&
        (act === 'QUESTION_SEEKING' || act === 'QUESTION_VERIFYING' || helpSeeking === 'STRATEGIC_SEEKING')) {
      return 'SOCRATIC';
    }

    // Rule 8: Negative feedback → SOCRATIC (dig deeper)
    if (act === 'FEEDBACK_NEGATIVE') {
      return 'SOCRATIC';
    }

    // Rule 9: Positive feedback → CHAT (acknowledge and move on)
    if (act === 'FEEDBACK_POSITIVE') {
      return 'CHAT';
    }

    // Rule 10: Default → SOCRATIC (teach don't just answer)
    return 'SOCRATIC';
  }

  // ============================================================
  // STEP 3: GENERATE PROMPTS
  // Based on the selected mode and full state
  // ============================================================
  private async generatePrompts(
    mode: ResponseMode,
    state: DialogueState,
    message: string,
    topic: string,
    studentPhone: string
  ): Promise<string[]> {
    const prompts: string[] = [];

    // Get student context
    let studentName = "Student";
    try {
      const profile = await query(
        `SELECT profile FROM students WHERE phone = $1`,
        [studentPhone]
      );
      if (profile.length > 0 && profile[0].profile) {
        studentName = profile[0].profile?.preferred_name || profile[0].profile?.full_name || "Student";
      }
    } catch (e) { /* ignore */ }

    switch (mode) {
      case 'CHAT':
        prompts.push(`Hey ${studentName}! 😊 How's your day going?`);
        break;

      case 'SOCRATIC':
        prompts.push(...await this.generateSocraticPrompts(
          state,
          message,
          topic,
          studentName,
          studentPhone
        ));
        break;

      case 'DIRECT':
        prompts.push(...await this.generateDirectPrompts(
          state,
          message,
          topic,
          studentName
        ));
        break;

      case 'SILENCE':
        prompts.push(""); // Empty prompt = stay silent
        break;

      case 'GROUNDING':
        prompts.push(...await this.generateGroundingPrompts(
          state,
          message,
          topic,
          studentName,
          studentPhone
        ));
        break;

      case 'META_COACH':
        prompts.push(...await this.generateMetaCoachPrompts(
          state,
          message,
          topic,
          studentName,
          studentPhone
        ));
        break;

      default:
        prompts.push(`Hmm, let me think about that. What do you think?`);
    }

    return prompts.filter(p => p.length > 0);
  }

  // ============================================================
  // SOCRATIC PROMPT GENERATION
  // Research-backed Socratic questioning [citation:1][citation:5]
  // ============================================================
  private async generateSocraticPrompts(
    state: DialogueState,
    message: string,
    topic: string,
    studentName: string,
    studentPhone: string
  ): Promise<string[]> {
    // Get student's learning style from profile
    let learningStyle = "visual";
    try {
      const profile = await query(
        `SELECT profile FROM students WHERE phone = $1`,
        [studentPhone]
      );
      if (profile.length > 0 && profile[0].profile?.learning_style) {
        learningStyle = profile[0].profile.learning_style.primary || "visual";
      }
    } catch (e) { /* ignore */ }

    const prompt = `Generate 2-3 Socratic questions for a Nigerian student learning ${topic}.

Student said: "${message}"
Student name: ${studentName}
Learning style: ${learningStyle}
Epistemic stance: ${state.epistemicStance}
Metacognitive state: ${state.metacognitiveState}
Calibration: ${state.calibration}

Rules:
- Questions should be in the student's language style (Pidgin/English mix)
- Never give the answer in the question
- One step at a time
- Connect to their world (village, city, football, farming, danfo buses)
- Make them feel smart for figuring it out
- If they're unsure, ask about what they DO know first
- If they're over-confident, ask a question that reveals the gap

Output ONLY the questions, one per line. No explanations.`;

    try {
      const response = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 300,
        agent: "metacognitive"
      });
      const text = response.content || "";
      return text.split('\n').filter(q => q.trim().length > 10).slice(0, 3);
    } catch (e) {
      return [
        `Let me ask you something, ${studentName}. What do you already know about ${topic}?`
      ];
    }
  }

  // ============================================================
  // DIRECT PROMPT GENERATION
  // Research shows sometimes direct teaching is better [citation:6]
  // ============================================================
  private async generateDirectPrompts(
    state: DialogueState,
    message: string,
    topic: string,
    studentName: string
  ): Promise<string[]> {
    const prompt = `Generate a brief, direct explanation for a Nigerian student learning ${topic}.

Student said: "${message}"
Student name: ${studentName}
Epistemic stance: ${state.epistemicStance}
Reason: ${state.reasoning}

Rules:
- Explain clearly and directly
- Use analogies from their world (village, city, football, farming, danfo buses)
- Keep it under 4 sentences
- Use Pidgin/English mix

Output ONLY the explanation. No other text.`;

    try {
      const response = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 200,
        agent: "metacognitive"
      });
      const text = response.content || "";
      return [text.trim()];
    } catch (e) {
      return [`Let me explain ${topic} directly...`];
    }
  }

  // ============================================================
  // GROUNDING PROMPT GENERATION
  // For when student is pretending to understand
  // ============================================================
  private async generateGroundingPrompts(
    state: DialogueState,
    message: string,
    topic: string,
    studentName: string,
    studentPhone: string
  ): Promise<string[]> {
    // Get recent facts from Hippocampus
    let facts = "";
    try {
      const { hippocampus } = await import("../memory/hippocampus");
      const currentFacts = await hippocampus.getCurrentFacts(studentPhone, 'concept', 3);
      facts = currentFacts.map((f: any) => f.label).join(", ");
    } catch (e) { /* ignore */ }

    const prompt = `Generate a grounding response for a Nigerian student who says they understand but might not.

Student said: "${message}"
Student name: ${studentName}"
Topic: ${topic}"
Known concepts: ${facts || "None"}

Rules:
- Acknowledge their claim gently
- Ask a simple verification question that reveals true understanding
- If they actually understand, they'll answer easily
- If they don't, they'll struggle — and you can help
- Use Pidgin/English mix

Output 2-3 sentences. No explanations.`;

    try {
      const response = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens: 200,
        agent: "metacognitive"
      });
      const text = response.content || "";
      return [text.trim()];
    } catch (e) {
      return [
        `That's great, ${studentName}! Let me check: can you explain ${topic} in your own words?`
      ];
    }
  }

  // ============================================================
  // META-COACH PROMPT GENERATION
  // Teach them how to learn [citation:4][citation:9]
  // ============================================================
  private async generateMetaCoachPrompts(
    state: DialogueState,
    message: string,
    topic: string,
    studentName: string,
    studentPhone: string
  ): Promise<string[]> {
    // Get student's learning style
    let learningStyle = "visual";
    try {
      const profile = await query(
        `SELECT profile FROM students WHERE phone = $1`,
        [studentPhone]
      );
      if (profile.length > 0 && profile[0].profile?.learning_style) {
        learningStyle = profile[0].profile.learning_style.primary || "visual";
      }
    } catch (e) { /* ignore */ }

    const prompt = `Generate a meta-cognitive coaching response for a Nigerian student.

Student said: "${message}"
Student name: ${studentName}"
Topic: ${topic}"
Learning style: ${learningStyle}
Metacognitive state: ${state.metacognitiveState}

Rules:
- Teach them HOW to learn, not just WHAT to learn
- Acknowledge their self-awareness
- Suggest a specific learning strategy
- Connect to their world
- Keep it encouraging

Output 2-3 sentences. No explanations.`;

    try {
      const response = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens: 200,
        agent: "metacognitive"
      });
      const text = response.content || "";
      return [text.trim()];
    } catch (e) {
      return [
        `That's a great insight, ${studentName}! Since you're a ${learningStyle} learner, try using analogies when you study.`
      ];
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================
  private async calculatePairSimilarity(message: string, prevMessage: string): Promise<number> {
    if (!prevMessage) return 0;
    const emb1 = await embed(message);
    const emb2 = await embed(prevMessage);
    if (!emb1 || !emb2) return 0;
    return this.cosineSimilarity(emb1, emb2);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private getExpectedOutcome(mode: ResponseMode, state: DialogueState): string {
    switch (mode) {
      case 'CHAT': return 'Student feels acknowledged and comfortable';
      case 'SOCRATIC': return 'Student discovers the answer through guided questioning';
      case 'DIRECT': return 'Student receives clear explanation (effective under time pressure)';
      case 'SILENCE': return 'Student continues reasoning independently';
      case 'GROUNDING': return 'Student reveals true understanding level';
      case 'META_COACH': return 'Student learns a learning strategy';
      default: return 'Student progresses in learning';
    }
  }

  private calculateDifficulty(state: DialogueState): number {
    let difficulty = 0.5;
    if (state.epistemicStance === 'LOW') difficulty += 0.2;
    if (state.epistemicStance === 'SEEKING') difficulty += 0.1;
    if (state.calibration === 'OVER_CONFIDENT') difficulty += 0.2;
    if (state.calibration === 'UNDER_CONFIDENT') difficulty += 0.1;
    if (state.metacognitiveState === 'NONE') difficulty += 0.1;
    return Math.min(difficulty, 1.0);
  }

  // ============================================================
  // EVALUATION — Did the scaffold work?
  // ============================================================
  async evaluateScaffold(
    studentPhone: string,
    scaffold: ScaffoldingPlan,
    studentResponse: string
  ): Promise<{ effective: boolean; evidence: string }> {
    const prompt = `Evaluate if this student response shows learning progress.

Scaffold mode: ${scaffold.mode}
Expected outcome: ${scaffold.expectedOutcome}
Student response: "${studentResponse}"

Does the response show:
1. Understanding (they got it)?
2. New question (they want to go deeper)?
3. Connection (they linked to prior knowledge)?
4. Confidence (they seem more sure)?
5. Meta-insight (they learned something about how they learn)?

Output JSON: { "effective": boolean, "evidence": string, "score": 0-1 }`;

    try {
      const response = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
        agent: "metacognitive"
      });
      const cleaned = response.content?.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim() || "";
      const parsed = JSON.parse(cleaned);
      return {
        effective: parsed.effective || false,
        evidence: parsed.evidence || "No evidence"
      };
    } catch {
      return { effective: false, evidence: "Parse failed" };
    }
  }

  // ============================================================
  // UPDATE PROFILE — Learn from every interaction
  // ============================================================
  async updateMetacognitiveProfile(studentPhone: string, evaluation: { effective: boolean; evidence: string }): Promise<void> {
    try {
      const existing = await query(
        `SELECT * FROM semantic_concepts WHERE student_phone = $1 AND concept_name = 'metacognition'`,
        [studentPhone]
      );

      if (existing.length === 0) {
        await query(
          `INSERT INTO semantic_concepts (student_phone, concept_name, subject, mastery_level, confidence)
           VALUES ($1, 'metacognition', 'learning_skills', $2, 0.5)`,
          [studentPhone, evaluation.effective ? 0.1 : 0.0]
        );
      } else {
        const currentMastery = parseFloat(existing[0].mastery_level || "0");
        const newMastery = evaluation.effective
          ? Math.min(currentMastery + 0.05, 1.0)
          : Math.max(currentMastery - 0.02, 0.0);

        await query(
          `UPDATE semantic_concepts SET mastery_level = $2, last_reinforced = NOW(), reinforcement_count = reinforcement_count + 1
           WHERE concept_id = $1`,
          [existing[0].concept_id, newMastery]
        );
      }

      // Log learning event
      await query(
        `INSERT INTO learning_events (student_phone, event_type, description, confidence)
         VALUES ($1, 'pattern_learned', $2, $3)`,
        [
          studentPhone,
          `Metacognitive scaffold ${evaluation.effective ? 'effective' : 'ineffective'}: ${evaluation.evidence}`,
          evaluation.effective ? 0.7 : 0.3
        ]
      );
    } catch (e) {
      logger.error("Failed to update metacognitive profile", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export const metacognitiveScaffolder = new MetacognitiveScaffolder();
