import {onCall} from 'firebase-functions/https';
import {REGION} from '../dataSources/zaim/oauth';
import {syncZaimMoney} from '../dataSources/zaim/sync';
import {assertOwner} from '../lib/assertOwner';
import {zaimConsumerSecret} from '../lib/secrets';

export const syncZaimNow = onCall(
	{region: REGION, secrets: [zaimConsumerSecret], timeoutSeconds: 300},
	async (request) => {
		assertOwner(request);
		const fullBackfill = Boolean(
			(request.data as {fullBackfill?: boolean} | undefined)?.fullBackfill,
		);
		await syncZaimMoney({fullBackfill});
		return {status: 'ok'};
	},
);
