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

export const COMMON_TOPICS = {
  subjects: [
    { id: "math", title: "Mathematics", description: "Algebra, geometry, calculus" },
    { id: "english", title: "English", description: "Grammar, essays, comprehension" },
    { id: "physics", title: "Physics", description: "Mechanics, electricity, waves" },
    { id: "chemistry", title: "Chemistry", description: "Organic, inorganic, calculations" },
    { id: "biology", title: "Biology", description: "Cells, genetics, ecology" },
    { id: "economics", title: "Economics", description: "Micro, macro, Nigerian economy" },
    { id: "government", title: "Government", description: "Polity, history, current affairs" },
  ],
  math_topics: [
    { id: "algebra", title: "Algebra", description: "Equations, factoring, polynomials" },
    { id: "geometry", title: "Geometry", description: "Shapes, angles, theorems" },
    { id: "quadratic", title: "Quadratic Equations", description: "Solving, graphing, word problems" },
    { id: "trigonometry", title: "Trigonometry", description: "Sin, cos, tan, identities" },
    { id: "calculus", title: "Calculus", description: "Differentiation, integration" },
  ],
  english_topics: [
    { id: "grammar", title: "Grammar", description: "Tenses, parts of speech" },
    { id: "essay", title: "Essay Writing", description: "Structure, arguments, style" },
    { id: "comprehension", title: "Comprehension", description: "Reading and answering" },
    { id: "summary", title: "Summary Writing", description: "Condensing passages" },
  ],
};
