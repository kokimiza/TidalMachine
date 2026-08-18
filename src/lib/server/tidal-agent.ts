// The AI Computer: one TidalAgent Durable Object per composition job, each
// owning its own Cloudflare Container running the real TidalCycles /
// SuperCollider engine (see ../../../Dockerfile and ../../../container-src).
//
// Wiring follows the reference pattern in
// github.com/cloudflare/computer/blob/main/examples/container/src/index.ts:
// the DO is a thin host around CloudflareContainerBackend + Workspace; all
// the actual rendering logic lives in `render()` below and in the
// container-side shell scripts it invokes through `ws.runtime.exec`.
import { DurableObject } from 'cloudflare:workers';
import {
	type DurableObjectStorageLike,
	getWorkspace,
	WorkspaceProxy,
	withWorkspace,
	type WorkspaceOptions
} from '@cloudflare/computer';
import {
	CloudflareContainerBackend,
	withWorkspaceContainer
} from '@cloudflare/computer/backends/container';

// Re-exported so the Worker's top-level module graph includes it — the
// container backend builds a loopback binding (`ctx.exports.WorkspaceProxy`)
// for computerd's outbound egress, and that only works if this class is
// part of the same Worker script. See scripts/patch-worker.mjs.
export { WorkspaceProxy };

const JOB_DIR = '/workspace/job';

export type RenderInput = {
	/** Full contents of Main.hs — see composeMainHs() in jobs.ts. */
	mainHs: string;
	durationSeconds: number;
};

export type RenderResult =
	{ ok: true; wav: Uint8Array; log: string } | { ok: false; log: string; exitCode: number };

class TidalAgentBase extends withWorkspaceContainer(class extends DurableObject<Env> {}) {
	// The backend lives on the base class (not TidalAgent itself) because
	// withWorkspace's options callback runs while the Workspace is being
	// constructed, before subclass fields are initialized — see the
	// upstream example for the same comment.
	readonly backend = new CloudflareContainerBackend({
		container: () => this,
		workspace: { binding: 'TidalAgent', id: this.ctx.id.toString() }
	});
}

function workspaceOptions(self: InstanceType<typeof TidalAgentBase>): WorkspaceOptions {
	const { ctx } = self as unknown as { ctx: DurableObjectState };
	return {
		storage: ctx.storage as unknown as DurableObjectStorageLike,
		backends: [self.backend]
	};
}

export class TidalAgent extends withWorkspace(TidalAgentBase, workspaceOptions) {
	// computerd's outbound /ws upgrade lands here (routed back through
	// WorkspaceProxy); hand it straight to the backend.
	override async fetch(request: Request): Promise<Response> {
		return this.backend.handleFetch(request);
	}

	/**
	 * Writes the job's Main.hs into the container's workspace, runs
	 * container-src/render.sh (boots SuperDirt, builds + runs the pattern,
	 * records the output), and reads back the WAV + a full run log.
	 */
	async render(input: RenderInput): Promise<RenderResult> {
		const ws = await getWorkspace(this);
		await ws.fs.mkdir(JOB_DIR, { recursive: true });
		await ws.fs.writeFile(`${JOB_DIR}/Main.hs`, input.mainHs);

		// Boot (~10-20s) + the render itself + a safety margin render.sh
		// applies on the container side.
		const timeoutSeconds = input.durationSeconds + 90;
		const handle = await ws.runtime.exec(
			`timeout ${timeoutSeconds} bash /opt/render.sh ${JOB_DIR} ${input.durationSeconds}`,
			{ encoding: 'utf8' }
		);
		const result = await handle.result();

		const log = await readLog(ws, result.stdout, result.stderr);

		if (result.exitCode !== 0) {
			return { ok: false, log, exitCode: result.exitCode };
		}

		try {
			const wavStream = await ws.fs.readFile(`${JOB_DIR}/out.wav`);
			const wav = new Uint8Array(await new Response(wavStream).arrayBuffer());
			if (wav.byteLength === 0) {
				return { ok: false, log: `${log}\n[agent] out.wav was empty`, exitCode: result.exitCode };
			}
			return { ok: true, wav, log };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				log: `${log}\n[agent] failed to read out.wav: ${message}`,
				exitCode: result.exitCode
			};
		}
	}
}

async function readLog(
	ws: Awaited<ReturnType<typeof getWorkspace>>,
	stdout: string,
	stderr: string
): Promise<string> {
	try {
		const stream = await ws.fs.readFile(`${JOB_DIR}/render.log`);
		return await new Response(stream).text();
	} catch {
		return [stdout, stderr].filter(Boolean).join('\n');
	}
}
