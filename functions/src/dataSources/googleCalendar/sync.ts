import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {listEvents} from './client';
import {normalizeCalendarEvent} from './normalize';
import {DATA_SOURCE_ID} from './oauth';

const DEFAULT_LOOKBACK_DAYS = 7;

export const syncGoogleCalendarEvents = async (): Promise<void> => {
	const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
	const secretDoc = await db
		.collection('dataSourceSecrets')
		.doc(DATA_SOURCE_ID)
		.get();

	if (!secretDoc.exists) {
		logInfo('Google Calendar data source is not connected yet. Skipping sync.');
		return;
	}

	const secret = secretDoc.data() as DataSourceSecret;
	const now = Timestamp.now();

	if (!secret.payload.refreshToken) {
		logError('Google Calendar secret is missing a refresh token.');
		return;
	}

	try {
		const endTime = now.toDate();
		const startTime = new Date(
			endTime.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
		);
		const rawEvents = (
			await listEvents(secret.payload.refreshToken, startTime, endTime)
		).filter((event) => event.status !== 'cancelled');

		await Promise.all(
			rawEvents.map(async (raw) => {
				const {id, entry} = normalizeCalendarEvent(raw);
				const ref = db.collection('logEntries').doc(id);
				const existing = await ref.get();
				await ref.set(
					{
						...entry,
						dataSourceId: DATA_SOURCE_ID,
						updatedAt: now,
						...(existing.exists ? {} : {createdAt: now}),
					},
					{merge: true},
				);
			}),
		);

		await dataSourceRef.set(
			{
				status: 'connected',
				lastSyncedAt: now,
				lastSyncStatus: 'success',
				lastSyncError: null,
				updatedAt: now,
			},
			{merge: true},
		);
		logInfo(`Synced ${rawEvents.length} Google Calendar events.`);
	} catch (err) {
		logError('Google Calendar sync failed', err);
		await dataSourceRef.set(
			{
				status: 'error',
				lastSyncStatus: 'error',
				lastSyncError: err instanceof Error ? err.message : String(err),
				updatedAt: Timestamp.now(),
			},
			{merge: true},
		);
		throw err;
	}
};
