from typing import Dict, Any, List

def compress_prompt_sections(
    full_prompt: str,
    memory_layers: Dict[str, Any],
    max_chars: int = 4000,
) -> str:
    """
    Compress prompt by removing less relevant sections when too long.
    Priority order: identity > student context > curriculum > memory > history
    """
    if len(full_prompt) <= max_chars:
        return full_prompt
    
    # Split into sections
    sections = full_prompt.split("\n\n")
    
    # Priority scores (lower = more important, keep first)
    priority = {
        "You are WaxPrep": 1,  # Identity - NEVER remove
        "STUDENT CONTEXT:": 2,
        "CURRICULUM CONTEXT:": 3,
        "MEMORY:": 4,
        "RECENT CONVERSATION:": 5,
        "Time context:": 6,
        "STUDENT MESSAGE:": 1,  # Never remove
        "Respond as WaxPrep": 1,  # Never remove
    }
    
    # Sort sections by priority
    scored_sections = []
    for section in sections:
        score = 99
        for key, val in priority.items():
            if key in section:
                score = val
                break
        scored_sections.append((score, section))
    
    scored_sections.sort(key=lambda x: x[0])
    
    # Build compressed prompt, adding sections until near limit
    compressed = []
    current_length = 0
    
    for score, section in scored_sections:
        if score == 1:  # Must keep
            compressed.append(section)
            current_length += len(section)
        elif current_length + len(section) <= max_chars:
            compressed.append(section)
            current_length += len(section)
        else:
            # Skip low-priority sections
            if score >= 4:  # Memory or history
                continue
            # For medium priority, try to truncate
            if score == 3 and len(section) > 200:  # Curriculum
                truncated = section[:200] + "... [truncated]"
                if current_length + len(truncated) <= max_chars:
                    compressed.append(truncated)
                    current_length += len(truncated)
    
    return "\n\n".join(compressed)

def get_relevant_context_only(
    memory_layers: Dict[str, Any],
    conversation_state: str = "teaching",
) -> Dict[str, Any]:
    """
    Return only memory layers relevant to current conversation state.
    """
    filtered = {
        "ephemeral": {},
        "short_term": memory_layers.get("short_term", {}),
        "long_term": memory_layers.get("long_term", {}),
        "episodic": {},
        "semantic": {},
    }
    
    # Always include long_term (student profile)
    # Always include short_term (recent messages)
    
    # Include episodic only for returning students
    if not memory_layers.get("long_term", {}).get("onboarding_complete", False):
        pass  # New student, skip episodic
    else:
        filtered["episodic"] = memory_layers.get("episodic", {})
    
    # Include semantic only if subject is set
    if memory_layers.get("long_term", {}).get("current_subject"):
        filtered["semantic"] = memory_layers.get("semantic", {})
    
    # For review mode: minimize everything except short_term
    if conversation_state == "review":
        filtered["episodic"] = {}
        filtered["semantic"] = {}
        # Keep only last 3 messages
        msgs = filtered["short_term"].get("messages", [])
        filtered["short_term"]["messages"] = msgs[-3:]
    
    # For ghost mode: include only identity + basic context
    if conversation_state == "ghost":
        filtered["episodic"] = {}
        filtered["semantic"] = {}
        filtered["short_term"] = {"messages": []}
    
    return filtered
