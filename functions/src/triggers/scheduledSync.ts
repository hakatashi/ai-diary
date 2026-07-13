import {onSchedule} from 'firebase-functions/scheduler';
import {syncGoogleHealthExercises} from '../dataSources/googleHealth/sync';
import {REGION} from '../dataSources/googleHealth/oauth';
import {googleClientSecret} from '../lib/secrets';

export const scheduledSync = onSchedule(
	{schedule: 'every 3 hours', region: REGION, secrets: [googleClientSecret]},
	async () => {
		await syncGoogleHealthExercises();
	},
);
