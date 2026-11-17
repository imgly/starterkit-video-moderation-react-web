/**
 * Video Moderation
 *
 * Checks every video clip, image and text in the scene with the IMG.LY
 * Gateway (see `gateway.ts`). For a video, the service scores sampled frames
 * of the whole source file. Each clip keeps only the frames inside the part
 * that plays, so content the user trimmed away does not flag the clip.
 */

import type { CreativeEngine } from '@cesdk/cesdk-js';

import { detect, detectVideo, GatewayError, upload } from './gateway';
import { getImageUrl, pageTimeOffsetOf, percentageToState } from './utils';
import type {
  ModerationBlock,
  ModerationCheckResult,
  ModerationContent,
  ModerationFrame,
  ModerationReport,
  ModerationResult,
  ModerationState,
  TimeRange,
  UncheckedBlock
} from './types';

interface Category {
  id: string;
  name: string;
  description: string;
}

/**
 * The categories the detection model reports, in the order the sidebar lists
 * them. The image and text sets do not overlap, so one table covers both.
 * A video frame is scored like an image.
 */
const CATEGORIES: Category[] = [
  {
    id: 'nudity',
    name: 'Nudity',
    description: 'Raw or partial nudity, sexual acts, and suggestive content.'
  },
  {
    id: 'weapon',
    name: 'Weapons',
    description: 'Handguns, rifles, machine guns, threatening knives...'
  },
  {
    id: 'recreational_drug',
    name: 'Recreational Drugs',
    description: 'Cannabis and other recreational drugs.'
  },
  {
    id: 'medical',
    name: 'Medical',
    description: 'Pills, syringes, medical devices, and other medical imagery.'
  },
  {
    id: 'alcohol',
    name: 'Alcohol',
    description: 'Wine, beer, cocktails, champagne...'
  },
  {
    id: 'offensive',
    name: 'Offensive Symbols',
    description: 'Hate symbols, extremist imagery, and offensive gestures.'
  },
  {
    id: 'gore',
    name: 'Gore',
    description: 'Blood, wounds, corpses, and other graphic imagery.'
  },
  {
    id: 'toxic',
    name: 'Toxic Language',
    description: 'Language likely to make someone leave the conversation.'
  },
  {
    id: 'insulting',
    name: 'Insulting Language',
    description: 'Insults, name-calling, and demeaning remarks.'
  },
  {
    id: 'discriminatory',
    name: 'Discriminatory Language',
    description: 'Language that demeans a group or protected characteristic.'
  },
  {
    id: 'violent',
    name: 'Violent Language',
    description: 'Threats of violence and calls to harm someone.'
  },
  {
    id: 'sexual',
    name: 'Sexual Language',
    description: 'Sexually explicit or suggestive wording.'
  },
  {
    id: 'self-harm',
    name: 'Self-Harm',
    description: 'References to suicide, self-injury, or eating disorders.'
  }
];

const VIDEO_FILL_TYPE = '//ly.img.ubq/fill/video';
const IMAGE_FILL_TYPE = '//ly.img.ubq/fill/image';
/** Used when a local file does not name its type. */
const DEFAULT_VIDEO_TYPE = 'video/mp4';
const MAX_CONCURRENT_REQUESTS = 4;
const RENDER_TARGET_SIZE = 1024;
const RENDER_QUALITY = 0.85;
const MAX_QUOTED_TEXT = 40;

const STATE_RANK: Record<ModerationState, number> = {
  success: 0,
  warning: 1,
  failed: 2
};

/**
 * Maps the scores of one frame to results. Every scored category is
 * reported, so one the model adds later is named from its id, not dropped.
 */
export function toCheckResults(
  scores: Record<string, number>
): (ModerationCheckResult & { id: string })[] {
  const known = CATEGORIES.filter(({ id }) => id in scores);
  const unknown = Object.keys(scores)
    .filter((id) => !CATEGORIES.some((category) => category.id === id))
    .sort()
    .map((id) => ({
      id,
      name: id
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
      description: 'Reported by the moderation service.'
    }));
  return [...known, ...unknown].map(({ id, name, description }) => ({
    id,
    name,
    description,
    state: percentageToState(scores[id])
  }));
}

/** A video clip on the timeline, with the part of its source file that plays. */
export interface Clip {
  block: ModerationBlock;
  uri: string;
  /** The source seconds the clip shows. */
  played: TimeRange;
  /** One second of the clip shows `speed` source seconds. */
  speed: number;
  /** Why the clip's file could not load. Such a clip is reported as unchecked. */
  loadError?: unknown;
}

/**
 * Hosts the gateway cannot reach: loopback, private and link-local IPv4 and
 * IPv6 addresses, shared address space, names without a dot, and local
 * domains.
 */
const PRIVATE_HOST =
  /^(localhost|0\.0\.0\.0|127\.[\d.]+|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+|169\.254\.[\d.]+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.[\d.]+|\[(::1?|::ffff:.*|f[cd].*|fe[89ab].*)\]|[^.[]+)$|\.(localhost|local|lan|internal|home\.arpa)$/;

/**
 * The gateway fetches an image or a video itself, so it needs a public URL.
 * A `blob:` or `buffer:` upload, or a file served from this machine or the
 * local network, is uploaded instead.
 */
export function isPublicUrl(uri: string): boolean {
  try {
    const { protocol, hostname } = new URL(uri);
    return (
      (protocol === 'https:' || protocol === 'http:') &&
      // A trailing dot names the same host.
      !PRIVATE_HOST.test(hostname.replace(/\.$/, ''))
    );
  } catch {
    return false;
  }
}

/**
 * Finds every graphic block with a video fill, in the order they start on
 * the page. The trim getters need the loaded resource, so each fill is
 * loaded first.
 */
export async function findClips(engine: CreativeEngine): Promise<Clip[]> {
  const clips: Clip[] = [];
  // `findByType` does not return blocks in timeline order, so the clips are
  // sorted before they are numbered.
  const blocks = engine.block
    .findByType('graphic')
    .map((blockId) => ({ blockId, start: pageTimeOffsetOf(engine, blockId) }))
    .sort((a, b) => a.start - b.start)
    .map(({ blockId }) => blockId);
  for (const blockId of blocks) {
    if (!engine.block.supportsFill(blockId)) continue;
    const fill = engine.block.getFill(blockId);
    if (engine.block.getType(fill) !== VIDEO_FILL_TYPE) continue;
    const uri = engine.block.getString(fill, 'fill/video/fileURI');
    if (uri.length === 0) continue;

    const name = engine.block.getName(blockId);
    const block = {
      blockId,
      blockType: engine.block.getType(blockId),
      blockName: name,
      // Clips are unnamed by default, so the number tells them apart.
      label: name || `Video clip ${clips.length + 1}`
    };
    try {
      await engine.block.forceLoadAVResource(fill);
      // Trim offset and length are timeline seconds, so playing at speed 2
      // covers twice the source.
      const speed = engine.block.getPlaybackSpeed(fill);
      const trimOffset = engine.block.getTrimOffset(fill);
      const duration = engine.block.getDuration(blockId);
      const trimLength = engine.block.getTrimLength(fill);
      const length = trimLength > 0 ? Math.min(trimLength, duration) : duration;
      clips.push({
        block,
        uri,
        played: {
          start: trimOffset * speed,
          end: (trimOffset + length) * speed
        },
        speed
      });
    } catch (loadError) {
      // One file that cannot load must not end the check for every block.
      clips.push({
        block,
        uri,
        played: { start: 0, end: 0 },
        speed: 1,
        loadError
      });
    }
  }
  return clips;
}

/** Joins ranges that touch, so flagged frames in a row read as one range. */
function mergeAdjacent(ranges: TimeRange[]): TimeRange[] {
  const merged: TimeRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last != null && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * Keeps the frames that cover the played part of the clip, and reports, per
 * category, the worst state among them and the parts of the clip where it is
 * flagged.
 *
 * A frame stands for the time from its position to the next frame's
 * position, so a clip shorter than the sampling interval still gets the frame
 * that covers it. The interval is not assumed to be fixed.
 */
export function resultsOf(
  clip: Clip,
  frames: ModerationFrame[]
): ModerationResult[] {
  const sorted = [...frames].sort((a, b) => a.position - b.position);
  const covering = sorted.flatMap((frame, index) => {
    const coverEnd = sorted[index + 1]?.position ?? Infinity;
    const start = Math.max(frame.position, clip.played.start);
    const end = Math.min(coverEnd, clip.played.end);
    return start < end ? [{ range: { start, end }, frame }] : [];
  });
  const toClipTime = (sourceTime: number) =>
    (sourceTime - clip.played.start) / clip.speed;

  const byCategory = new Map<
    string,
    { worst: ModerationCheckResult; flagged: TimeRange[] }
  >();
  for (const { range, frame } of covering) {
    for (const { id, ...result } of toCheckResults(frame.scores)) {
      const entry = byCategory.get(id) ?? { worst: result, flagged: [] };
      if (STATE_RANK[result.state] > STATE_RANK[entry.worst.state]) {
        entry.worst = result;
      }
      if (result.state !== 'success') entry.flagged.push(range);
      byCategory.set(id, entry);
    }
  }

  return [...byCategory.values()].map(({ worst, flagged }) => ({
    ...worst,
    ...clip.block,
    flaggedRanges: mergeAdjacent(flagged).map(({ start, end }) => ({
      start: toClipTime(start),
      end: toClipTime(end)
    }))
  }));
}

/**
 * The URL the gateway reads the video from, after an upload if needed. A
 * browser cannot fetch a `buffer:` URI, so such a clip is reported as
 * unchecked.
 */
async function videoUrlOf(uri: string): Promise<string> {
  if (isPublicUrl(uri)) return uri;
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`The video could not be read (HTTP ${response.status}).`);
  }
  const video = await response.blob();
  return upload(
    video.type.startsWith('video/')
      ? video
      : new Blob([video], { type: DEFAULT_VIDEO_TYPE })
  );
}

/** An image or a text block, with its content resolved when it is sent. */
interface StillTarget {
  block: ModerationBlock;
  /** Resolves the content lazily, so an upload counts toward the cap. */
  content: () => Promise<ModerationContent>;
}

function describeBlock(
  engine: CreativeEngine,
  blockId: number,
  label: string
): ModerationBlock {
  return {
    blockId,
    blockType: engine.block.getType(blockId),
    blockName: engine.block.getName(blockId),
    label
  };
}

/**
 * Every graphic with an image fill, whatever its kind, so a sticker or a
 * clip whose fill was replaced with an image is checked too.
 */
function imageTargets(engine: CreativeEngine): StillTarget[] {
  return engine.block.findByType('graphic').flatMap((blockId) => {
    if (!engine.block.supportsFill(blockId)) return [];
    if (
      engine.block.getType(engine.block.getFill(blockId)) !== IMAGE_FILL_TYPE
    ) {
      return [];
    }
    const url = getImageUrl(engine, blockId);
    if (!url) return [];
    const block = describeBlock(
      engine,
      blockId,
      engine.block.getName(blockId) || 'Image'
    );
    if (isPublicUrl(url)) {
      return [{ block, content: async () => ({ kind: 'image', url }) }];
    }
    return [
      {
        block,
        content: async () => {
          // JPEG keeps the upload small. The engine renders the block large
          // enough to fill the target size, so a small block is scaled up.
          const rendered = await engine.block.export(blockId, {
            mimeType: 'image/jpeg',
            jpegQuality: RENDER_QUALITY,
            targetWidth: RENDER_TARGET_SIZE,
            targetHeight: RENDER_TARGET_SIZE
          });
          return { kind: 'image', url: await upload(rendered) };
        }
      }
    ];
  });
}

/** Text blocks and captions. Blank text is skipped: there is nothing to classify. */
function textTargets(engine: CreativeEngine): StillTarget[] {
  return [
    ...textsOf(engine, 'text', 'text/text'),
    ...textsOf(engine, 'caption', 'caption/text')
  ];
}

function textsOf(
  engine: CreativeEngine,
  type: 'text' | 'caption',
  property: 'text/text' | 'caption/text'
): StillTarget[] {
  return engine.block.findByType(type).flatMap((blockId) => {
    const text = engine.block.getString(blockId, property);
    if (text.trim().length === 0) return [];
    // A text block's name defaults to "Text", so the words identify it.
    const quoted = text.slice(0, MAX_QUOTED_TEXT).trim();
    const label = `"${quoted}${text.length > MAX_QUOTED_TEXT ? '…' : ''}"`;
    return [
      {
        block: describeBlock(engine, blockId, label),
        content: async () => ({ kind: 'text', text })
      }
    ];
  });
}

/**
 * Runs `tasks` with at most `limit` in flight, keeping their order. After a
 * task fails with a reason that `stop` accepts, no further task starts, and
 * each one not started is rejected with that reason.
 */
async function settleWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  stop: (reason: unknown) => boolean
): Promise<PromiseSettledResult<T>[]> {
  const settled: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  let stopped: { reason: unknown } | undefined;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      if (stopped) {
        settled[index] = { status: 'rejected', reason: stopped.reason };
        continue;
      }
      try {
        settled[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        settled[index] = { status: 'rejected', reason };
        if (stop(reason)) stopped ??= { reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker)
  );
  return settled;
}

function reasonOf(reason: unknown): string {
  return reason instanceof Error && reason.message.length > 0
    ? reason.message
    : 'The moderation check failed.';
}

function isOutOfCredits(reason: unknown): boolean {
  return reason instanceof GatewayError && reason.isOutOfCredits;
}

/**
 * Checks every video clip, image and text in the scene. A block whose check
 * fails is reported as unchecked. When every check fails, the error is
 * thrown, and an out-of-credits error wins over any other. Once the account
 * is out of credits, nothing further is sent.
 *
 * @param frameCache - The frames already returned for each video source
 * URI. A trim, a split or a move changes only which frames count, so a check
 * after such an edit sends no video again. New results are added to it.
 */
export async function moderateScene(
  engine: CreativeEngine,
  frameCache: Map<string, ModerationFrame[]>
): Promise<ModerationReport> {
  const clips = await findClips(engine);
  const stills = [...imageTargets(engine), ...textTargets(engine)];

  // A scene with many text blocks would otherwise open one request per block
  // at once and be rate-limited.
  const stillOutcomes = await settleWithLimit(
    stills.map(
      (target) => async () =>
        toCheckResults(await detect(await target.content()))
    ),
    MAX_CONCURRENT_REQUESTS,
    isOutOfCredits
  );
  const stillFailure = stillOutcomes.find(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === 'rejected' && isOutOfCredits(outcome.reason)
  );

  // The gateway answers a second video request that overlaps the first with
  // "busy", so the files are sent one at a time, after the images and texts.
  const videoOutcomes = new Map<
    string,
    PromiseSettledResult<ModerationFrame[]>
  >();
  let stopped: { reason: unknown } | undefined = stillFailure;
  const loaded = clips.filter((clip) => clip.loadError === undefined);
  for (const uri of new Set(loaded.map((clip) => clip.uri))) {
    const cached = frameCache.get(uri);
    if (cached != null) {
      videoOutcomes.set(uri, { status: 'fulfilled', value: cached });
      continue;
    }
    if (stopped) {
      videoOutcomes.set(uri, { status: 'rejected', reason: stopped.reason });
      continue;
    }
    try {
      const frames = await detectVideo(await videoUrlOf(uri));
      frameCache.set(uri, frames);
      videoOutcomes.set(uri, { status: 'fulfilled', value: frames });
    } catch (reason) {
      videoOutcomes.set(uri, { status: 'rejected', reason });
      if (isOutOfCredits(reason)) stopped = { reason };
    }
  }

  const clipOutcome = (clip: Clip): PromiseSettledResult<ModerationFrame[]> =>
    clip.loadError === undefined
      ? videoOutcomes.get(clip.uri)!
      : { status: 'rejected', reason: clip.loadError };
  const outcomes = [
    ...videoOutcomes.values(),
    ...clips.filter((clip) => clip.loadError !== undefined).map(clipOutcome),
    ...stillOutcomes
  ];
  const failures = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
  );
  if (outcomes.length > 0 && failures.length === outcomes.length) {
    throw (
      failures.find((failure) => isOutOfCredits(failure.reason)) ?? failures[0]
    ).reason;
  }

  const clipResults = clips.flatMap((clip) => {
    const outcome = clipOutcome(clip);
    return outcome.status === 'fulfilled' ? resultsOf(clip, outcome.value) : [];
  });
  const stillResults = stillOutcomes.flatMap((outcome, index) =>
    outcome.status === 'fulfilled'
      ? outcome.value.map(({ id: _id, ...result }) => ({
          ...result,
          ...stills[index].block,
          flaggedRanges: []
        }))
      : []
  );
  return {
    outOfCredits: failures.some((failure) => isOutOfCredits(failure.reason)),
    results: [...clipResults, ...stillResults],
    unchecked: [
      ...clips.flatMap((clip): UncheckedBlock[] => {
        const outcome = clipOutcome(clip);
        return outcome.status === 'rejected'
          ? [{ ...clip.block, reason: reasonOf(outcome.reason) }]
          : [];
      }),
      ...stills.flatMap((target, index): UncheckedBlock[] => {
        const outcome = stillOutcomes[index];
        return outcome.status === 'rejected'
          ? [{ ...target.block, reason: reasonOf(outcome.reason) }]
          : [];
      })
    ]
  };
}
