import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError, onCall} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import {googlePlacesApiKey} from '../../lib/secrets';
import {dedupeVisitsAndCheckins} from '../dedup/dedupeVisitsAndCheckins';
import {
	isActivitySegment,
	isVisitSegment,
	normalizeActivitySegment,
	normalizeVisitSegment,
	type NormalizedSegment,
	type RawTimelineSegment,
} from './normalize';

export const REGION = 'asia-northeast1';
export const DATA_SOURCE_ID = 'google_maps_timeline';
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;

interface ImportChunkRequest {
	segments: RawTimelineSegment[];
}

interface ImportChunkResponse {
	imported: number;
	skipped: number;
}

export const importGoogleMapsTimelineChunk = onCall<ImportChunkRequest>(
	{region: REGION, secrets: [googlePlacesApiKey], timeoutSeconds: 300},
	async (request): Promise<ImportChunkResponse> => {
		assertOwner(request);

		const segments = request.data?.segments;
		if (!Array.isArray(segments)) {
			throw new HttpsError('invalid-argument', 'segments must be an array.');
		}

		const now = Timestamp.now();
		const normalizedEntries: NormalizedSegment[] = [];
		const affectedDates = new Set<string>();
		let skipped = 0;

		for (const segment of segments) {
			try {
				let normalized: NormalizedSegment | null = null;
				if (isVisitSegment(segment)) {
					normalized = await normalizeVisitSegment(segment);
				} else if (isActivitySegment(segment)) {
					normalized = normalizeActivitySegment(segment);
				}

				if (normalized) {
					normalizedEntries.push(normalized);
					affectedDates.add(normalized.entry.date);
				} else {
					skipped += 1;
				}
			} catch (err) {
				logError('Failed to normalize a Google Maps Timeline segment', err);
				skipped += 1;
			}
		}

		// 再アップロード時にも冪等にupsertできるよう docId は決定的だが、
		// 大量一括インポートのため既存createdAtを保持するための事前読み取りは行わず、
		// 常に createdAt を今回の実行時刻で上書きする(このデータソースに限った簡略化)。
		for (let i = 0; i < normalizedEntries.length; i += MAX_OPS_PER_COMMIT) {
			const batch = db.batch();
			const slice = normalizedEntries.slice(i, i + MAX_OPS_PER_COMMIT);
			for (const {id, entry} of slice) {
				const ref = db.collection('logEntries').doc(id);
				batch.set(
					ref,
					{
						...entry,
						dataSourceId: DATA_SOURCE_ID,
						updatedAt: now,
						createdAt: now,
					},
					{merge: true},
				);
			}
			await batch.commit();
		}

		if (affectedDates.size > 0) {
			await dedupeVisitsAndCheckins([...affectedDates]);
		}

		const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
		const existingDataSource = await dataSourceRef.get();
		await dataSourceRef.set(
			{
				type: DATA_SOURCE_ID,
				displayName: 'Google Maps タイムライン',
				category: 'location',
				status: 'connected',
				enabled: true,
				lastSyncedAt: now,
				lastSyncStatus: 'success',
				lastSyncError: null,
				syncCursor: null,
				updatedAt: now,
				...(existingDataSource.exists ? {} : {createdAt: now}),
			},
			{merge: true},
		);

		logInfo(
			`Imported ${normalizedEntries.length} Google Maps Timeline segments (${skipped} skipped).`,
		);

		return {imported: normalizedEntries.length, skipped};
	},
);
