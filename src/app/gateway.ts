/**
 * IMG.LY Gateway client for the `imgly/detection` moderation model.
 *
 * Plain `fetch`, so the kit needs no AI plugin. To use another moderation
 * service, replace `detect`, `detectVideo` and `upload`. `detect` returns a
 * score between 0 and 1 for each category of an image or a text.
 * `detectVideo` returns the sampled frames of a whole video file, each with
 * such scores.
 * The key check in `App.tsx` and the
 * out-of-credits dialog also assume the IMG.LY Gateway.
 */

import {
  bearerFromTokenResult,
  getGatewayUrl,
  resolveAiToken
} from './ai-credentials';
import type { ModerationContent, ModerationFrame } from './types';

const DETECTION_MODEL = 'imgly/detection';
/** The gateway gives a frame's position in milliseconds. */
const MILLISECONDS_PER_SECOND = 1000;
/** The gateway scores a whole video before it answers, so a long clip takes a while. */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * A failed gateway request. `status` is 0 for a failure inside the stream.
 * `code` is the gateway's machine-readable reason, such as
 * `insufficient_credits`, when the error body carries one.
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'GatewayError';
  }

  /** The key is missing, expired, revoked or has no access to the model. */
  get isAuthenticationFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** The account has no credits left, so no check runs until it is topped up. */
  get isOutOfCredits(): boolean {
    return this.code === 'insufficient_credits' || this.status === 402;
  }
}

async function authorizedFetch(path: string, init: RequestInit) {
  const token = bearerFromTokenResult(await resolveAiToken());
  const response = await fetch(`${getGatewayUrl()}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    // The signal also ends a stream that stops sending, otherwise the check
    // never settles and the Validate button stays disabled.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw await errorFromResponse(response);
  return response;
}

/** Reads the gateway's `{ "error": { "code", "message" } }` body. */
async function errorFromResponse(response: Response): Promise<GatewayError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // The body is empty or not the documented shape, so the status decides.
  }
  return new GatewayError(
    errorMessageOf(payload) ??
      `The moderation request failed with HTTP ${response.status}.`,
    response.status,
    errorCodeOf(payload)
  );
}

function errorCodeOf(payload: unknown): string | undefined {
  const error = (payload as { error?: unknown } | null)?.error;
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessageOf(payload: unknown): string | undefined {
  const error = (payload as { error?: unknown } | null)?.error;
  const message =
    typeof error === 'string'
      ? error
      : (error as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' && message.length > 0
    ? message
    : undefined;
}

/**
 * Uploads an image or a video the gateway cannot fetch, such as a `blob:`
 * URL, and returns the URL the detection model reads it from.
 */
export async function upload(file: Blob): Promise<string> {
  const response = await authorizedFetch('/v1/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: file.type })
  });
  const { upload_url: uploadUrl, asset_url: assetUrl } =
    (await response.json()) as { upload_url?: string; asset_url?: string };
  if (!uploadUrl || !assetUrl) {
    throw new GatewayError('The moderation upload returned no URL.', 0);
  }

  // The presigned URL carries its own credentials, and it rejects a request
  // that also sends the gateway's bearer token.
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  // Not a GatewayError: a storage 403 means an expired upload URL, not a
  // rejected key.
  if (!put.ok) throw new Error(`The upload failed with HTTP ${put.status}.`);
  return assetUrl;
}

/** Runs the detection model on one input and returns its completed event. */
async function runDetection(input: Record<string, unknown>): Promise<unknown> {
  const response = await authorizedFetch('/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({ model: DETECTION_MODEL, ...input })
  });
  return readCompletedEvent(response);
}

/**
 * Runs the detection model on one image or text, and returns the score
 * between 0 and 1 of each category it reports.
 */
export async function detect(
  content: ModerationContent
): Promise<Record<string, number>> {
  const completed = await runDetection(
    content.kind === 'image'
      ? { image_urls: [content.url] }
      : { text: content.text }
  );
  const output = (completed as { output?: unknown[] } | null)?.output?.[0];
  return scoresOf(
    (output as { data?: { scores?: unknown } } | undefined)?.data?.scores
  );
}

/**
 * Runs the detection model on one video. The model samples the whole file
 * and returns the scores of each sampled frame.
 */
export async function detectVideo(
  videoUrl: string
): Promise<ModerationFrame[]> {
  return framesOf(await runDetection({ video_url: videoUrl }));
}

/**
 * Reads the server-sent events until the run completes. An event ends at a
 * blank line, so its fields can come in any order and its data can span
 * several lines. Progress events carry no result, so their data is skipped
 * without being parsed.
 */
async function readCompletedEvent(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new GatewayError('The moderation stream is empty.', 0);

  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    buffer += decoder.decode(chunk.value, { stream: !done });
    const lines = buffer.split('\n');
    // The last line can be incomplete until the next chunk arrives.
    buffer = done ? '' : (lines.pop() ?? '');
    // The end of the stream also ends its last event.
    if (done) lines.push('');

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice('data:'.length).trim());
      } else if (line === '') {
        const type = event;
        const payload = data.join('\n');
        event = '';
        data = [];
        if (type === 'generation.failed') {
          await reader.cancel();
          const parsed = payload === '' ? undefined : parseEventData(payload);
          throw new GatewayError(
            errorMessageOf(parsed) ?? 'The moderation check failed.',
            0,
            errorCodeOf(parsed)
          );
        }
        if (type !== 'generation.completed' || payload === '') continue;
        await reader.cancel();
        return parseEventData(payload);
      }
    }
  }
  throw new GatewayError('The moderation stream ended without a result.', 0);
}

function parseEventData(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new GatewayError(
      'The moderation service sent a malformed result.',
      0
    );
  }
}

/**
 * Takes the frames of the single output, so a malformed response fails the
 * check instead of reporting the video as clean. The gateway also reports a
 * `safe` flag and the highest score of each category over the whole file.
 * The kit ignores both, so that frames the user trimmed away do not count.
 */
function framesOf(completed: unknown): ModerationFrame[] {
  const output = (completed as { output?: unknown[] } | null)?.output?.[0];
  const frames = (output as { data?: { frames?: unknown } } | undefined)?.data
    ?.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new GatewayError('The moderation service returned no frames.', 0);
  }
  return frames.map((frame) => {
    const { position, scores } = (frame ?? {}) as {
      position?: unknown;
      scores?: unknown;
    };
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      throw new GatewayError(
        'The moderation service returned a frame without a position.',
        0
      );
    }
    return {
      position: position / MILLISECONDS_PER_SECOND,
      scores: scoresOf(scores)
    };
  });
}

function scoresOf(scores: unknown): Record<string, number> {
  if (scores == null || typeof scores !== 'object') {
    throw new GatewayError('The moderation service returned no scores.', 0);
  }
  const entries = Object.entries(scores);
  for (const [category, score] of entries) {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new GatewayError(
        `The moderation service returned no score for "${category}".`,
        0
      );
    }
  }
  if (entries.length === 0) {
    throw new GatewayError('The moderation service returned no scores.', 0);
  }
  return scores as Record<string, number>;
}
