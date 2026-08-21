import {onCall} from 'firebase-functions/https';
import {REGION, syncImmichPhotos} from '../dataSources/immich/sync';
import {assertOwner} from '../lib/assertOwner';
import {immichApiKey} from '../lib/secrets';

export const syncImmichNow = onCall(
	{region: REGION, secrets: [immichApiKey], timeoutSeconds: 300},
	async (request) => {
		assertOwner(request);
		const fullBackfill = Boolean(
			(request.data as {fullBackfill?: boolean} | undefined)?.fullBackfill,
		);
		await syncImmichPhotos({fullBackfill});
		return {status: 'ok'};
	},
);
