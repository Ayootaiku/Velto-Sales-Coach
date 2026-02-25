/**
 * Turn Manager - Anti-Spam and Turn Detection
 * Prevents duplicate coaching cards and manages single-flight generation
 */

import type { TranscriptTurn } from './salescoach-ai';

export interface TurnDetectionResult {
    shouldGenerate: boolean;
    reason: string;
}

/**
 * Turn Manager for intelligent coaching card generation
 */
export class TurnManager {
    private lastFinalTranscript: string = '';
    private lastFinalTimestamp: number = 0;
    private isGenerating: boolean = false;
    private pendingTurns: TranscriptTurn[] | null = null;
    private currentAbortController: AbortController | null = null;
    private similarityThreshold: number = 1.0; // Disabled - allow all transcripts
    private minTimeBetweenTurns: number = 0; // No delay - immediate coaching
    private abortController: AbortController | null = null;

    /**
     * Check if we should generate a coaching card for this transcript
     */
    shouldGenerateCard(
        transcript: TranscriptTurn,
        isFinal: boolean
    ): TurnDetectionResult {
        
        // Only generate on final transcripts
        if (!isFinal) {
            return {
                shouldGenerate: false,
                reason: 'Not a final transcript',
            };
        }

        // Skip empty or very short transcripts
        if (!transcript.text || transcript.text.trim().length < 2) {
            return {
                shouldGenerate: false,
                reason: 'Transcript too short',
            };
        }

        // Rate limiting: prevent too frequent generations
        const now = Date.now();
        
        // If timestamp is 0 (initial state) or very old, treat as first turn
        const isFirstTurn = this.lastFinalTimestamp === 0;
        const timeSinceLast = isFirstTurn ? Infinity : now - this.lastFinalTimestamp;
        
        
        if (!isFirstTurn && timeSinceLast < this.minTimeBetweenTurns) {
            return {
                shouldGenerate: false,
                reason: 'Too soon after previous turn',
            };
        }

        // Single-flight: only one generation at a time
        if (this.isGenerating) {
            // Queue this for later
            this.pendingTurns = [transcript];
            this.currentAbortController?.abort();
            return {
                shouldGenerate: false,
                reason: 'Generation already in progress (queued for next)',
            };
        }

        // All checks passed
        this.lastFinalTranscript = transcript.text;
        this.lastFinalTimestamp = now;
        return {
            shouldGenerate: true,
            reason: 'Ready to generate',
        };
    }

    /**
     * Mark generation as started
     */
    startGeneration(abortController?: AbortController): void {
        // Cancel any pending generation first (single-flight)
        this.cancelPending();
        this.isGenerating = true;
        this.currentAbortController = abortController || null;
    }

    /**
     * Cancel any in-flight generation
     */
    cancelPending(): void {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }
        this.pendingTurns = null;
    }

    /**
     * Mark generation as complete and check for pending
     */
    completeGeneration(): TranscriptTurn[] | null {
        
        this.isGenerating = false;
        this.currentAbortController = null;

        const pending = this.pendingTurns;
        this.pendingTurns = null;
        
        // Reset for next turn - allow immediate next coaching
        // Don't reset timestamp here - it should be set when a new turn is checked
        
        
        return pending;
    }

    /**
     * Check if two transcripts are similar (fuzzy matching)
     */
    private isSimilar(text1: string, text2: string): boolean {
        if (!text1 || !text2) return false;
        
        // Only check similarity if both texts are substantial (>10 chars)
        // Short phrases like "yes", "no", "ok" should not be blocked
        if (text1.length < 10 || text2.length < 10) {
            return text1.toLowerCase().trim() === text2.toLowerCase().trim();
        }

        const normalized1 = this.normalizeText(text1);
        const normalized2 = this.normalizeText(text2);

        // Exact match
        if (normalized1 === normalized2) return true;

        // Levenshtein distance for fuzzy matching
        const similarity = this.calculateSimilarity(normalized1, normalized2);
        return similarity >= this.similarityThreshold;
    }

    /**
     * Normalize text for comparison
     */
    private normalizeText(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    /**
     * Calculate similarity ratio between two strings (0-1)
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private levenshteinDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1 // deletion
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Reset the turn manager (e.g., when starting a new call)
     */
    reset(): void {
        this.lastFinalTranscript = '';
        this.lastFinalTimestamp = 0;
        this.isGenerating = false;
        this.pendingTurns = null;
        this.currentAbortController?.abort();
        this.currentAbortController = null;
    }

    /**
     * Get current state (for debugging)
     */
    getState(): {
        isGenerating: boolean;
        hasPending: boolean;
        lastTranscript: string;
    } {
        return {
            isGenerating: this.isGenerating,
            hasPending: this.pendingTurns !== null,
            lastTranscript: this.lastFinalTranscript,
        };
    }
}

/**
 * Create a new turn manager instance
 */
export function createTurnManager(): TurnManager {
    return new TurnManager();
}
