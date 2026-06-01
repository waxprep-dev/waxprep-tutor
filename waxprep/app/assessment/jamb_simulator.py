import json
import random
from typing import Dict, Any, List, Optional
from datetime import datetime
from loguru import logger
from waxprep.app.database.client import get_db_client

INTRO_TEMPLATE = """Okay {name}, here we go — {count} questions across {subjects}.
Take your time on each one.
Question 1 of {count}:
Subject: {subject}
Topic: {topic}
{question}
A) {a}
B) {b}
C) {c}
D) {d}
Type A, B, C, or D."""

NEXT_TEMPLATE = """{feedback}
Question {current} of {total}:
Subject: {subject}
Topic: {topic}
{question}
A) {a}
B) {b}
C) {c}
D) {d}
Type A, B, C, or D."""

RESULT_TEMPLATE = """{name}, that's the end of the session.
Score: {correct}/{total} ({pct}%)
By subject:
{breakdown}
Topics that need more work: {weak}
Topics you handled well: {strong}
{message}
What do you want to work on?"""

class JAMBSimulator:
    def __init__(self):
        self.db = get_db_client()
        self._sessions: Dict[str, Dict] = {}

    async def start_simulation(
        self,
        student_id: str,
        subjects: List[str],
        questions_per_subject: int = 3,
        student_name: str = "there",
    ) -> str:
        try:
            all_questions = []
            question_map = {}

            knowledge = (
                self.db.table("knowledge_maps")
                .select("concept_id, mastery_score, subject")
                .eq("student_id", student_id)
                .lt("mastery_score", 60)
                .execute()
            )
            weak_concepts = {}
            for item in (knowledge.data or []):
                subj = item["subject"]
                if subj not in weak_concepts:
                    weak_concepts[subj] = []
                weak_concepts[subj].append(item["concept_id"].replace("_", " "))

            for subj in subjects:
                weak_for_subject = weak_concepts.get(subj, [])
                questions = []

                if weak_for_subject:
                    weak_r = (
                        self.db.table("jamb_questions")
                        .select("*")
                        .eq("subject", subj)
                        .in_("topic", weak_for_subject[:5])
                        .limit(questions_per_subject)
                        .execute()
                    )
                    questions = weak_r.data or []

                if len(questions) < questions_per_subject:
                    remaining = questions_per_subject - len(questions)
                    existing_ids = [q["id"] for q in questions]
                    fallback = (
                        self.db.table("jamb_questions")
                        .select("*")
                        .eq("subject", subj)
                        .order("year", desc=True)
                        .limit(remaining + 10)
                        .execute()
                    )
                    additional = [q for q in (fallback.data or []) if q["id"] not in existing_ids]
                    questions.extend(additional[:remaining])

                random.shuffle(questions)
                for q in questions[:questions_per_subject]:
                    all_questions.append(q["id"])
                    question_map[q["id"]] = q

            if not all_questions:
                return (
                    f"I don't have enough practice questions loaded yet for those subjects. "
                    f"Let's do a teaching session instead — what topic do you want to work on?"
                )

            sim = self.db.table("jamb_simulation_sessions").insert({
                "student_id": student_id,
                "subjects": json.dumps(subjects),
                "question_ids": json.dumps(all_questions),
                "total_questions": len(all_questions),
            }).execute()

            if not sim.data:
                return "Something went wrong setting up the session. Try again."

            session_id = sim.data[0]["id"]
            first_q = question_map[all_questions[0]]

            self._sessions[student_id] = {
                "session_id": session_id,
                "question_ids": all_questions,
                "question_map": question_map,
                "current_index": 0,
                "answers": {},
                "student_name": student_name,
                "subjects": subjects,
            }

            return INTRO_TEMPLATE.format(
                name=student_name,
                count=len(all_questions),
                subjects=", ".join([s.capitalize() for s in subjects]),
                subject=first_q["subject"].capitalize(),
                topic=first_q.get("topic", "General"),
                question=first_q["question_text"],
                a=first_q["option_a"],
                b=first_q["option_b"],
                c=first_q["option_c"],
                d=first_q["option_d"],
            )
        except Exception as e:
            logger.error(f"JAMB simulation start failed: {e}")
            return "I ran into a problem setting up the practice session. Try asking me to teach a specific topic instead."

    async def process_answer(self, student_id: str, answer: str) -> Optional[str]:
        session = self._sessions.get(student_id)
        if not session:
            return None

        answer = answer.strip().upper()
        if answer not in ["A", "B", "C", "D"]:
            return "Just type A, B, C, or D."

        idx = session["current_index"]
        q_id = session["question_ids"][idx]
        q = session["question_map"][q_id]

        is_correct = answer == q["correct_option"]
        session["answers"][q_id] = {
            "given": answer,
            "correct": q["correct_option"],
            "is_correct": is_correct,
            "topic": q.get("topic", ""),
            "subject": q.get("subject", ""),
        }

        try:
            self.db.table("jamb_question_attempts").insert({
                "student_id": student_id,
                "question_id": q_id,
                "simulation_id": session["session_id"],
                "student_answer": answer,
                "is_correct": is_correct,
            }).execute()
        except Exception:
            pass

        if is_correct:
            feedback = f"Correct — {answer} is right."
        else:
            correct_text = q[f"option_{q['correct_option'].lower()}"]
            feedback = (
                f"Not quite. The answer is {q['correct_option']}: {correct_text}.\n"
                f"{q.get('explanation', '')}"
            )

        session["current_index"] += 1
        self._sessions[student_id] = session

        if session["current_index"] >= len(session["question_ids"]):
            del self._sessions[student_id]
            return await self._generate_results(student_id, session, feedback)

        next_q = session["question_map"][session["question_ids"][session["current_index"]]]
        total = len(session["question_ids"])
        current_num = session["current_index"] + 1

        return NEXT_TEMPLATE.format(
            feedback=feedback,
            current=current_num,
            total=total,
            subject=next_q["subject"].capitalize(),
            topic=next_q.get("topic", "General"),
            question=next_q["question_text"],
            a=next_q["option_a"],
            b=next_q["option_b"],
            c=next_q["option_c"],
            d=next_q["option_d"],
        )

    async def _generate_results(self, student_id: str, session: Dict, final_feedback: str) -> str:
        answers = session["answers"]
        total = len(answers)
        correct = sum(1 for a in answers.values() if a["is_correct"])
        pct = round((correct / total) * 100) if total > 0 else 0

        subject_stats: Dict[str, Dict] = {}
        weak_topics = []
        strong_topics = []

        for a in answers.values():
            subj = a["subject"]
            if subj not in subject_stats:
                subject_stats[subj] = {"correct": 0, "total": 0}
            subject_stats[subj]["total"] += 1
            if a["is_correct"]:
                subject_stats[subj]["correct"] += 1
                if a["topic"] and a["topic"] not in strong_topics:
                    strong_topics.append(a["topic"])
            else:
                if a["topic"] and a["topic"] not in weak_topics:
                    weak_topics.append(a["topic"])

        breakdown_lines = []
        for subj, stats in subject_stats.items():
            sp = round((stats["correct"] / stats["total"]) * 100) if stats["total"] > 0 else 0
            breakdown_lines.append(f"  {subj.capitalize()}: {stats['correct']}/{stats['total']} ({sp}%)")

        if pct >= 80:
            message = "Strong session. The weak spots above are where the remaining marks are."
        elif pct >= 60:
            message = "Good foundation. Fix the topics listed above and your score jumps significantly."
        else:
            message = "These topics need serious work before exam day. We can tackle them one by one."

        try:
            self.db.table("jamb_simulation_sessions").update({
                "ended_at": datetime.utcnow().isoformat(),
                "score": pct,
                "correct_count": correct,
                "is_complete": True,
            }).eq("id", session["session_id"]).execute()
        except Exception:
            pass

        return final_feedback + "\n\n" + RESULT_TEMPLATE.format(
            name=session.get("student_name", ""),
            correct=correct,
            total=total,
            pct=pct,
            breakdown="\n".join(breakdown_lines),
            weak=", ".join(weak_topics[:5]) if weak_topics else "None — great work",
            strong=", ".join(strong_topics[:5]) if strong_topics else "Keep building",
            message=message,
        )

    def has_active_simulation(self, student_id: str) -> bool:
        return student_id in self._sessions

    def is_simulation_answer(self, message: str) -> bool:
        return message.strip().upper() in ["A", "B", "C", "D"]
