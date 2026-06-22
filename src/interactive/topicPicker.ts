import { sendListMessage } from "../whatsapp/interactive";
import { logger } from "../utils/logger";

export interface TopicOption {
  id: string;
  title: string;
  description?: string;
}

export interface TopicSection {
  title: string;
  topics: TopicOption[];
}

export async function sendTopicPicker(
  toPhone: string,
  prompt: string,
  sections: TopicSection[],
  buttonLabel: string = "Pick a topic"
): Promise<{ message_id: string }> {
  const formattedSections = sections.map((s) => ({
    title: s.title.substring(0, 24),
    rows: s.topics.map((t) => ({
      id: `topic:${t.id}`,
      title: t.title.substring(0, 24),
      description: t.description?.substring(0, 72),
    })),
  }));

  const result = await sendListMessage(toPhone, prompt, buttonLabel, formattedSections);
  logger.info("Topic picker sent", { to: toPhone, sections: sections.length });
  return result;
}
