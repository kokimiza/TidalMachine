<script lang="ts">
	import { onMount } from 'svelte';

	// Kept in the browser only (localStorage), never in server env — this
	// app has no login/quota system, so a shared server-side key would let
	// any visitor spend the deploying account's Anthropic quota. Sent per
	// request via the x-anthropic-api-key header; see api/jobs/+server.ts.
	const API_KEY_STORAGE_KEY = 'tidal-computer:anthropic-api-key';

	type JobSummary = {
		id: string;
		mood: string;
		durationSeconds: number;
		bpm: number;
		code: string;
		codePath: string;
		audioPath: string;
		audioUrl: string;
		codeUrl: string;
		renderer: 'cloudflare-computer' | 'simulated-tidal';
		model: string;
		log: string[];
		peaks: number[];
		createdAt: string;
	};

	let mood = $state('深夜の雨の都市。孤独だが希望がある');
	let durationSeconds = $state(30);
	let bpm = $state(80);
	let apiKey = $state('');
	let job = $state<JobSummary | null>(null);
	let isSubmitting = $state(false);
	let errorMessage = $state('');

	onMount(() => {
		apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
	});

	function saveApiKey() {
		localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
	}

	async function submitJob() {
		if (!apiKey.trim()) {
			errorMessage = 'Claude APIキーを入力してください';
			return;
		}

		isSubmitting = true;
		errorMessage = '';

		try {
			const response = await fetch('/api/jobs', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-anthropic-api-key': apiKey
				},
				body: JSON.stringify({ mood, durationSeconds, bpm })
			});

			const data = await response.json().catch(() => null);

			if (!response.ok) {
				const message = (data as { error?: string } | null)?.error;
				throw new Error(message ?? `生成に失敗しました (${response.status})`);
			}

			job = data as JobSummary;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : '生成に失敗しました';
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Tidal Computer Sketch</title>
	<meta
		name="description"
		content="Generate a TidalCycles sketch and preview WAV from a browser prompt."
	/>
</svelte:head>

<main class="shell">
	<section class="control">
		<div class="brand">
			<span class="mark"></span>
			<div>
				<p>Tidal Computer Sketch</p>
				<h1>AIにTidalCyclesで短い曲を書かせる</h1>
			</div>
		</div>

		<form
			onsubmit={(event) => {
				event.preventDefault();
				submitJob();
			}}
		>
			<label>
				<span>Claude APIキー</span>
				<input
					type="password"
					autocomplete="off"
					placeholder="sk-ant-..."
					bind:value={apiKey}
					oninput={saveApiKey}
				/>
			</label>
			<p class="hint">
				このブラウザ内(localStorage)にのみ保存され、生成リクエスト時にサーバーへ送られます。サーバー側には保存されません。
			</p>

			<label>
				<span>雰囲気</span>
				<textarea bind:value={mood} rows="7"></textarea>
			</label>

			<div class="grid">
				<label>
					<span>長さ</span>
					<input type="number" min="5" max="60" bind:value={durationSeconds} />
				</label>

				<label>
					<span>テンポ</span>
					<input type="number" min="40" max="180" bind:value={bpm} />
				</label>
			</div>

			<button disabled={isSubmitting}>
				{isSubmitting ? '生成中...' : '生成する'}
			</button>
		</form>

		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}
	</section>

	<section class="result" aria-live="polite">
		{#if job}
			<div class="status">
				<div>
					<p>完成しました</p>
					<h2>{job.audioPath}</h2>
				</div>
				<span>{job.durationSeconds}s / {job.bpm} BPM</span>
			</div>

			<div class="waveform" aria-hidden="true">
				{#each job.peaks as peak}
					<span style={`height: ${Math.max(8, peak * 100)}%`}></span>
				{/each}
			</div>

			<audio controls src={job.audioUrl}></audio>

			<div class="actions">
				<a href={job.audioUrl} download={`${job.id}-music.wav`}>music.wav</a>
				<a href={job.codeUrl} download={`${job.id}-music.tidal`}>music.tidal</a>
			</div>

			<div class="code-head">
				<div>
					<p>コードを見る</p>
					<h3>{job.codePath}</h3>
				</div>
				<span>{job.model} · {job.renderer}</span>
			</div>

			<pre>{job.code}</pre>

			<ol class="log">
				{#each job.log as entry}
					<li>{entry}</li>
				{/each}
			</ol>
		{:else}
			<div class="empty">
				<div class="meter">
					<span></span>
					<span></span>
					<span></span>
					<span></span>
					<span></span>
					<span></span>
				</div>
				<p>/jobs/001/music.tidal</p>
				<h2>依頼を投げると、ここにWAVとTidalコードが返ってきます。</h2>
			</div>
		{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background:
			linear-gradient(120deg, rgba(17, 24, 39, 0.94), rgba(24, 39, 43, 0.88)),
			radial-gradient(circle at 20% 10%, rgba(88, 166, 255, 0.28), transparent 30%), #0b0d12;
		color: #eef2f7;
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	.shell {
		display: grid;
		grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
		min-height: 100vh;
	}

	.control,
	.result {
		padding: clamp(24px, 4vw, 56px);
	}

	.control {
		border-right: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(9, 13, 20, 0.68);
	}

	.brand {
		display: flex;
		gap: 14px;
		align-items: center;
		margin-bottom: 36px;
	}

	.mark {
		width: 42px;
		height: 42px;
		border: 1px solid rgba(255, 255, 255, 0.24);
		border-radius: 8px;
		background:
			linear-gradient(90deg, transparent 40%, rgba(255, 255, 255, 0.68) 41% 45%, transparent 46%),
			linear-gradient(0deg, #6ee7b7, #38bdf8 45%, #fbbf24);
	}

	p {
		margin: 0;
		color: #95a3b8;
		font-size: 13px;
	}

	h1,
	h2,
	h3 {
		margin: 0;
		letter-spacing: 0;
	}

	h1 {
		margin-top: 4px;
		font-size: 24px;
		line-height: 1.24;
	}

	form {
		display: grid;
		gap: 18px;
	}

	label {
		display: grid;
		gap: 8px;
	}

	label span {
		color: #d9e2ef;
		font-size: 13px;
		font-weight: 700;
	}

	textarea,
	input {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.08);
		color: #f8fbff;
		font: inherit;
		outline: none;
	}

	textarea {
		resize: vertical;
		padding: 14px;
		line-height: 1.6;
	}

	input {
		height: 48px;
		padding: 0 12px;
	}

	textarea:focus,
	input:focus {
		border-color: #6ee7b7;
		box-shadow: 0 0 0 3px rgba(110, 231, 183, 0.12);
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}

	button {
		height: 52px;
		border: 0;
		border-radius: 8px;
		background: #6ee7b7;
		color: #06201a;
		cursor: pointer;
		font: inherit;
		font-weight: 800;
	}

	button:disabled {
		cursor: wait;
		opacity: 0.68;
	}

	.hint {
		margin-top: -10px;
		font-size: 12px;
		line-height: 1.5;
	}

	.error {
		margin-top: 18px;
		color: #fecaca;
	}

	.result {
		display: grid;
		align-content: start;
		gap: 22px;
	}

	.status,
	.code-head {
		display: flex;
		justify-content: space-between;
		gap: 18px;
		align-items: start;
	}

	.status h2 {
		margin-top: 6px;
		font-size: clamp(28px, 4vw, 46px);
		line-height: 1.05;
	}

	.status span,
	.code-head span {
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 999px;
		padding: 7px 10px;
		color: #cbd5e1;
		font-size: 12px;
		white-space: nowrap;
	}

	.waveform {
		display: grid;
		grid-template-columns: repeat(64, 1fr);
		align-items: center;
		gap: 4px;
		height: 130px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: 14px;
		background: rgba(255, 255, 255, 0.06);
	}

	.waveform span,
	.meter span {
		display: block;
		border-radius: 999px;
		background: linear-gradient(180deg, #fbbf24, #6ee7b7 48%, #38bdf8);
	}

	audio {
		width: 100%;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.actions a {
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 8px;
		padding: 10px 12px;
		background: rgba(255, 255, 255, 0.08);
		color: #eef2f7;
		text-decoration: none;
		font-weight: 700;
	}

	.code-head h3 {
		margin-top: 4px;
		font-size: 18px;
	}

	pre {
		overflow: auto;
		margin: 0;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: 18px;
		background: rgba(2, 6, 12, 0.74);
		color: #d6f7ee;
		font-size: 14px;
		line-height: 1.6;
	}

	.log {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
		color: #aebbd0;
		font-size: 13px;
	}

	.log li::before {
		content: '· ';
		color: #6ee7b7;
	}

	.empty {
		display: grid;
		min-height: 70vh;
		align-content: center;
		gap: 16px;
	}

	.empty h2 {
		max-width: 720px;
		font-size: clamp(30px, 5vw, 64px);
		line-height: 1.04;
	}

	.meter {
		display: flex;
		align-items: end;
		gap: 8px;
		height: 86px;
	}

	.meter span {
		width: 18px;
	}

	.meter span:nth-child(1) {
		height: 28%;
	}

	.meter span:nth-child(2) {
		height: 64%;
	}

	.meter span:nth-child(3) {
		height: 42%;
	}

	.meter span:nth-child(4) {
		height: 86%;
	}

	.meter span:nth-child(5) {
		height: 54%;
	}

	.meter span:nth-child(6) {
		height: 72%;
	}

	@media (max-width: 840px) {
		.shell {
			grid-template-columns: 1fr;
		}

		.control {
			border-right: 0;
			border-bottom: 1px solid rgba(255, 255, 255, 0.12);
		}

		.status,
		.code-head {
			display: grid;
		}
	}

	@media (max-width: 520px) {
		.grid {
			grid-template-columns: 1fr;
		}

		.waveform {
			gap: 2px;
			height: 96px;
			padding: 10px;
		}
	}
</style>
