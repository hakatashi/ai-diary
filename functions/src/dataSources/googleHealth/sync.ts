import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {listExercises} from './client';
import {normalizeExercise} from './normalize';
import {DATA_SOURCE_ID} from './oauth';

const DEFAULT_LOOKBACK_DAYS = 7;

export const syncGoogleHealthExercises = async (): Promise<void> => {
	const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
	const secretDoc = await db
		.collection('dataSourceSecrets')
		.doc(DATA_SOURCE_ID)
		.get();

	if (!secretDoc.exists) {
		logInfo('Google Health data source is not connected yet. Skipping sync.');
		return;
	}

	const secret = secretDoc.data() as DataSourceSecret;
	const now = Timestamp.now();

	try {
		const endTime = now.toDate();
		const startTime = new Date(
			endTime.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
		);
		const rawExercises = await listExercises(
			secret.payload.refreshToken,
			startTime,
			endTime,
		);

		await Promise.all(
			rawExercises.map(async (raw) => {
				const {id, entry} = normalizeExercise(raw);
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
		logInfo(`Synced ${rawExercises.length} Google Health exercise records.`);
	} catch (err) {
		logError('Google Health sync failed', err);
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
