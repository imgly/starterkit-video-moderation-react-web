/**
 * Moderation Result Item Components
 *
 * `ResultItem` displays a single moderation result with:
 * - Status indicator dot
 * - Category name, and the clip, image or text it was found in
 * - The flagged times, each of which moves the playhead there
 * - Info icon with tooltip
 * - Select button, which moves the playhead to the first flagged time
 *
 * `UncheckedItem` displays a block whose check failed, and why.
 */

import { useState } from 'react';

import type { ModerationResult, UncheckedBlock } from '../../types';
import { formatTime } from '../../utils';
import { Tooltip } from './Tooltip';
import { DEMO_ASSETS_BASE_URL } from '../../../imgly/demo-assets';

interface ResultItemProps {
  result: ModerationResult;
  onSelect: (blockId: number, clipTime?: number) => void;
}

export function ResultItem({ result, onSelect }: ResultItemProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [referenceElement, setReferenceElement] =
    useState<HTMLSpanElement | null>(null);

  return (
    <div className="moderation-item" data-block-id={result.blockId}>
      <span className="moderation-item-name-wrapper">
        <span
          className={`moderation-status-dot moderation-status-dot--${result.state}`}
        />
        <span className="moderation-item-text">
          <span className="moderation-item-name">{result.name}</span>
          <span className="moderation-item-block">{result.label}</span>
          {result.flaggedRanges.length > 0 && (
            <span className="moderation-item-ranges">
              {result.flaggedRanges.map((range) => (
                <button
                  key={range.start}
                  className="moderation-range-btn"
                  onClick={() => onSelect(result.blockId, range.start)}
                >
                  {formatTime(range.start)}–{formatTime(range.end)}
                </button>
              ))}
            </span>
          )}
        </span>
        <span
          ref={setReferenceElement}
          className="moderation-info-icon"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <img
            src={`${DEMO_ASSETS_BASE_URL}/assets/icons/info.svg`}
            alt="Info"
            width="16"
            height="16"
          />
        </span>
        {showTooltip && referenceElement && (
          <Tooltip result={result} referenceElement={referenceElement} />
        )}
      </span>
      <button
        className="moderation-select-btn"
        onClick={() =>
          onSelect(result.blockId, result.flaggedRanges[0]?.start ?? 0)
        }
      >
        Select
      </button>
    </div>
  );
}

interface UncheckedItemProps {
  block: UncheckedBlock;
  onSelect: (blockId: number) => void;
}

export function UncheckedItem({ block, onSelect }: UncheckedItemProps) {
  return (
    <div className="moderation-item" data-block-id={block.blockId}>
      <span className="moderation-item-name-wrapper">
        <span className="moderation-status-dot moderation-status-dot--unchecked" />
        <span className="moderation-item-text">
          <span className="moderation-item-name">Could not be checked</span>
          <span className="moderation-item-block">{block.label}</span>
          <span className="moderation-item-reason">{block.reason}</span>
        </span>
      </span>
      <button
        className="moderation-select-btn"
        onClick={() => onSelect(block.blockId)}
      >
        Select
      </button>
    </div>
  );
}
