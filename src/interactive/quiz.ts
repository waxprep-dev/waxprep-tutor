import { sendListMessage } from "../whatsapp/interactive";
import { query, queryOne } from "../db/client";
import { logger } from "../utils/logger";
import * as concepts from "../memory/concepts";

export interface QuizOption {
  id: string;
  label: string;
}

export async function sendQuiz(
  toPhone: string,
  question: string,
  options: QuizOption[],
  correctIndex: number,
  conceptId: string,
  context?: string
): Promise<{ quiz_id: string; message_id: string }> {
  if (options.length < 2 || options.length > 10) {
    throw new Error(`Quiz must have 2-10 options, got ${options.length}`);
  }

  const quiz = await queryOne<{ quiz_id: string }>(
    `INSERT INTO quizzes (student_phone, concept_id, question, options, correct_index)
     VALUES ($1, $2, $3, $4, $5) RETURNING quiz_id`,
    [toPhone, conceptId, question, JSON.stringify(options), correctIndex]
  );

  const quizId = quiz!.quiz_id;

  const sectionTitle = "Choose your answer";
  const rows = options.map((opt, i) => ({
    id: `quiz:${quizId}:${i}`,
    title: `${String.fromCharCode(65 + i)}. ${opt.label.substring(0, 20)}`,
  }));

  const result = await sendListMessage(
    toPhone,
    context ? `${context}\n\n${question}` : question,
    "Tap your answer",
    [{ title: sectionTitle, rows }],
    { footer: "Pick the option you think is right" }
  );

  logger.info("Quiz sent", { phone: toPhone, quiz_id: quizId, options: options.length });
  return { quiz_id: quizId, message_id: result.message_id };
}

export async function gradeQuiz(
  quizId: string,
  selectedIndex: number
): Promise<{
  correct: boolean;
  correctIndex: number;
  question: string;
  selectedLabel: string;
  correctLabel: string;
  conceptId: string;
  studentPhone: string;
}> {
  const quiz = await queryOne<any>(
    `SELECT * FROM quizzes WHERE quiz_id = $1`,
    [quizId]
  );

  if (!quiz) throw new Error(`Quiz not found: ${quizId}`);

  const correct = selectedIndex === quiz.correct_index;
  const options = typeof quiz.options === "string" ? JSON.parse(quiz.options) : quiz.options;

  await query(
    `UPDATE quizzes
     SET selected_index = $1, is_correct = $2, answered_at = NOW()
     WHERE quiz_id = $3`,
    [selectedIndex, correct, quizId]
  );

  const delta = correct ? 0.12 : -0.08;
  const concept = await concepts.getConcept(quiz.concept_id);
  if (concept) {
    const newScore = Math.max(0, Math.min(1, concept.mastery_score + delta));
    await concepts.updateMastery(
      quiz.concept_id,
      newScore,
      `Quiz ${correct ? "correct" : "incorrect"} on question: ${quiz.question.substring(0, 100)}`
    );
  }

  logger.info("Quiz graded", {
    quiz_id: quizId,
    correct,
    selected: selectedIndex,
    correct_answer: quiz.correct_index,
  });

  return {
    correct,
    correctIndex: quiz.correct_index,
    question: quiz.question,
    selectedLabel: options[selectedIndex]?.label || "(unknown)",
    correctLabel: options[quiz.correct_index]?.label || "(unknown)",
    conceptId: quiz.concept_id,
    studentPhone: quiz.student_phone,
  };
}

export function buildQuizFeedbackContext(result: Awaited<ReturnType<typeof gradeQuiz>>): string {
  if (result.correct) {
    return `[QUIZ RESULT] Student answered CORRECTLY on the quiz about: "${result.question.substring(0, 80)}". Selected: "${result.selectedLabel}". Acknowledge specifically what they got right and either continue or move to next concept. Don't be generic — say WHY this answer is right.`;
  } else {
    return `[QUIZ RESULT] Student answered INCORRECTLY. They selected "${result.selectedLabel}" but the correct answer is "${result.correctLabel}". On question: "${result.question.substring(0, 80)}". Don't just say "wrong" — explain why their choice was wrong AND why the correct answer is right. Use a different teaching angle than before.`;
  }
}
