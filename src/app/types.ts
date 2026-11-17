/**
 * Video Moderation Types
 */

export type ModerationState = 'success' | 'warning' | 'failed';

export interface ModerationCheckResult {
  name: string;
  description: string;
  state: ModerationState;
}

/** An image the moderation service can fetch, or text. */
export type ModerationContent =
  { kind: 'image'; url: string } | { kind: 'text'; text: string };

/** One sampled frame of a video and the score of each category in it. */
export interface ModerationFrame {
  /**
   * Seconds from the start of the source file. This is source time: it
   * ignores the trim, the playback speed and the clip's place on the timeline.
   */
  position: number;
  /** A score between 0 and 1 for each category. */
  scores: Record<string, number>;
}

export interface ModerationBlock {
  blockId: number;
  blockType: string;
  blockName: string | null;
  /** The heading the sidebar shows for the block. */
  label: string;
}

/** A part of a clip, in seconds from the clip's start on the timeline. */
export interface TimeRange {
  start: number;
  end: number;
}

export interface ModerationResult
  extends ModerationCheckResult, ModerationBlock {
  /**
   * Where the category is flagged in a video clip. Empty for an image or a
   * text, and when the state is `success`.
   */
  flaggedRanges: TimeRange[];
}

/** A block whose check failed. */
export interface UncheckedBlock extends ModerationBlock {
  /** Why the check failed, as the sidebar shows it. */
  reason: string;
}

export interface ModerationReport {
  /** One result per category the service scored, for each checked block. */
  results: ModerationResult[];
  /** Blocks whose check failed, so the video is not confirmed clean. */
  unchecked: UncheckedBlock[];
  /** The account ran out of credits during the check. */
  outOfCredits: boolean;
}
