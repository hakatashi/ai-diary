import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import type {
	DataSourceSyncStatus,
	LogEntry,
} from '../../../../src/lib/schema.ts';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {
	fetchExerciseTcx,
	listExercises,
	listNutritionLogs,
	listSleepSessions,
	listWeights,
} from './client';
import {
	attachGpsTrack,
	getDataPointName,
	mayHaveGpsTrack,
	normalizeExercise,
	normalizeNutritionLog,
	normalizeSleep,
	normalizeWeight,
} from './normalize';
import {DATA_SOURCE_ID} from './oauth';
import {parseTcxTrackpoints} from './tcx';

const DEFAULT_LOOKBACK_DAYS = 7;

type NormalizedEntry = {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
};

const upsertNormalizedEntries = async (
	normalizedEntries: NormalizedEntry[],
	now: Timestamp,
): Promise<void> => {
	await Promise.all(
		normalizedEntries.map(async ({id, entry}) => {
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
};

const syncExercises = async (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
	now: Timestamp,
): Promise<number> => {
	const rawExercises = await listExercises(refreshToken, startTime, endTime);

	const normalizedEntries = await Promise.all(
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

			return normalized;
		}),
	);

	await upsertNormalizedEntries(normalizedEntries, now);
	return normalizedEntries.length;
};

const syncNutritionLogs = async (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
	now: Timestamp,
): Promise<number> => {
	const raw = await listNutritionLogs(refreshToken, startTime, endTime);
	const normalizedEntries = raw.map(normalizeNutritionLog);
	await upsertNormalizedEntries(normalizedEntries, now);
	return normalizedEntries.length;
};

const syncSleepSessions = async (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
	now: Timestamp,
): Promise<number> => {
	const raw = await listSleepSessions(refreshToken, startTime, endTime);
	const normalizedEntries = raw.map(normalizeSleep);
	await upsertNormalizedEntries(normalizedEntries, now);
	return normalizedEntries.length;
};

const syncWeights = async (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
	now: Timestamp,
): Promise<number> => {
	const raw = await listWeights(refreshToken, startTime, endTime);
	const normalizedEntries = raw.map(normalizeWeight);
	await upsertNormalizedEntries(normalizedEntries, now);
	return normalizedEntries.length;
};

// 体重(health_metrics_and_measurements.readonly)は運動記録用スコープとは別スコープが必要で、
// 未接続ユーザーは403で失敗する。データタイプごとに独立してtry/catchし、1つの失敗が他の
// データタイプの同期を止めないようにする(scheduledSync.tsのデータソース単位の設計と同様)。
const SYNC_TASKS: {
	name: string;
	run: (
		refreshToken: string,
		startTime: Date,
		endTime: Date,
		now: Timestamp,
	) => Promise<number>;
}[] = [
	{name: 'exercise', run: syncExercises},
	{name: 'nutrition', run: syncNutritionLogs},
	{name: 'sleep', run: syncSleepSessions},
	{name: 'weight', run: syncWeights},
];

export const syncGoogleHealth = async (): Promise<void> => {
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

	const endTime = now.toDate();
	const startTime = new Date(
		endTime.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
	);

	const errors: string[] = [];
	let successCount = 0;

	for (const task of SYNC_TASKS) {
		try {
			const count = await task.run(refreshToken, startTime, endTime, now);
			successCount += 1;
			logInfo(`Synced ${count} Google Health ${task.name} records.`);
		} catch (err) {
			logError(`Google Health ${task.name} sync failed`, err);
			errors.push(
				`${task.name}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const lastSyncStatus: DataSourceSyncStatus =
		errors.length === 0 ? 'success' : successCount === 0 ? 'error' : 'partial';

	await dataSourceRef.set(
		{
			status: successCount === 0 ? 'error' : 'connected',
			lastSyncedAt: now,
			lastSyncStatus,
			lastSyncError: errors.length > 0 ? errors.join(' / ') : null,
			updatedAt: now,
		},
		{merge: true},
	);

	if (successCount === 0) {
		throw new Error(errors.join(' / '));
	}
};
