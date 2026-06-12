"""
================================================================================
PROMPT COMPRESSOR v4.0 - CONNECTED AND OPERATIONAL
================================================================================
Now actually used by the engine when prompts exceed token limits.
================================================================================
"""
from typing import Dict, Any, List

def compress_prompt_sections(
    full_prompt: str,
    memory_layers: Dict[str, Any],
    max_chars: int = 4000,
) -> str:
    if len(full_prompt) <= max_chars:
        return full_prompt

    sections = full_prompt.split("\n\n---\n\n")

    priority = {
        "You are WaxPrep": 1,
        "[PROFILE]": 2,
        "[GOAL]": 2,
        "[KNOWLEDGE]": 3,
        "[MEMORY]": 4,
        "Recent chat:": 5,
        "Student message:": 1,
        "Respond as WaxPrep": 1,
    }

    scored_sections = []
    for section in sections:
        score = 99
        for key, val in priority.items():
            if key in section:
                score = val
                break
        scored_sections.append((score, section))

    scored_sections.sort(key=lambda x: x[0])

    compressed = []
    current_length = 0

    for score, section in scored_sections:
        if score == 1:
            compressed.append(section)
            current_length += len(section)
        elif current_length + len(section) <= max_chars:
            compressed.append(section)
            current_length += len(section)
        elif score >= 5:
            continue
        elif score == 4 and len(section) > 200:
            truncated = section[:200] + "... [truncated]"
            if current_length + len(truncated) <= max_chars:
                compressed.append(truncated)
                current_length += len(truncated)

    return "\n\n---\n\n".join(compressed)
