import {onCall} from 'firebase-functions/https';
import {REGION} from '../dataSources/googleHealth/oauth';
import {syncGoogleHealth} from '../dataSources/googleHealth/sync';
import {assertOwner} from '../lib/assertOwner';
import {googleClientSecret} from '../lib/secrets';

export const syncGoogleHealthNow = onCall(
	{region: REGION, secrets: [googleClientSecret]},
	async (request) => {
		assertOwner(request);
		await syncGoogleHealth();
		return {status: 'ok'};
	},
);
