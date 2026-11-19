/**
 * CE.SDK Engine Utilities
 */

import type { CreativeEngine } from '@cesdk/cesdk-js';

import type { ModerationState } from './types';

/**
 * Converts a confidence percentage to a moderation state.
 */
export function percentageToState(percentage: number): ModerationState {
  if (percentage > 0.8) {
    return 'failed';
  } else if (percentage > 0.4) {
    return 'warning';
  } else {
    return 'success';
  }
}

/**
 * Gets the image URL from a block's fill.
 */
export function getImageUrl(
  engine: CreativeEngine,
  blockId: number
): string | null {
  const imageFill = engine.block.getFill(blockId);
  const fillImageURI = engine.block.getString(
    imageFill,
    'fill/image/imageFileURI'
  );
  if (fillImageURI) {
    return fillImageURI;
  }

  // Check source set
  const sourceSet = engine.block.getSourceSet(
    imageFill,
    'fill/image/sourceSet'
  );
  if (sourceSet && sourceSet.length) {
    return sourceSet[0].uri;
  }
  return null;
}

/** Formats seconds as `m:ss`, the way the timeline shows them. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The time at which a block starts on its page. A time offset is relative to
 * the parent, so a clip inside a track adds the track's offset.
 */
export function pageTimeOffsetOf(
  engine: CreativeEngine,
  blockId: number
): number {
  let offset = 0;
  let current: number | null = blockId;
  while (
    current != null &&
    engine.block.getType(current) !== '//ly.img.ubq/page'
  ) {
    offset += engine.block.getTimeOffset(current);
    current = engine.block.getParent(current);
  }
  return offset;
}

/**
 * Selects the block and moves the playhead to `clipTime` seconds after its
 * start. The sidebar stays open while the user edits, so the block may be
 * gone by the time its row is clicked. A destroyed block is skipped.
 */
export function selectAt(
  engine: CreativeEngine,
  blockId: number,
  clipTime = 0
): void {
  if (!engine.block.isValid(blockId)) return;
  if (engine.block.isAllowedByScope(blockId, 'editor/select')) {
    engine.block.select(blockId);
  }
  const page = engine.scene.getCurrentPage();
  if (page == null) return;
  engine.block.setPlaybackTime(
    page,
    pageTimeOffsetOf(engine, blockId) + clipTime
  );
}
