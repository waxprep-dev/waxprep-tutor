// ============================================================
// THE CIRCADIAN ENGINE — Time-Aware Tutoring
// Wax knows when to teach, not just what to teach.
// ============================================================

import { query, queryOne } from "../db/client";
import { logger } from "../utils/logger";

export interface CircadianProfile {
  chronotype: 'lark' | 'owl' | 'neutral' | 'unknown';
  peakAlertnessHour: number;
  peakCreativityHour: number;
  peakAnalyticalHour: number;
  lowestEnergyHour: number;
  responseTimeByHour: Record<number, number>;
  engagementByHour: Record<number, number>;
  bestSubjectByHour: Record<number, string>;
}

export class CircadianEngine {
  // ============================================================
  // UPDATE PROFILE — Learn from every interaction
  // ============================================================
  async updateProfile(studentPhone: string, messageTimestamp: Date, messageLength: number, responseTimeMs: number): Promise<void> {
    const hour = messageTimestamp.getHours();
    const dayOfWeek = messageTimestamp.getDay();

    const existing = await queryOne(
      `SELECT * FROM circadian_profiles WHERE student_phone = $1`,
      [studentPhone]
    );

    if (!existing) {
      // Create initial profile
      await query(
        `INSERT INTO circadian_profiles (student_phone, response_time_by_hour, engagement_by_hour)
         VALUES ($1, $2, $3)`,
        [studentPhone, JSON.stringify({ [hour]: responseTimeMs }), JSON.stringify({ [hour]: messageLength })]
      );
      return;
    }

    // Update running averages
    const responseTimes = existing.response_time_by_hour || {};
    const engagements = existing.engagement_by_hour || {};

    responseTimes[hour] = this.runningAverage(responseTimes[hour], responseTimeMs);
    engagements[hour] = this.runningAverage(engagements[hour], messageLength);

    // Detect chronotype
    const chronotype = this.detectChronotype(responseTimes, engagements);

    // Find peak hours
    const peakAlertness = this.findMinHour(responseTimes); // Fastest response = most alert
    const peakEngagement = this.findMaxHour(engagements); // Longest messages = most engaged

    await query(
      `UPDATE circadian_profiles SET
        chronotype = $2,
        peak_alertness_hour = $3,
        peak_creativity_hour = $4,
        lowest_energy_hour = $5,
        response_time_by_hour = $6,
        engagement_by_hour = $7,
        last_updated = NOW()
       WHERE student_phone = $1`,
      [
        studentPhone,
        chronotype,
        peakAlertness,
        peakEngagement,
        this.findMaxHour(responseTimes), // Slowest = lowest energy
        JSON.stringify(responseTimes),
        JSON.stringify(engagements)
      ]
    );
  }

  // ============================================================
  // GET OPTIMAL TEACHING WINDOW — When should we teach this topic?
  // ============================================================
  async getOptimalWindow(
    studentPhone: string,
    subject: string,
    difficulty: 'easy' | 'medium' | 'hard'
  ): Promise<{ optimalHour: number; reason: string; urgency: number }> {
    const profile = await queryOne(
      `SELECT * FROM circadian_profiles WHERE student_phone = $1`,
      [studentPhone]
    );

    if (!profile) {
      return { optimalHour: 10, reason: "No profile yet — defaulting to mid-morning", urgency: 0.5 };
    }

    const now = new Date();
    const currentHour = now.getHours();

    // For hard topics, need peak alertness
    if (difficulty === 'hard') {
      const peakHour = profile.peak_alertness_hour || 10;
      const hoursUntilPeak = (peakHour - currentHour + 24) % 24;
      return {
        optimalHour: peakHour,
        reason: `Hard topic needs peak alertness. Student is most alert at ${peakHour}:00.`,
        urgency: hoursUntilPeak < 3 ? 0.9 : 0.5
      };
    }

    // For easy topics, any time is fine but prefer engagement peak
    const engagementPeak = profile.peak_creativity_hour || 14;
    return {
      optimalHour: engagementPeak,
      reason: `Easy topic — teaching during engagement peak at ${engagementPeak}:00 for best retention.`,
      urgency: 0.3
    };
  }

  // ============================================================
  // GENERATE TEMPORAL GENE — Dynamic prompt based on time
  // "morning_energy", "evening_fatigue", "late_night"
  // ============================================================
  async getTemporalGene(studentPhone: string): Promise<{ geneName: string; reason: string }> {
    const hour = new Date().getHours();
    const profile = await queryOne(
      `SELECT * FROM circadian_profiles WHERE student_phone = $1`,
      [studentPhone]
    );

    // If we know their chronotype, use it
    if (profile?.chronotype === 'owl' && hour < 10) {
      return { geneName: 'late_night', reason: "Owl student in morning — be gentle" };
    }
    if (profile?.chronotype === 'lark' && hour > 20) {
      return { geneName: 'evening_fatigue', reason: "Lark student at night — winding down" };
    }

    // Default time-based
    if (hour < 12) return { geneName: 'morning_energy', reason: "Morning — fresh start" };
    if (hour < 17) return { geneName: 'morning_energy', reason: "Afternoon — good energy" };
    if (hour < 21) return { geneName: 'evening_fatigue', reason: "Evening — tapering off" };
    return { geneName: 'late_night', reason: "Late night — be careful" };
  }

  // ============================================================
  // PREDICT BURNOUT FROM TEMPORAL PATTERNS
  // ============================================================
  async predictBurnoutFromPatterns(studentPhone: string): Promise<number> {
    const recentMessages = await query(
      `SELECT timestamp, time_of_day FROM message_log
       WHERE student_phone = $1
       AND timestamp > NOW() - INTERVAL '7 days'
       ORDER BY timestamp DESC`,
      [studentPhone]
    );

    if (recentMessages.length < 5) return 0.3;

    let lateNightCount = 0;
    let gapVariance = 0;
    let lastTimestamp: Date | null = null;

    for (const msg of recentMessages) {
      const hour = new Date(msg.timestamp).getHours();
      if (hour < 6 || hour > 23) lateNightCount++;

      if (lastTimestamp) {
        const gap = (lastTimestamp.getTime() - new Date(msg.timestamp).getTime()) / 3600000;
        gapVariance += Math.pow(gap - 24, 2); // Variance from 24h cycle
      }
      lastTimestamp = new Date(msg.timestamp);
    }

    const lateNightRatio = lateNightCount / recentMessages.length;
    const irregularity = Math.sqrt(gapVariance / recentMessages.length) / 24;

    // Late night messaging + irregular schedule = burnout risk
    const risk = Math.min(0.3 + lateNightRatio * 0.4 + irregularity * 0.3, 0.95);
    return risk;
  }

  // ============================================================
  // HELPERS
  // ============================================================
  private runningAverage(current: number | undefined, newValue: number): number {
    if (current === undefined) return newValue;
    return current * 0.7 + newValue * 0.3; // Exponential moving average
  }

  private detectChronotype(responseTimes: Record<number, number>, engagements: Record<number, number>): string {
    const hours = Object.keys(responseTimes).map(Number);
    if (hours.length < 3) return 'unknown';

    const morningHours = hours.filter(h => h >= 5 && h < 12);
    const eveningHours = hours.filter(h => h >= 18 && h < 24);

    const morningSpeed = morningHours.reduce((sum, h) => sum + (responseTimes[h] || 9999), 0) / Math.max(morningHours.length, 1);
    const eveningSpeed = eveningHours.reduce((sum, h) => sum + (responseTimes[h] || 9999), 0) / Math.max(eveningHours.length, 1);

    if (morningSpeed < eveningSpeed * 0.7) return 'lark';
    if (eveningSpeed < morningSpeed * 0.7) return 'owl';
    return 'neutral';
  }

  private findMinHour(values: Record<number, number>): number {
    let minHour = 10;
    let minValue = Infinity;
    for (const [hour, value] of Object.entries(values)) {
      if (value < minValue) {
        minValue = value;
        minHour = parseInt(hour);
      }
    }
    return minHour;
  }

  private findMaxHour(values: Record<number, number>): number {
    let maxHour = 14;
    let maxValue = -Infinity;
    for (const [hour, value] of Object.entries(values)) {
      if (value > maxValue) {
        maxValue = value;
        maxHour = parseInt(hour);
      }
    }
    return maxHour;
  }
}

export const circadianEngine = new CircadianEngine();
