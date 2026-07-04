// FILE: src/utils/lengthAwareness.ts
// The one hardcoded law. Everything else breathes.

export const HARD_CAP = 900;

export function emergencyTrim(text: string, target: number, max: number = HARD_CAP): string {
  if (text.length <= max) return text;

  const trimmed = text.slice(0, max).trim();
  const lastBreak = Math.max(
    trimmed.lastIndexOf(". "),
    trimmed.lastIndexOf("! "),
    trimmed.lastIndexOf("? ")
  );

  if (lastBreak > target * 0.6) {
    return trimmed.slice(0, lastBreak + 1);
  }

  return trimmed.slice(0, target);
}
