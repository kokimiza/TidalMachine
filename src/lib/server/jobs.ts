import musicTheoryDoc from './knowledge/music-theory.md?raw';
import tidalReferenceDoc from './knowledge/tidal-reference.md?raw';
import type { TidalAgent } from './tidal-agent';

// Keep this in sync with the "Available sound banks" section of
// knowledge/tidal-reference.md — it's both what we tell Claude is safe to
// use and what we validate its output against.
const CURATED_SOUNDS = [
	'bd',
	'sn',
	'sd',
	'cp',
	'hh',
	'hc',
	'perc',
	'clubkick',
	'popkick',
	'tabla',
	'tabla2',
	'industrial',
	'bass',
	'bass1',
	'bass2',
	'jvbass',
	'bassdm',
	'moog',
	'feel',
	'feelfx',
	'glitch',
	'glitch2',
	'space',
	'bubble',
	'wind',
	'insect',
	'birds3',
	'arpy',
	'notes',
	'newnotes',
	'sitar',
	'casio',
	'koy',
	'peri',
	'stab',
	'diphone2',
	'speech',
	'speechless',
	'mouth',
	'click',
	'tink'
] as const;

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_RENDER_ATTEMPTS = 2;

export type ComposerInput = {
	mood: string;
	durationSeconds: number;
	bpm: number;
};

export type JobSummary = {
	id: string;
	mood: string;
	durationSeconds: number;
	bpm: number;
	code: string;
	codePath: string;
	audioPath: string;
	audioUrl: string;
	codeUrl: string;
	renderer: 'tidal-supercollider' | 'fallback-simulated';
	model: string;
	log: string[];
	peaks: number[];
	createdAt: string;
};

type JobRecord = JobSummary & {
	audio: Uint8Array;
};

type RuntimeEnv = {
	ANTHROPIC_API_KEY?: string;
	ANTHROPIC_MODEL?: string;
	TidalAgent?: DurableObjectNamespace<TidalAgent>;
};

const globalStore = globalThis as typeof globalThis & {
	__tidalJobs?: Map<string, JobRecord>;
	__tidalJobCounter?: number;
};

const jobs = (globalStore.__tidalJobs ??= new Map<string, JobRecord>());

export function getJob(id: string): JobRecord | undefined {
	return jobs.get(id);
}

export async function createJob(
	input: ComposerInput,
	runtimeEnv?: RuntimeEnv
): Promise<JobSummary> {
	const safeInput = normalizeInput(input);
	const id = nextJobId();
	const log: string[] = [
		`/jobs/${id} created`,
		`target: ${safeInput.durationSeconds}s at ${safeInput.bpm} BPM`
	];

	const { code: composedCode, model, note } = await composeTidalCode(safeInput, runtimeEnv);
	log.push(note);
	log.push(`/jobs/${id}/music.tidal written`);

	const rendered = await renderJob(id, composedCode, safeInput, runtimeEnv, log);

	const record: JobRecord = {
		id,
		mood: safeInput.mood,
		durationSeconds: safeInput.durationSeconds,
		bpm: safeInput.bpm,
		code: rendered.code,
		codePath: `/jobs/${id}/music.tidal`,
		audioPath: `/jobs/${id}/music.wav`,
		audioUrl: `/api/jobs/${id}/audio`,
		codeUrl: `/api/jobs/${id}/code`,
		renderer: rendered.renderer,
		model,
		log,
		peaks: rendered.peaks,
		audio: rendered.audio,
		createdAt: new Date().toISOString()
	};

	jobs.set(id, record);
	return summarize(record);
}

// --- Rendering: real TidalCycles/SuperCollider via the AI Computer, with a
// bounded retry (feeding the failure back to Claude) and a deterministic
// synth fallback so a job never hard-fails. ---

async function renderJob(
	id: string,
	initialCode: string,
	input: ComposerInput,
	runtimeEnv: RuntimeEnv | undefined,
	log: string[]
): Promise<{
	code: string;
	audio: Uint8Array;
	peaks: number[];
	renderer: JobSummary['renderer'];
}> {
	const agentBinding = runtimeEnv?.TidalAgent;
	if (!agentBinding) {
		log.push(
			'AI Computer unavailable (no TidalAgent binding — likely `vite dev` without wrangler, or Docker not running); using simulated renderer'
		);
		return { ...simulate(input), code: initialCode };
	}

	let code = initialCode;
	for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt += 1) {
		log.push(
			`tidal render attempt ${attempt}/${MAX_RENDER_ATTEMPTS}: booting AI Computer container`
		);

		try {
			const stub = agentBinding.get(agentBinding.idFromName(`${id}-${attempt}`));
			const mainHs = composeMainHs(code, input.durationSeconds);
			const result = await stub.render({ mainHs, durationSeconds: input.durationSeconds });

			if (result.ok) {
				log.push('SuperCollider render succeeded');
				log.push(...tailLines(result.log, 8));
				return {
					code,
					audio: result.wav,
					peaks: estimatePeaks(result.wav),
					renderer: 'tidal-supercollider'
				};
			}

			log.push(`tidal render attempt ${attempt} failed (exit code ${result.exitCode})`);
			log.push(...tailLines(result.log, 12));

			if (attempt < MAX_RENDER_ATTEMPTS) {
				const fixed = await requestFix(code, result.log, input, runtimeEnv);
				if (fixed) {
					log.push('asked Claude to fix the failing code for a retry');
					code = fixed;
				}
			}
		} catch (error) {
			log.push(
				`tidal render attempt ${attempt} threw: ${error instanceof Error ? error.message : 'unknown error'}`
			);
		}
	}

	log.push('falling back to simulated renderer after repeated failures');
	return { ...simulate(input), code };
}

function simulate(input: ComposerInput): {
	audio: Uint8Array;
	peaks: number[];
	renderer: JobSummary['renderer'];
} {
	const rendered = renderPreviewWav(input);
	return { audio: rendered.wav, peaks: rendered.peaks, renderer: 'fallback-simulated' };
}

function tailLines(text: string, count: number): string[] {
	return text
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.slice(-count);
}

// Wraps the AI-generated Tidal pattern (plain `d1 $ ...` / `setcps ...`
// lines, same shape as BootTidal.hs) in a standalone Haskell program that
// boots a real Tidal stream against SuperDirt, plays the pattern for
// durationSeconds, then exits. See container-src/render.sh and
// container-src/render-inner.sh for how this actually gets run.
function composeMainHs(code: string, durationSeconds: number): string {
	const body = indentForDoBlock(code);
	const micros = Math.max(1, Math.round(durationSeconds)) * 1_000_000;

	return `{-# LANGUAGE OverloadedStrings #-}
module Main where

import Sound.Tidal.Context
import Control.Concurrent (threadDelay)

main :: IO ()
main = do
  tidal <- startTidal
             (superdirtTarget { oLatency = 0.1, oAddress = "127.0.0.1", oPort = 57120 })
             (defaultConfig { cVerbose = False })
  let d1 = streamReplace tidal 1 . (|< orbit 0)
      d2 = streamReplace tidal 2 . (|< orbit 1)
      d3 = streamReplace tidal 3 . (|< orbit 2)
      d4 = streamReplace tidal 4 . (|< orbit 3)
      setcps c = streamOnce tidal (cps (pure c))
      hush = streamHush tidal

${body}

  threadDelay ${micros}
  hush
  threadDelay 200000
  writeFile "/tmp/render-stop" "done"
`;
}

function indentForDoBlock(code: string): string {
	return code
		.split('\n')
		.map((line) => (line.trim().length === 0 ? '' : `  ${line}`))
		.join('\n');
}

// Parses a standard RIFF/WAVE PCM16 file (what SuperCollider's `s.record`
// produces here — see boot.scd in render-inner.sh) into a 64-bucket peak
// array for the waveform display, matching renderPreviewWav's shape below.
function estimatePeaks(wav: Uint8Array, buckets = 64): number[] {
	const peaks = new Array<number>(buckets).fill(0);
	if (wav.byteLength < 12) return peaks;

	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	let channels = 2;
	let bitsPerSample = 16;
	let dataOffset = -1;
	let dataLength = 0;

	let offset = 12;
	while (offset + 8 <= wav.byteLength) {
		const id = String.fromCharCode(wav[offset], wav[offset + 1], wav[offset + 2], wav[offset + 3]);
		const size = view.getUint32(offset + 4, true);
		if (id === 'fmt ' && offset + 24 <= wav.byteLength) {
			channels = view.getUint16(offset + 10, true) || 2;
			bitsPerSample = view.getUint16(offset + 22, true) || 16;
		} else if (id === 'data') {
			dataOffset = offset + 8;
			dataLength = Math.min(size, wav.byteLength - dataOffset);
		}
		offset += 8 + size + (size % 2);
	}

	if (dataOffset < 0 || bitsPerSample !== 16 || dataLength <= 0) return peaks;

	const bytesPerFrame = channels * 2;
	const sampleCount = Math.floor(dataLength / bytesPerFrame);
	if (sampleCount <= 0) return peaks;

	for (let i = 0; i < sampleCount; i += 1) {
		const frameOffset = dataOffset + i * bytesPerFrame;
		let maxAbs = 0;
		for (let ch = 0; ch < channels; ch += 1) {
			const raw = view.getInt16(frameOffset + ch * 2, true);
			maxAbs = Math.max(maxAbs, Math.abs(raw) / 0x8000);
		}
		const bucket = Math.min(buckets - 1, Math.floor((i / sampleCount) * buckets));
		peaks[bucket] = Math.max(peaks[bucket], maxAbs);
	}

	return peaks.map((peak) => Number(peak.toFixed(3)));
}

function summarize(record: JobRecord): JobSummary {
	const { audio: _audio, ...summary } = record;
	return summary;
}

function normalizeInput(input: ComposerInput): ComposerInput {
	const mood = input.mood.trim().slice(0, 600) || '深夜の雨の都市。孤独だが希望がある';
	const durationSeconds = clamp(Math.round(Number(input.durationSeconds) || 30), 5, 60);
	const bpm = clamp(Math.round(Number(input.bpm) || 80), 40, 180);
	return { mood, durationSeconds, bpm };
}

function nextJobId(): string {
	globalStore.__tidalJobCounter = (globalStore.__tidalJobCounter ?? 0) + 1;
	return String(globalStore.__tidalJobCounter).padStart(3, '0');
}

// --- Claude composer ---

function systemPrompt(): string {
	return [
		`
You are an expert TidalCycles composer.

Output ONLY executable TidalCycles/Haskell code.
The output is pasted directly into BootTidal.hs.

Rules:
- No Markdown.
- No code fences.
- No explanations.
- No comments.
- No invented synth names.
- Use only sounds available in the reference document.
- Always include setcps.
- Use d1-d4 only.
- Prefer musical coherence over random sound selection.

`,
		musicTheoryDoc,
		tidalReferenceDoc
	].join('\n');
}

function composeUserPrompt(input: ComposerInput): string {
	return [
		`Mood: ${input.mood}`,
		`Duration: ${input.durationSeconds} seconds`,
		`Tempo: ${input.bpm} BPM`,
		`
Create a short ambient/downtempo piece.
Translate the mood into:
- scale/mode
- tempo
- harmonic movement
- sparse arrangement
- appropriate effects
before writing the code.
`
	].join('\n');
}

// Thrown when no per-request Claude API key was supplied. There is
// deliberately no server-side/env fallback here: this app has no login and
// no per-user quota, so a shared key baked into the Worker's env would let
// any visitor burn the deploying account's Anthropic quota (and likely
// breach Anthropic's terms for the account holder). Callers must send the
// visitor's own key with each request instead — see routes/api/jobs/+server.ts
// and the API key field in +page.svelte, which keeps it in the browser only.
export class MissingApiKeyError extends Error {
	constructor() {
		super('Claude APIキーが設定されていません');
		this.name = 'MissingApiKeyError';
	}
}

async function composeTidalCode(
	input: ComposerInput,
	runtimeEnv?: RuntimeEnv
): Promise<{ code: string; model: string; note: string }> {
	const apiKey = runtimeEnv?.ANTHROPIC_API_KEY;
	const model =
		runtimeEnv?.ANTHROPIC_MODEL ??
		(typeof process === 'undefined' ? undefined : process.env?.ANTHROPIC_MODEL) ??
		DEFAULT_MODEL;

	if (!apiKey) {
		throw new MissingApiKeyError();
	}

	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'anthropic-version': '2023-06-01',
			'x-api-key': apiKey
		},
		body: JSON.stringify({
			model,
			max_tokens: 900,
			system: systemPrompt(),
			messages: [{ role: 'user', content: composeUserPrompt(input) }]
		})
	});

	if (!response.ok) {
		throw new Error(`Claude API returned ${response.status}: ${await describeAnthropicError(response)}`);
	}

	const data = (await response.json()) as {
		content?: Array<{ type: string; text?: string }>;
	};
	const text = data.content?.find((part) => part.type === 'text')?.text ?? '';
	const code = sanitizeTidalCode(text);
	if (!code) {
		throw new Error('Claude did not return usable TidalCycles code');
	}

	return { code, model, note: `Claude composer used: ${model}` };
}

// Anthropic's error responses are JSON like
// `{ "error": { "type": "...", "message": "..." } }` — surface that message
// instead of just the HTTP status, since e.g. 400 alone doesn't distinguish
// "bad API key" from "unknown/retired model" from "malformed request".
async function describeAnthropicError(response: Response): Promise<string> {
	try {
		const data = (await response.json()) as { error?: { message?: string; type?: string } };
		return data.error?.message ?? JSON.stringify(data);
	} catch {
		return await response.text().catch(() => '(no body)');
	}
}

// Second-chance call used by renderJob() when the first render fails:
// same system prompt, but the conversation includes the broken code and
// the actual compiler/runtime error so Claude can fix it directly.
async function requestFix(
	badCode: string,
	renderLog: string,
	input: ComposerInput,
	runtimeEnv?: RuntimeEnv
): Promise<string | null> {
	const apiKey = runtimeEnv?.ANTHROPIC_API_KEY;
	const model =
		runtimeEnv?.ANTHROPIC_MODEL ??
		(typeof process === 'undefined' ? undefined : process.env?.ANTHROPIC_MODEL) ??
		DEFAULT_MODEL;
	if (!apiKey) return null;

	try {
		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'anthropic-version': '2023-06-01',
				'x-api-key': apiKey
			},
			body: JSON.stringify({
				model,
				max_tokens: 900,
				system: systemPrompt(),
				messages: [
					{ role: 'user', content: composeUserPrompt(input) },
					{ role: 'assistant', content: badCode },
					{
						role: 'user',
						content: [
							'このコードを実際にTidalCyclesで実行したところ失敗しました。',
							'レンダリングログの抜粋:',
							'```',
							renderLog.slice(-2000),
							'```',
							'原因を修正したコードのみを、同じ形式で書き直してください。'
						].join('\n')
					}
				]
			})
		});

		if (!response.ok) return null;

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>;
		};
		const text = data.content?.find((part) => part.type === 'text')?.text ?? '';
		return sanitizeTidalCode(text) || null;
	} catch {
		return null;
	}
}

function sanitizeTidalCode(text: string): string {
	const fenced = text.match(/```(?:haskell|tidal|hs)?\s*([\s\S]*?)```/i)?.[1] ?? text;
	const allowed = new Set<string>(CURATED_SOUNDS);
	const soundTokens = Array.from(fenced.matchAll(/sound\s+"([^"]+)"/g)).flatMap((match) =>
		match[1].split(/\s+/).filter(Boolean)
	);

	if (
		soundTokens.some((token) => {
			const bare = token.replace(/[*/].*$/, '').replace(/[()<>[\]~]/g, '');
			return bare !== '' && bare !== '~' && !allowed.has(bare);
		})
	) {
		return '';
	}

	return fenced.trim();
}

// --- Deterministic synth fallback, used when the AI Computer is
// unavailable or every real render attempt fails. Not TidalCycles output —
// a plain seeded waveform so the app always returns something playable. ---

function renderPreviewWav(input: ComposerInput): { wav: Uint8Array; peaks: number[] } {
	const sampleRate = 44_100;
	const samples = input.durationSeconds * sampleRate;
	const pcm = new Int16Array(samples);
	const seed = hashString(`${input.mood}:${input.bpm}:${input.durationSeconds}`);
	const random = mulberry32(seed);
	const beatSeconds = 60 / input.bpm;
	const chord = [220, 277.18, 329.63, 440];
	const peaks = new Array<number>(64).fill(0);

	for (let i = 0; i < samples; i += 1) {
		const t = i / sampleRate;
		const barFade = Math.min(1, t / 3, (input.durationSeconds - t) / 4);
		const lfo = 0.5 + 0.5 * Math.sin(Math.PI * 2 * t * 0.05);
		let value = 0;

		for (const [index, hz] of chord.entries()) {
			const detune = 1 + Math.sin(t * 0.07 + index) * 0.004;
			value += Math.sin(Math.PI * 2 * hz * detune * t) * (0.08 + index * 0.012);
		}

		const beatPhase = t % (beatSeconds * 2);
		const kick = Math.exp(-beatPhase * 18) * Math.sin(Math.PI * 2 * (70 - beatPhase * 20) * t);
		const hatPhase = t % (beatSeconds / 2);
		const hat = Math.exp(-hatPhase * 70) * (random() * 2 - 1);
		const rain = (random() * 2 - 1) * 0.025 * (0.4 + lfo * 0.6);

		value = value * barFade * (0.7 + lfo * 0.3) + kick * 0.18 + hat * 0.03 + rain;
		value = Math.tanh(value * 1.6);
		pcm[i] = Math.max(-1, Math.min(1, value)) * 0x7fff;

		const peakIndex = Math.min(peaks.length - 1, Math.floor((i / samples) * peaks.length));
		peaks[peakIndex] = Math.max(peaks[peakIndex], Math.abs(value));
	}

	return { wav: encodeWav(pcm, sampleRate), peaks: peaks.map((peak) => Number(peak.toFixed(3))) };
}

function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
	const dataSize = samples.length * 2;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	let offset = 0;

	writeAscii(view, offset, 'RIFF');
	offset += 4;
	view.setUint32(offset, 36 + dataSize, true);
	offset += 4;
	writeAscii(view, offset, 'WAVE');
	offset += 4;
	writeAscii(view, offset, 'fmt ');
	offset += 4;
	view.setUint32(offset, 16, true);
	offset += 4;
	view.setUint16(offset, 1, true);
	offset += 2;
	view.setUint16(offset, 1, true);
	offset += 2;
	view.setUint32(offset, sampleRate, true);
	offset += 4;
	view.setUint32(offset, sampleRate * 2, true);
	offset += 4;
	view.setUint16(offset, 2, true);
	offset += 2;
	view.setUint16(offset, 16, true);
	offset += 2;
	writeAscii(view, offset, 'data');
	offset += 4;
	view.setUint32(offset, dataSize, true);
	offset += 4;

	for (const sample of samples) {
		view.setInt16(offset, sample, true);
		offset += 2;
	}

	return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
	for (let i = 0; i < value.length; i += 1) {
		view.setUint8(offset + i, value.charCodeAt(i));
	}
}

function hashString(value: string): number {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function mulberry32(seed: number): () => number {
	return () => {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
