// ============================================================
// THE HIPPOCAMPUS — Temporal Knowledge Graph Memory
// Every fact has time. Every relationship has provenance.
// ============================================================

import { query, queryOne } from "../db/client";
import { embed } from "./embeddings";
import { logger } from "../utils/logger";

export interface TemporalFact {
  nodeId: string;
  label: string;
  nodeType: string;
  properties: any;
  validFrom: Date;
  validUntil?: Date;
  confidence: number;
}

export interface TemporalRelation {
  edgeId: string;
  fromNode: string;
  toNode: string;
  edgeType: string;
  weight: number;
  validFrom: Date;
  validUntil?: Date;
}

export class Hippocampus {
  // ============================================================
  // STORE FACT — With temporal validity
  // ============================================================
  async storeFact(
    studentPhone: string,
    nodeType: string,
    label: string,
    properties: any,
    confidence: number = 1.0
  ): Promise<string> {
    // Invalidate any existing fact of same type for this student
    await query(
      `UPDATE temporal_nodes 
       SET valid_until = NOW()
       WHERE node_type = $1 
       AND properties->>'student_phone' = $2
       AND label = $3
       AND valid_until IS NULL`,
      [nodeType, studentPhone, label]
    );

    const embedding = await embed(label + " " + JSON.stringify(properties));

    const row = await queryOne<{ node_id: string }>(
      `INSERT INTO temporal_nodes (node_type, label, properties, embedding, confidence, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING node_id`,
      [nodeType, label, JSON.stringify({ ...properties, student_phone: studentPhone }), embedding ? JSON.stringify(embedding) : null, confidence, "hippocampus"]
    );

    if (!row) {
      throw new Error(`Failed to store fact: ${label} for student ${studentPhone}`);
    }

    return row.node_id;
  }

  // ============================================================
  // STORE RELATION — With temporal validity
  // ============================================================
  async storeRelation(
    fromNodeId: string,
    toNodeId: string,
    edgeType: string,
    weight: number = 0.5,
    properties: any = {}
  ): Promise<string> {
    // Invalidate old relation of same type between same nodes
    await query(
      `UPDATE temporal_edges 
       SET valid_until = NOW()
       WHERE from_node = $1 AND to_node = $2 AND edge_type = $3
       AND valid_until IS NULL`,
      [fromNodeId, toNodeId, edgeType]
    );

    const row = await queryOne<{ edge_id: string }>(
      `INSERT INTO temporal_edges (from_node, to_node, edge_type, weight, properties, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING edge_id`,
      [fromNodeId, toNodeId, edgeType, weight, JSON.stringify(properties), "hippocampus"]
    );

    if (!row) {
      throw new Error(`Failed to store relation: ${edgeType} between ${fromNodeId} and ${toNodeId}`);
    }

    return row.edge_id;
  }

  // ============================================================
  // RETRIEVE CURRENT FACTS — What's true NOW
  // ============================================================
  async getCurrentFacts(
    studentPhone: string,
    nodeType?: string,
    limit: number = 20
  ): Promise<TemporalFact[]> {
    let sql = `
      SELECT * FROM temporal_nodes
      WHERE properties->>'student_phone' = $1
      AND valid_until IS NULL
    `;
    const params: any[] = [studentPhone];

    if (nodeType) {
      sql += ` AND node_type = $2`;
      params.push(nodeType);
    }

    sql += ` ORDER BY confidence DESC, created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    return query(sql, params);
  }

  // ============================================================
  // RETRIEVE HISTORICAL FACTS — What was true at a specific time
  // ============================================================
  async getFactsAtTime(
    studentPhone: string,
    atTime: Date,
    nodeType?: string,
    limit: number = 20
  ): Promise<TemporalFact[]> {
    let sql = `
      SELECT * FROM temporal_nodes
      WHERE properties->>'student_phone' = $1
      AND valid_from <= $2
      AND (valid_until IS NULL OR valid_until > $2)
    `;
    const params: any[] = [studentPhone, atTime];

    if (nodeType) {
      sql += ` AND node_type = $3`;
      params.push(nodeType);
    }

    sql += ` ORDER BY confidence DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    return query(sql, params);
  }

  // ============================================================
  // SEMANTIC SEARCH + GRAPH TRAVERSAL
  // ============================================================
  async searchWithContext(
    studentPhone: string,
    queryText: string,
    topK: number = 5
  ): Promise<any[]> {
    const embedding = await embed(queryText);
    if (!embedding) return [];

    const similarNodes = await query(
      `SELECT node_id, label, node_type, properties, confidence,
              1 - (embedding <=> $2::vector) as similarity
       FROM temporal_nodes
       WHERE properties->>'student_phone' = $1
       AND valid_until IS NULL
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [studentPhone, JSON.stringify(embedding), topK]
    );

    const enriched = [];
    for (const node of similarNodes) {
      const related = await query(
        `SELECT e.edge_type, e.weight, n.label as related_label, n.node_type as related_type
         FROM temporal_edges e
         JOIN temporal_nodes n ON n.node_id = e.to_node
         WHERE e.from_node = $1
         AND e.valid_until IS NULL
         AND n.valid_until IS NULL
         ORDER BY e.weight DESC
         LIMIT 5`,
        [node.node_id]
      );

      enriched.push({
        ...node,
        related_facts: related
      });
    }

    return enriched;
  }

  // ============================================================
  // EPISODIC STORAGE — Store conversation with temporal metadata
  // ============================================================
  async storeEpisodeChunk(
    studentPhone: string,
    episodeId: string,
    sequenceNumber: number,
    content: string,
    speaker: 'student' | 'wax',
    emotionalValence?: number,
    cognitiveLoad?: number
  ): Promise<void> {
    const embedding = await embed(content);
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';

    await query(
      `INSERT INTO episodic_chunks 
       (student_phone, episode_id, sequence_number, content, speaker, embedding, 
        emotional_valence, cognitive_load, time_of_day, day_of_week)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        studentPhone, episodeId, sequenceNumber, content, speaker,
        embedding ? JSON.stringify(embedding) : null,
        emotionalValence, cognitiveLoad, timeOfDay, new Date().getDay()
      ]
    );
  }

  // ============================================================
  // RETRIEVE EPISODIC SEQUENCE — Ordered by time
  // ============================================================
  async getEpisodeSequence(
    studentPhone: string,
    episodeId: string,
    limit: number = 50
  ): Promise<any[]> {
    return query(
      `SELECT * FROM episodic_chunks
       WHERE student_phone = $1 AND episode_id = $2
       ORDER BY sequence_number ASC
       LIMIT $3`,
      [studentPhone, episodeId, limit]
    );
  }

  // ============================================================
  // CONSOLIDATION — Merge similar episodes into semantic memories
  // ============================================================
  async consolidateEpisodes(studentPhone: string): Promise<{ merged: number; concepts: number }> {
    const freshChunks = await query(
      `SELECT * FROM episodic_chunks
       WHERE student_phone = $1 AND consolidation_status = 'fresh'
       ORDER BY timestamp DESC`,
      [studentPhone]
    );

    if (freshChunks.length < 3) return { merged: 0, concepts: 0 };

    let merged = 0;
    let conceptsExtracted = 0;

    const groups = this.groupBySimilarity(freshChunks);

    for (const group of groups) {
      if (group.length < 2) continue;

      const keyConcepts = await this.extractConcepts(group);

      for (const concept of keyConcepts) {
        await this.upsertSemanticConcept(studentPhone, concept);
        conceptsExtracted++;
      }

      const chunkIds = group.map((c: any) => c.chunk_id);
      await query(
        `UPDATE episodic_chunks SET consolidation_status = 'consolidated' WHERE chunk_id = ANY($1)`,
        [chunkIds]
      );
      merged += group.length;
    }

    return { merged, concepts: conceptsExtracted };
  }

  private groupBySimilarity(chunks: any[]): any[][] {
    const groups: any[][] = [];
    const used = new Set<string>();

    for (const chunk of chunks) {
      if (used.has(chunk.chunk_id)) continue;

      const group = [chunk];
      used.add(chunk.chunk_id);

      for (const other of chunks) {
        if (used.has(other.chunk_id)) continue;
        const sim = this.cosineSimilarity(chunk.embedding, other.embedding);
        if (sim > 0.8) {
          group.push(other);
          used.add(other.chunk_id);
        }
      }

      if (group.length >= 2) groups.push(group);
    }

    return groups;
  }

  private cosineSimilarity(a: any, b: any): number {
    if (!a || !b) return 0;
    const vecA = Array.isArray(a) ? a : JSON.parse(a);
    const vecB = Array.isArray(b) ? b : JSON.parse(b);
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      magA += vecA[i] * vecA[i];
      magB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private async extractConcepts(chunks: any[]): Promise<string[]> {
    try {
      const { callLLM } = await import("../llm/client");
      const contents = chunks.map((c: any) => c.content).join("\n");
      const response = await callLLM({
        messages: [
          { role: "system", content: "Extract the main academic concepts from this conversation. Return as JSON array of strings." },
          { role: "user", content: contents }
        ],
        temperature: 0.2,
        max_tokens: 100,
        agent: "hippocampus"
      });
      const parsed = JSON.parse(response.content || "[]");
      return Array.isArray(parsed) ? parsed : ["general"];
    } catch (e) {
      logger.warn("Concept extraction failed, using defaults", { error: e instanceof Error ? e.message : String(e) });
      return ["general"];
    }
  }

  private async upsertSemanticConcept(studentPhone: string, conceptName: string): Promise<void> {
    const existing = await queryOne(
      `SELECT concept_id FROM semantic_concepts 
       WHERE student_phone = $1 AND concept_name = $2`,
      [studentPhone, conceptName]
    );

    if (existing) {
      await query(
        `UPDATE semantic_concepts 
         SET reinforcement_count = reinforcement_count + 1,
             last_reinforced = NOW()
         WHERE concept_id = $1`,
        [existing.concept_id]
      );
    } else {
      await query(
        `INSERT INTO semantic_concepts (student_phone, concept_name, subject, mastery_level)
         VALUES ($1, $2, 'general', 0.1)`,
        [studentPhone, conceptName]
      );
    }
  }
}

export const hippocampus = new Hippocampus();
