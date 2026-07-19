/**
 * Edge TTS for the relay: turn a call turn's text into speech on the laptop,
 * so the phones never need internet themselves.
 *
 * Microsoft's free websocket endpoint refuses the RIFF output formats in
 * practice (the stream closes before turn.end), so we take what it does
 * serve - 24 kHz mono MP3 - and transcode with the bundled ffmpeg to the one
 * format both expo-audio and whisper.cpp are happy with: 16 kHz 16-bit mono
 * WAV. Phones always receive that WAV; they never see the MP3.
 */

import { spawn } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpegPath from 'ffmpeg-static';

/** Distinct voice per lane so the two agents are tellable apart on speaker. */
const VOICES: Record<string, string> = {
  a: process.env.TTS_VOICE_A ?? 'en-US-GuyNeural',
  b: process.env.TTS_VOICE_B ?? 'en-US-JennyNeural',
};

export function voiceForLane(lane: string): string {
  return VOICES[lane] ?? VOICES.a!;
}

/** One synthesis over a fresh websocket; the connection is not reusable. */
async function synthesizeMp3(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(text);
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) chunks.push(chunk as Buffer);
  const buf = Buffer.concat(chunks);
  if (buf.length === 0) throw new Error('edge-tts returned no audio');
  return buf;
}

/** MP3 bytes in, 16 kHz 16-bit mono WAV bytes out, no temp files. */
function transcodeToWav16k(mp3: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath as unknown as string, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-ar', '16000', '-ac', '1',
      '-f', 'wav', 'pipe:1',
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.stderr.on('data', (d) => err.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString().trim()}`));
    });
    ff.stdin.on('error', () => {}); // ffmpeg may close stdin first on bad input
    ff.stdin.end(mp3);
  });
}

/**
 * Synthesize a spoken turn as 16 kHz mono WAV. One retry, because Edge TTS is
 * an unofficial endpoint that sometimes drops a connection; a second failure
 * is the caller's problem (it degrades the turn to text-only).
 */
export async function speakTurn(text: string, lane: string): Promise<Buffer> {
  const voice = voiceForLane(lane);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const mp3 = await synthesizeMp3(text, voice);
      return await transcodeToWav16k(mp3);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
