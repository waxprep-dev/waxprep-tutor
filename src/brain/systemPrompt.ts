import { config } from "../config";
import { StudentProfile } from "../memory/profile";
import * as fs from "fs";
import * as path from "path";

function loadPromptFile(): string {
  try {
    const promptPath = path.join(__dirname, "..", "prompts", "wax-prompt.md");
    return fs.readFileSync(promptPath, "utf8");
  } catch {
    return "";
  }
}

const WAX_PROMPT = loadPromptFile();

export function buildStaticPromptParts(profile: StudentProfile): {
  identity: string;
  mission: string;
  capabilities: string;
  rules: string;
  conversational: string;
} {
  const prompt = WAX_PROMPT || "You are Wax, a personal AI tutor for Nigerian students.";

  return {
    identity: prompt,
    mission: "",
    capabilities: "",
    rules: "",
    conversational: "",
  };
}
