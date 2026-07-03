// FILE: src/memory/mindPalace.ts
// ============================================================
// THE MIND PALACE — Hierarchical Memory System
// ============================================================

import { query, queryOne } from "../db/client";
import { embed } from "./embeddings";
import { logger } from "../utils/logger";

export interface MemoryChunk {
  chunkId: string;
  studentPhone: string;
  memoryType: "working" | "episodic" | "semantic" | "procedural" | "meta";
  content: string;
  embedding?: number[];
  importanceScore: number;
  baseActivation: number;
  accessCount: number;
  lastAccessed: Date;
  createdAt: Date;
  decayRate: number;
  consolidationStatus: string;
  metadata: any;
  episodeId?: string;
}

export interface ConsolidationResult {
  merged: number;
  created: number;
  pruned: number;
}

export class MindPalace {
  // ============================================================
  // LAYER 1: WORKING MEMORY
  // ============================================================

  async getWorkingMemory(studentPhone: string): Promise<MemoryChunk[]> {
    return query(
      `SELECT * FROM memory_chunks 
       WHERE student_phone = $1 AND memory_type = 'working'
       AND consolidation_status != 'pruned'
       ORDER BY created_at DESC 
       LIMIT 10`,
      [studentPhone]
    );
  }

  async addWorkingMemory(
    studentPhone: string,
    content: string,
    episodeId?: string
  ): Promise<void> {
    const embedding = await embed(content);
    await query(
      `INSERT INTO memory_chunks (
        student_phone, memory_type, content, embedding, 
        importance_score, base_activation, episode_id
      ) VALUES ($1, 'working', $2, $3, 0.7, 0.8, $4)`,
      [studentPhone, content, embedding ? JSON.stringify(embedding) : null, episodeId]
    );
  }

  // ============================================================
  // LAYER 2: EPISODIC MEMORY
  // ============================================================

  async getEpisodicMemory(
    studentPhone: string,
    queryText?: string,
    topK: number = 5
  ): Promise<MemoryChunk[]> {
    if (queryText) {
      const embedding = await embed(queryText);
      if (embedding) {
        return query(
          `SELECT *, 1 - (embedding <=> $2::vector) as similarity
           FROM memory_chunks 
           WHERE student_phone = $1 AND memory_type = 'episodic'
           AND consolidation_status != 'pruned'
           ORDER BY embedding <=> $2::vector
           LIMIT $3`,
          [studentPhone, JSON.stringify(embedding), topK]
        );
      }
    }
    return query(
      `SELECT * FROM memory_chunks 
       WHERE student_phone = $1 AND memory_type = 'episodic'
       AND consolidation_status != 'pruned'
       ORDER BY base_activation DESC, created_at DESC
       LIMIT $2`,
      [studentPhone, topK]
    );
  }

  async addEpisodicMemory(
    studentPhone: string,
    content: string,
    importance: number = 0.6,
    episodeId?: string,
    metadata?: any
  ): Promise<void> {
    const embedding = await embed(content);
    await query(
      `INSERT INTO memory_chunks (
        student_phone, memory_type, content, embedding, 
        importance_score, base_activation, episode_id, metadata
      ) VALUES ($1, 'episodic', $2, $3, $4, $4, $5, $6)`,
      [
        studentPhone,
        content,
        embedding ? JSON.stringify(embedding) : null,
        importance,
        episodeId,
        JSON.stringify(metadata || { source: "conversation" })
      ]
    );
  }

  // ============================================================
  // LAYER 3: SEMANTIC MEMORY
  // ============================================================

  async getSemanticMemory(
    studentPhone: string,
    conceptQuery?: string
  ): Promise<MemoryChunk[]> {
    if (conceptQuery) {
      const embedding = await embed(conceptQuery);
      if (embedding) {
        return query(
          `SELECT *, 1 - (embedding <=> $2::vector) as similarity
           FROM memory_chunks 
           WHERE student_phone = $1 AND memory_type = 'semantic'
           AND consolidation_status != 'pruned'
           ORDER BY embedding <=> $2::vector
           LIMIT 5`,
          [studentPhone, JSON.stringify(embedding)]
        );
      }
    }
    return query(
      `SELECT * FROM memory_chunks 
       WHERE student_phone = $1 AND memory_type = 'semantic'
       AND consolidation_status != 'pruned'
       ORDER BY base_activation DESC
       LIMIT 5`,
      [studentPhone]
    );
  }

  async addSemanticMemory(
    studentPhone: string,
    content: string,
    conceptName: string,
    masteryLevel: number = 0,
    importance: number = 0.8
  ): Promise<void> {
    const embedding = await embed(content);
    await query(
      `INSERT INTO memory_chunks (
        student_phone, memory_type, content, embedding, 
        importance_score, base_activation, metadata
      ) VALUES ($1, 'semantic', $2, $3, $4, $4, $5)`,
      [
        studentPhone,
        content,
        embedding ? JSON.stringify(embedding) : null,
        importance,
        JSON.stringify({ concept: conceptName, mastery: masteryLevel })
      ]
    );
  }

  // ============================================================
  // LAYER 4: PROCEDURAL MEMORY — FIXED SIGNATURE
  // ============================================================

  async getProceduralMemory(
    studentPhone: string,
    triggerContext?: string
  ): Promise<MemoryChunk[]> {
    if (triggerContext) {
      const embedding = await embed(triggerContext);
      if (embedding) {
        return query(
          `SELECT *, 1 - (embedding <=> $2::vector) as similarity
           FROM memory_chunks 
           WHERE student_phone = $1 AND memory_type = 'procedural'
           AND consolidation_status != 'pruned'
           ORDER BY embedding <=> $2::vector
           LIMIT 5`,
          [studentPhone, JSON.stringify(embedding)]
        );
      }
    }
    return query(
      `SELECT * FROM memory_chunks 
       WHERE student_phone = $1 AND memory_type = 'procedural'
       AND consolidation_status != 'pruned'
       ORDER BY base_activation DESC
       LIMIT 5`,
      [studentPhone]
    );
  }

  // FIX: Changed metadata parameter to accept string or Record
  async addProceduralMemory(
    studentPhone: string,
    ruleText: string,
    triggerCondition: string,
    confidence: number = 0.7,
    metadata: string | Record<string, any> = {}
  ): Promise<void> {
    const embedding = await embed(ruleText);
    
    // Ensure metadata is a proper object
    let metadataObj: Record<string, any> = {};
    if (typeof metadata === 'string') {
      try {
        metadataObj = JSON.parse(metadata);
      } catch (e) {
        metadataObj = { raw: metadata };
      }
    } else if (metadata && typeof metadata === 'object') {
      metadataObj = metadata as Record<string, any>;
    }

    // Ensure required fields
    metadataObj.trigger = metadataObj.trigger || triggerCondition;
    metadataObj.confidence = metadataObj.confidence || confidence;
    metadataObj.source = metadataObj.source || "witness";
    metadataObj.modality = metadataObj.modality || "unknown";

    await query(
      `INSERT INTO memory_chunks (
        student_phone, memory_type, content, embedding, 
        importance_score, base_activation, metadata
      ) VALUES ($1, 'procedural', $2, $3, $4, $4, $5)`,
      [
        studentPhone,
        ruleText,
        embedding ? JSON.stringify(embedding) : null,
        confidence,
        JSON.stringify(metadataObj)
      ]
    );
  }

  // ============================================================
  // LAYER 5: META MEMORY
  // ============================================================

  async getMetaMemory(patternType?: string): Promise<any[]> {
    if (patternType) {
      return query(
        `SELECT * FROM teaching_patterns 
         WHERE pattern_type = $1 AND success_rate > 0.6
         ORDER BY success_rate DESC 
         LIMIT 10`,
        [patternType]
      );
    }
    return query(
      `SELECT * FROM teaching_patterns 
       WHERE success_rate > 0.6
       ORDER BY success_rate DESC 
       LIMIT 10`
    );
  }

  // ============================================================
  // ACTIVATION AND DECAY
  // ============================================================

  async accessMemory(chunkId: string): Promise<void> {
    await query(
      `UPDATE memory_chunks 
       SET access_count = access_count + 1,
           last_accessed = NOW(),
           base_activation = base_activation + (0.1 * importance_score)
       WHERE chunk_id = $1`,
      [chunkId]
    );
  }

  async applyDecay(): Promise<{ decayed: number; pruned: number }> {
    const decayed = await query(
      `UPDATE memory_chunks 
       SET base_activation = base_activation * EXP(
         -decay_rate * EXTRACT(EPOCH FROM (NOW() - last_accessed)) / 86400
       ),
       consolidation_status = CASE 
         WHEN base_activation * EXP(
           -decay_rate * EXTRACT(EPOCH FROM (NOW() - last_accessed)) / 86400
         ) < 0.1 
         THEN 'decayed' 
         ELSE consolidation_status 
       END
       WHERE consolidation_status IN ('fresh', 'consolidated')
       RETURNING chunk_id`
    );

    const pruned = await query(
      `UPDATE memory_chunks 
       SET consolidation_status = 'pruned'
       WHERE (memory_type = 'working' AND created_at < NOW() - INTERVAL '24 hours')
       OR (consolidation_status = 'decayed' AND last_accessed < NOW() - INTERVAL '90 days')
       RETURNING chunk_id`
    );

    return {
      decayed: decayed.length,
      pruned: pruned.length
    };
  }

  // ============================================================
  // CONSOLIDATION
  // ============================================================

  async consolidateEpisodes(studentPhone: string): Promise<ConsolidationResult> {
    const episodes = await query(
      `SELECT chunk_id, content, embedding, created_at, metadata
       FROM memory_chunks
       WHERE student_phone = $1 AND memory_type = 'episodic'
       AND consolidation_status = 'fresh'
       ORDER BY created_at DESC
       LIMIT 20`,
      [studentPhone]
    );

    if (episodes.length < 2) {
      return { merged: 0, created: 0, pruned: 0 };
    }

    let merged = 0;
    let created = 0;
    const processed = new Set<string>();

    for (let i = 0; i < episodes.length; i++) {
      if (processed.has(episodes[i].chunk_id)) continue;

      const similar = await query(
        `SELECT chunk_id, content, 1 - (embedding <=> $2::vector) as similarity
         FROM memory_chunks
         WHERE student_phone = $1 AND memory_type = 'episodic'
         AND chunk_id != $3
         AND consolidation_status = 'fresh'
         AND 1 - (embedding <=> $2::vector) > 0.8
         ORDER BY similarity DESC
         LIMIT 3`,
        [studentPhone, JSON.stringify(episodes[i].embedding), episodes[i].chunk_id]
      );

      if (similar.length >= 2) {
        const combinedContent = `Theme: ${episodes[i].content.substring(0, 100)}
Related: ${similar.map((s: any) => s.content.substring(0, 80)).join('\n')}`;

        const importance = 0.5 + (similar.length * 0.1);

        const concepts = this.extractConcepts(
          [episodes[i], ...similar].map((e: any) => e.content)
        );

        for (const concept of concepts.slice(0, 3)) {
          await this.addSemanticMemory(
            studentPhone,
            `${concept}: ${combinedContent}`,
            concept,
            0.3,
            importance
          );
        }

        const idsToMark = [episodes[i].chunk_id, ...similar.map((s: any) => s.chunk_id)];
        await query(
          `UPDATE memory_chunks SET consolidation_status = 'consolidated' 
           WHERE chunk_id = ANY($1)`,
          [idsToMark]
        );

        processed.add(episodes[i].chunk_id);
        similar.forEach((s: any) => processed.add(s.chunk_id));
        merged += similar.length;
        created++;
      }
    }

    return { merged, created, pruned: 0 };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private extractConcepts(texts: string[]): string[] {
    const allText = texts.join(' ');
    const subjectMap: Record<string, string[]> = {
      physics: ['force', 'velocity', 'acceleration', 'momentum', 'energy', 'gravity', 'friction'],
      maths: ['algebra', 'quadratic', 'fractions', 'decimals', 'geometry', 'trigonometry'],
      biology: ['cell', 'photosynthesis', 'genetics', 'ecosystem', 'evolution'],
      chemistry: ['mole', 'atomic', 'bonding', 'equilibrium', 'reaction'],
      english: ['tenses', 'vocabulary', 'comprehension', 'essay']
    };

    const found: string[] = [];
    for (const [subject, words] of Object.entries(subjectMap)) {
      for (const word of words) {
        if (allText.toLowerCase().includes(word) && !found.includes(word)) {
          found.push(word);
        }
      }
    }
    return found;
  }
}

export const mindPalace = new MindPalace();
