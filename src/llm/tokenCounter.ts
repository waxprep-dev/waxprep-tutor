// Rough token counter for budgeting context windows.
// 1 token ≈ 4 characters in English. For precise counts, use tiktoken,
// but this approximation is enough for our memory budgeting.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Array<{ role: string; content: string | null }>): number {
  let total = 0;
  for (const m of messages) {
    // ~4 tokens overhead per message for role markers
    total += 4;
    if (m.content) total += estimateTokens(m.content);
  }
  return total;
}
