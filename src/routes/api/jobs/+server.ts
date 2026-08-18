import type { RequestHandler } from '@sveltejs/kit';
import { createJob, MissingApiKeyError } from '#lib/server/jobs';
import type { TidalAgent } from '#lib/server/tidal-agent';

export const POST: RequestHandler = async ({ request, platform }) => {
	const body = (await request.json().catch(() => ({}))) as {
		mood?: unknown;
		durationSeconds?: unknown;
		bpm?: unknown;
	};

	// The Claude API key comes from the visitor's own browser (see the API
	// key field in +page.svelte, kept in localStorage), never from server
	// env — this app has no login/quota system, so a shared env secret
	// would let any visitor spend the deploying account's Anthropic quota.
	const apiKey = request.headers.get('x-anthropic-api-key')?.trim();
	if (!apiKey) {
		return Response.json({ error: 'Claude APIキーが設定されていません' }, { status: 401 });
	}

	// ANTHROPIC_MODEL isn't a secret (just a model id), but it's still a
	// plain var not declared in wrangler.jsonc, so `Env` doesn't know about
	// it. `wrangler types` also can't infer the DO's RPC surface for
	// TidalAgent (it emits an untyped `DurableObjectNamespace`), so the
	// whole thing is a manual cast against the real binding shape.
	const env = platform?.env as
		| {
				ANTHROPIC_MODEL?: string;
				TidalAgent?: DurableObjectNamespace<TidalAgent>;
		  }
		| undefined;

	try {
		const job = await createJob(
			{
				mood: typeof body.mood === 'string' ? body.mood : '',
				durationSeconds: Number(body.durationSeconds),
				bpm: Number(body.bpm)
			},
			{
				ANTHROPIC_API_KEY: apiKey,
				ANTHROPIC_MODEL: env?.ANTHROPIC_MODEL,
				TidalAgent: env?.TidalAgent
			}
		);

		return Response.json(job);
	} catch (error) {
		if (error instanceof MissingApiKeyError) {
			return Response.json({ error: error.message }, { status: 401 });
		}
		const message = error instanceof Error ? error.message : '生成に失敗しました';
		return Response.json({ error: message }, { status: 502 });
	}
};
