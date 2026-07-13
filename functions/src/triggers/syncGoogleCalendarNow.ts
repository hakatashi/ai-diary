import {onCall} from 'firebase-functions/https';
import {REGION} from '../dataSources/googleCalendar/oauth';
import {syncGoogleCalendarEvents} from '../dataSources/googleCalendar/sync';
import {assertOwner} from '../lib/assertOwner';
import {googleClientSecret} from '../lib/secrets';

export const syncGoogleCalendarNow = onCall(
	{region: REGION, secrets: [googleClientSecret]},
	async (request) => {
		assertOwner(request);
		await syncGoogleCalendarEvents();
		return {status: 'ok'};
	},
);
