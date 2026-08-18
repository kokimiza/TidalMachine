import { error, type RequestHandler } from '@sveltejs/kit';
import { getJob } from '#lib/server/jobs';

export const GET: RequestHandler = ({ params }) => {
	const job = params.id ? getJob(params.id) : undefined;
	if (!job) {
		error(404, 'Job not found');
	}

	return new Response(job.code, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `inline; filename="${job.id}-music.tidal"`,
			'cache-control': 'no-store'
		}
	});
};
