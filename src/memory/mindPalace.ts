// FILE: src/memory/mindPalace.ts
// ============================================================
// THE MIND PALACE — Hierarchical Memory System
// 5 Layers: Working → Episodic → Semantic → Procedural → Meta
// With ACT-R inspired base-level activation, decay, and consolidation
// ============================================================

import { query, queryOne } from "../db/client";
import { embed, embedBatch } from "./embeddings";
import { logger } from "../utils/logger";

// ============================================================
// TYPES
// ============================================================

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

// ============================================================
// THE MIND PALACE CLASS
// ============================================================

export class MindPalace {
  // ============================================================
  // LAYER 1: WORKING MEMORY — Last 10 messages
  // Fast, short-term. Deleted after 24 hours.
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

  async clearWorkingMemory(studentPhone: string): Promise<void> {
    await query(
      `UPDATE memory_chunks SET consolidation_status = 'pruned'
       WHERE student_phone = $1 AND memory_type = 'working'
       AND created_at < NOW() - INTERVAL '24 hours'`,
      [studentPhone]
    );
  }

  // ============================================================
  // LAYER 2: EPISODIC MEMORY — Conversation summaries
  // Medium-term. Used for semantic search.
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
  // LAYER 3: SEMANTIC MEMORY — Concepts and mastery
  // Long-term. What the student knows.
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

  async updateConceptMastery(
    studentPhone: string,
    conceptName: string,
    newMastery: number,
    evidence: string
  ): Promise<void> {
    const chunk = await queryOne(
      `SELECT chunk_id, metadata FROM memory_chunks
       WHERE student_phone = $1 AND memory_type = 'semantic'
       AND metadata->>'concept' = $2
       AND consolidation_status != 'pruned'
       LIMIT 1`,
      [studentPhone, conceptName]
    );

    if (chunk) {
      const metadata = chunk.metadata || {};
      metadata.mastery = newMastery;
      metadata.evidence = evidence;
      metadata.updated_at = new Date().toISOString();

      await query(
        `UPDATE memory_chunks 
         SET metadata = $1, 
             base_activation = base_activation * 1.1,
             importance_score = (importance_score + 0.8) / 2
         WHERE chunk_id = $2`,
        [JSON.stringify(metadata), chunk.chunk_id]
      );
    } else {
      await this.addSemanticMemory(
        studentPhone,
        `Concept: ${conceptName}. Mastery: ${newMastery}. Evidence: ${evidence}`,
        conceptName,
        newMastery,
        0.8
      );
    }
  }

  // ============================================================
  // LAYER 4: PROCEDURAL MEMORY — Teaching rules
  // Long-term. What works for this student.
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

  async addProceduralMemory(
    studentPhone: string,
    ruleText: string,
    triggerCondition: string,
    confidence: number = 0.7,
    metadata?: any
  ): Promise<void> {
    const embedding = await embed(ruleText);
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
        JSON.stringify({
          trigger: triggerCondition,
          confidence,
          source: metadata?.source || "witness",
          modality: metadata?.modality || "unknown"
        })
      ]
    );
  }

  // ============================================================
  // LAYER 5: META MEMORY — Cross-student patterns
  // System-wide. What works for similar students.
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

  async addMetaPattern(
    patternData: any,
    archetypeSignature: any,
    patternType: string
  ): Promise<void> {
    const patternHash = this.hashPattern(JSON.stringify(patternData));
    const existing = await queryOne(
      `SELECT pattern_id FROM teaching_patterns WHERE pattern_hash = $1`,
      [patternHash]
    );

    if (!existing) {
      await query(
        `INSERT INTO teaching_patterns (
          pattern_hash, archetype_signature, pattern_type, pattern_data
        ) VALUES ($1, $2, $3, $4)`,
        [
          patternHash,
          JSON.stringify(archetypeSignature),
          patternType,
          JSON.stringify(patternData)
        ]
      );
    }
  }

  // ============================================================
  // ACT-R INSPIRED: Activation and Decay
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
    // Decay: B_new = B_old * exp(-decay_rate * days_since_access)
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

    // Prune: Remove working memories older than 24 hours, decayed older than 90 days
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
  // CONSOLIDATION — Merge similar episodes into semantic memories
  // ============================================================

  async consolidateEpisodes(studentPhone: string): Promise<ConsolidationResult> {
    // Find fresh episodic memories that haven't been consolidated
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

      // Find similar episodes (similarity > 0.8)
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
        // Extract concepts from episodes
        const concepts = this.extractConcepts(
          [episodes[i], ...similar].map(e => e.content)
        );

        // Create consolidated semantic memory
        const combinedContent = `Theme: ${episodes[i].content.substring(0, 100)}
Related: ${similar.map(s => s.content.substring(0, 80)).join('\n')}`;

        const importance = 0.5 + (similar.length * 0.1);

        for (const concept of concepts.slice(0, 3)) {
          await this.addSemanticMemory(
            studentPhone,
            `${concept}: ${combinedContent}`,
            concept,
            0.3,
            importance
          );
        }

        // Mark episodes as consolidated
        const idsToMark = [episodes[i].chunk_id, ...similar.map(s => s.chunk_id)];
        await query(
          `UPDATE memory_chunks SET consolidation_status = 'consolidated' 
           WHERE chunk_id = ANY($1)`,
          [idsToMark]
        );

        processed.add(episodes[i].chunk_id);
        similar.forEach(s => processed.add(s.chunk_id));
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

  private hashPattern(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

export const mindPalace = new MindPalace();
