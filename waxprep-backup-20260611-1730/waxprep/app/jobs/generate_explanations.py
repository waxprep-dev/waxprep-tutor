from datetime import datetime, timezone
from loguru import logger
from waxprep.app.database.client import get_db
from waxprep.app.brain.engine import brain

async def run_generate_explanations(batch_size: int = 10):
    """
    Batch job: Pre-generate wrong-answer explanations for MCQ questions.
    Run this once to populate jamb_questions.wrong_answer_explanations.
    """
    try:
        db = get_db()
        
        # Find questions that don't have explanations yet
        questions = (
            db.table("jamb_questions")
            .select("id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, subject, topic")
            .is_("wrong_answer_explanations", "null")
            .limit(batch_size)
            .execute()
        )
        
        if not questions.data:
            logger.info("No questions need explanations. All caught up!")
            return
        
        generated = 0
        for q in questions.data:
            try:
                q_id = q["id"]
                correct = q["correct_option"]
                options = {
                    "A": q.get("option_a", ""),
                    "B": q.get("option_b", ""),
                    "C": q.get("option_c", ""),
                    "D": q.get("option_d", ""),
                }
                
                # Build prompt for Gemini to generate explanations
                prompt = (
                    f"For this WAEC/JAMB question, explain why EACH WRONG ANSWER is incorrect. "
                    f"Be specific about the misconception each wrong answer reveals. "
                    f"Question: {q['question_text']}\n"
                    f"Correct answer: {correct}) {options.get(correct, '')}\n"
                    f"Wrong answers:\n"
                )
                
                wrong_options = {}
                for opt, text in options.items():
                    if opt != correct and text:
                        prompt += f"{opt}) {text}\n"
                        wrong_options[opt] = text
                
                prompt += (
                    "\nReturn JSON format:\n"
                    "{\n"
                    '  "A": {"why_wrong": "...", "misconception": "...", "common_in_nigeria": true/false},\n'
                    '  "B": {"why_wrong": "...", "misconception": "...", "common_in_nigeria": true/false}\n'
                    "}\n"
                    "Only include wrong answers. Be concise but educational."
                )
                
                result = await brain._call_model(prompt)
                if not result:
                    continue
                
                # Parse JSON from response
                import json
                # Extract JSON block from response
                json_start = result.find("{")
                json_end = result.rfind("}")
                if json_start == -1 or json_end == -1:
                    continue
                
                explanations = json.loads(result[json_start:json_end+1])
                
                # Validate and clean
                clean_explanations = {}
                for opt, data in explanations.items():
                    if opt in wrong_options:
                        clean_explanations[opt] = {
                            "why_wrong": data.get("why_wrong", "")[:200],
                            "misconception": data.get("misconception", "general_misunderstanding"),
                            "common_in_nigeria": bool(data.get("common_in_nigeria", False)),
                        }
                
                if clean_explanations:
                    db.table("jamb_questions").update({
                        "wrong_answer_explanations": clean_explanations
                    }).eq("id", q_id).execute()
                    generated += 1
                    logger.info(f"Generated explanations for question {q_id[:8]}")
                
            except Exception as e:
                logger.warning(f"Failed to generate explanations for question {q.get('id', 'unknown')}: {e}")
        
        if generated > 0:
            logger.info(f"Generate explanations: processed {generated}/{len(questions.data)} questions")
            
    except Exception as e:
        logger.error(f"Generate explanations job failed: {e}")
