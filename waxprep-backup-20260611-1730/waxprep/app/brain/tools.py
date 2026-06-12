from dataclasses import dataclass, field
from typing import Dict, Any
import re

TOOL_PATTERN = re.compile(r'\[TOOL:([^\]]+)\]')

@dataclass
class ToolCall:
    name: str
    params: Dict[str, str] = field(default_factory=dict)
    raw: str = ""

TOOLS_REFERENCE = """
AVAILABLE TOOLS — embed these in your response when needed. They are invisible to the student.

STATE UPDATE TOOLS (silent — execute and continue):
[TOOL:update_level|level=SS2] — when student mentions or corrects their class level
[TOOL:update_subject|subject=physics] — when subject becomes clear from message
[TOOL:update_topic|topic=newton_laws] — when specific topic is being discussed
[TOOL:update_exam_target|exam=JAMB] — when student confirms their exam
[TOOL:update_name|name=Kennedy] — when student shares their name
[TOOL:update_emotional_state|state=frustrated] — frustrated, anxious, motivated, neutral, discouraged
[TOOL:save_mastery|concept=circle_theorems|subject=mathematics|score=0.8] — when student demonstrates understanding (score 0.0-1.0)
[TOOL:save_misconception|concept=newton_third_law|subject=physics|description=thinks_action_reaction_cancel_each_other] — when you detect wrong understanding
[TOOL:resolve_misconception|concept=newton_third_law] — when misconception is corrected
[TOOL:save_episodic|type=breakthrough|description=student_finally_understood_photosynthesis|emotion=excited] — memorable moment
[TOOL:save_episodic|type=struggle|description=student_unable_to_grasp_mole_concept_third_session|emotion=frustrated]
[TOOL:schedule_review|concept=photosynthesis|days=3] — schedule spaced repetition after teaching
[TOOL:update_dna|field=example_preference|value=market] — when you detect how student learns best
[TOOL:update_dna|field=pidgin_comfort|value=heavy] — when student writes mostly in Pidgin
[TOOL:update_dna|field=frustration_threshold|value=2] — when student frustrates early
[TOOL:set_exam_date|date=2025-05-15] — when student mentions exam date
[TOOL:set_parent_phone|phone=2348012345678] — when student gives parent number

NEW — SOCRATIC & TEACHING INTELLIGENCE:
[TOOL:update_socratic_pressure|score=7|reason=student_solved_without_hint] — adjust how much Socratic pressure this student can handle (0-10)
[TOOL:update_teaching_concept|concept=photosynthesis] — mark what concept was just taught so next why-question stays on topic
[TOOL:mark_teaching_moment|concept=photosynthesis|depth=why_question_asked] — record that a teaching moment happened

NEW — WAEC THEORY SYSTEM:
[TOOL:get_theory_question|subject=biology|topic=photosynthesis] — fetch a WAEC theory question for the student to answer
[TOOL:submit_theory_answer|question_id=xyz|answer=student_text] — submit student's written answer for evaluation

NEW — GHOST TEACHER MODE:
[TOOL:start_study_session|topic=photosynthesis|duration=20] — begin observing student studying independently
[TOOL:end_study_session|session_id=xyz|status=completed] — end observation and trigger evaluation questions

DATA FETCH TOOLS (brain waits for result, then continues response):
[TOOL:get_performance|subject=mathematics|days=7] — get past assessment scores
[TOOL:get_weak_topics|subject=physics] — get topics where student struggles most
[TOOL:get_knowledge_map|subject=chemistry] — get complete mastery map for a subject
[TOOL:check_prerequisites|topic=differentiation|subject=mathematics] — check if prerequisites are met
[TOOL:get_past_questions|subject=biology|topic=genetics|count=3] — fetch practice questions
[TOOL:get_session_history|days=7] — what we covered in past sessions
[TOOL:get_theory_question|subject=biology|topic=photosynthesis] — fetch WAEC theory question

RULES FOR USING TOOLS:
Embed tools silently — students never see them
Use update tools freely whenever you detect relevant information
Use data fetch tools when you need specific information to answer well
Multiple tools in one response is fine
After save_mastery, always emit schedule_review
After detecting a breakthrough, save_episodic with type=breakthrough
When student is frustrated, update_emotional_state immediately
After teaching a concept, use update_teaching_concept and mark_teaching_moment
After student answers correctly without help, increase socratic_pressure
After student struggles or gives up, decrease socratic_pressure
"""

def parse_tools(raw_response: str):
    tools = []
    for match in TOOL_PATTERN.findall(raw_response):
        parts = match.split("|")
        name = parts[0].strip()
        params = {}
        for part in parts[1:]:
            if "=" in part:
                k, v = part.split("=", 1)
                params[k.strip()] = v.strip()
        tools.append(ToolCall(name=name, params=params, raw=f"[TOOL:{match}]"))

    clean = TOOL_PATTERN.sub("", raw_response).strip()
    clean = re.sub(r'\n{3,}', '\n\n', clean).strip()
    return clean, tools

DATA_FETCH_TOOLS = {
    "get_performance",
    "get_weak_topics",
    "get_knowledge_map",
    "check_prerequisites",
    "get_past_questions",
    "get_session_history",
    "get_theory_question",
}

def needs_second_pass(tools) -> bool:
    return any(t.name in DATA_FETCH_TOOLS for t in tools)
