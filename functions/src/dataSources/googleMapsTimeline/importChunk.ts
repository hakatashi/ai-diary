import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError, onCall} from 'firebase-functions/https';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {mapWithConcurrency} from '../../lib/concurrency';
import {db} from '../../lib/firebaseAdmin';
import {googlePlacesApiKey} from '../../lib/secrets';
import {dedupeVisitsAndCheckins} from '../dedup/dedupeVisitsAndCheckins';
import {
	isActivitySegment,
	isMemorySegment,
	isPathSegment,
	isVisitSegment,
	type NormalizedSegment,
	normalizeActivitySegment,
	normalizeMemorySegment,
	normalizePathSegment,
	normalizeVisitSegment,
	type RawTimelineSegment,
} from './normalize';
import {resolvePlacesBatch} from './placesClient';

export const REGION = 'asia-northeast1';
export const DATA_SOURCE_ID = 'google_maps_timeline';
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;
// セグメント正規化(Firestore読み取り・Places API・Storage書き込みを含みうる)を
// 逐次awaitすると1チャンクあたり数十秒かかるため、同時実行数を上げて待ち時間を短縮する。
const NORMALIZE_CONCURRENCY = 40;

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

		// 訪問セグメントのplaceIdはこのチャンク内で先にまとめて解決しておく
		// (個々のセグメント正規化のたびに1件ずつFirestore/Places APIを叩かない)。
		const placeIds = segments
			.filter(isVisitSegment)
			.map((segment) => segment.visit.topCandidate?.placeId)
			.filter((placeId): placeId is string => Boolean(placeId));
		const resolvedPlaces = await resolvePlacesBatch(placeIds);

		const normalizedResults = await mapWithConcurrency(
			segments,
			NORMALIZE_CONCURRENCY,
			async (segment): Promise<NormalizedSegment | null> => {
				try {
					if (isVisitSegment(segment)) {
						return normalizeVisitSegment(segment, resolvedPlaces);
					}
					if (isActivitySegment(segment)) {
						return normalizeActivitySegment(segment);
					}
					if (isPathSegment(segment)) {
						return await normalizePathSegment(segment);
					}
					if (isMemorySegment(segment)) {
						return normalizeMemorySegment(segment);
					}
					return null;
				} catch (err) {
					logError('Failed to normalize a Google Maps Timeline segment', err);
					return null;
				}
			},
		);

		for (const normalized of normalizedResults) {
			if (normalized) {
				normalizedEntries.push(normalized);
				affectedDates.add(normalized.entry.date);
			} else {
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
