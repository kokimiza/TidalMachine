import { error, type RequestHandler } from '@sveltejs/kit';
import { getJob } from '#lib/server/jobs';

export const GET: RequestHandler = ({ params }) => {
	const job = params.id ? getJob(params.id) : undefined;
	if (!job) {
		error(404, 'Job not found');
	}

	return new Response(job.audio.slice(), {
		headers: {
			'content-type': 'audio/wav',
			'content-disposition': `inline; filename="${job.id}-music.wav"`,
			'cache-control': 'no-store'
		}
	});
};
