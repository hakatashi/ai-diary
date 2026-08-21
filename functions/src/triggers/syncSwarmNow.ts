import {onCall} from 'firebase-functions/https';
import {REGION} from '../dataSources/swarm/oauth';
import {syncSwarmCheckins} from '../dataSources/swarm/sync';
import {assertOwner} from '../lib/assertOwner';
import {foursquareClientSecret} from '../lib/secrets';

export const syncSwarmNow = onCall(
	{region: REGION, secrets: [foursquareClientSecret]},
	async (request) => {
		assertOwner(request);
		const fullBackfill = Boolean(
			(request.data as {fullBackfill?: boolean} | undefined)?.fullBackfill,
		);
		await syncSwarmCheckins({fullBackfill});
		return {status: 'ok'};
	},
);
