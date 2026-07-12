import {beforeEach, vi} from 'vitest';

const originalFetch = global.fetch;
const fetchMock = vi.fn<typeof fetch>((...args) => {
	const [url] = args;
	if (url === '/__/firebase/init.json') {
		return Promise.resolve(
			new Response(
				JSON.stringify({
					apiKey: 'fakeApiKey',
					projectId: 'hakatadiary',
				}),
			),
		);
	}
	return originalFetch(...args);
});
vi.stubGlobal('fetch', fetchMock);

beforeEach(async () => {
	// Reset firestore data
	await originalFetch(
		'http://localhost:40615/emulator/v1/projects/hakatadiary/databases/(default)/documents',
		{
			method: 'DELETE',
		},
	);
	// Wait a bit for the deletion to complete
	await new Promise((resolve) => setTimeout(resolve, 100));
});
