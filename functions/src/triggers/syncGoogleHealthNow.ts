import {onCall} from 'firebase-functions/https';
import {syncGoogleHealthExercises} from '../dataSources/googleHealth/sync';
import {REGION} from '../dataSources/googleHealth/oauth';
import {assertOwner} from '../lib/assertOwner';
import {googleClientSecret} from '../lib/secrets';

export const syncGoogleHealthNow = onCall(
	{region: REGION, secrets: [googleClientSecret]},
	async (request) => {
		assertOwner(request);
		await syncGoogleHealthExercises();
		return {status: 'ok'};
	},
);
