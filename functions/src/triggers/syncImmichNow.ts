import {onCall} from 'firebase-functions/https';
import {REGION} from '../dataSources/immich/connect';
import {syncImmichPhotos} from '../dataSources/immich/sync';
import {assertOwner} from '../lib/assertOwner';

export const syncImmichNow = onCall(
	{region: REGION, timeoutSeconds: 300},
	async (request) => {
		assertOwner(request);
		const fullBackfill = Boolean(
			(request.data as {fullBackfill?: boolean} | undefined)?.fullBackfill,
		);
		await syncImmichPhotos({fullBackfill});
		return {status: 'ok'};
	},
);
