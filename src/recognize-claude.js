'use strict';
/*
 * Order by photo on the Node server: sends the photo and the company's catalogue
 * to Claude and returns the parsed JSON answer (checked afterwards by
 * shared/recognize.js). Credentials come from the environment the usual way
 * (ANTHROPIC_API_KEY, or another credential the SDK finds).
 */
const { Anthropic } = require('@anthropic-ai/sdk');
const { HttpError } = require('./http');
const { SCHEMA } = require('../shared/recognize');

const MODEL = process.env.MAA_VISION_MODEL || 'claude-opus-5-5';

function createRecognizer() {
  let client;
  return async function recognize({ prompt, mime, b64 }) {
    client ||= new Anthropic();
    let response;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // If the model declines, the API retries on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text', text: prompt },
          ],
        }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new HttpError(503, 'Photo ordering is not set up on this server', { code: 'recognition_unavailable' });
      }
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(503, 'Photo reading is busy. Try again in a minute.', { code: 'recognition_busy' });
      if (err instanceof Anthropic.BadRequestError) throw new HttpError(400, 'This photo could not be read. Try a clearer photo.', { code: 'recognition_failed' });
      if (err instanceof Anthropic.APIError) throw new HttpError(502, 'Photo reading failed. Try again.', { code: 'recognition_failed' });
      // No credentials at all: the SDK refuses before sending anything.
      if (/api key|apiKey|authToken|credential/i.test(String(err?.message))) {
        throw new HttpError(503, 'Photo ordering is not set up on this server', { code: 'recognition_unavailable' });
      }
      throw err;
    }
    if (response.stop_reason === 'refusal') throw new HttpError(422, 'This photo could not be read. Try a clearer photo.', { code: 'recognition_failed' });
    const text = response.content.find((b) => b.type === 'text')?.text;
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(502, 'Photo reading failed. Try again.', { code: 'recognition_failed' });
    }
  };
}

module.exports = { createRecognizer };
