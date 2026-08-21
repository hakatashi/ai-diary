import {error as logError} from 'firebase-functions/logger';
import {onSchedule} from 'firebase-functions/scheduler';
import {syncGoogleCalendarEvents} from '../dataSources/googleCalendar/sync';
import {syncGoogleHealthExercises} from '../dataSources/googleHealth/sync';
import {syncImmichPhotos} from '../dataSources/immich/sync';
import {syncSwarmCheckins} from '../dataSources/swarm/sync';
import {REGION} from '../lib/googleOAuth';
import {
	foursquareClientSecret,
	googleClientSecret,
	immichApiKey,
} from '../lib/secrets';

// データソースは互いに独立しているため、1つの同期が失敗しても他の同期を止めない。
const syncSources = [
	{name: 'google_health', run: () => syncGoogleHealthExercises()},
	{name: 'google_calendar', run: () => syncGoogleCalendarEvents()},
	{name: 'swarm', run: () => syncSwarmCheckins({fullBackfill: false})},
	{name: 'immich', run: () => syncImmichPhotos({fullBackfill: false})},
];

export const scheduledSync = onSchedule(
	{
		schedule: 'every 3 hours',
		region: REGION,
		secrets: [googleClientSecret, foursquareClientSecret, immichApiKey],
	},
	async () => {
		for (const source of syncSources) {
			try {
				await source.run();
			} catch (err) {
				logError(`Scheduled sync failed for ${source.name}`, err);
			}
		}
	},
);
