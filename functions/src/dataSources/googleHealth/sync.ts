import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {fetchExerciseTcx, listExercises} from './client';
import {
	attachGpsTrack,
	getDataPointName,
	mayHaveGpsTrack,
	normalizeExercise,
} from './normalize';
import {DATA_SOURCE_ID} from './oauth';
import {parseTcxTrackpoints} from './tcx';

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

	if (!secret.payload.refreshToken) {
		logError('Google Health secret is missing a refresh token.');
		return;
	}
	const refreshToken = secret.payload.refreshToken;

	try {
		const endTime = now.toDate();
		const startTime = new Date(
			endTime.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
		);
		const rawExercises = await listExercises(refreshToken, startTime, endTime);

		await Promise.all(
			rawExercises.map(async (raw) => {
				let normalized = normalizeExercise(raw);

				if (mayHaveGpsTrack(raw)) {
					const dataPointName = getDataPointName(raw);
					if (dataPointName) {
						const tcx = await fetchExerciseTcx(refreshToken, dataPointName);
						const points = tcx ? parseTcxTrackpoints(tcx) : [];
						if (points.length > 0) {
							normalized = await attachGpsTrack(normalized, points);
						}
					}
				}

				const {id, entry} = normalized;
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
