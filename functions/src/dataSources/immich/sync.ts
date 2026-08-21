import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import type {DataSourceSecret} from '../types';
import {type ImmichAsset, searchAssets} from './client';
import {DATA_SOURCE_ID} from './connect';
import {normalizeAsset} from './normalize';

const PAGE_SIZE = 250;
const DEFAULT_LOOKBACK_DAYS = 7;
// 通常同期(直近分のみ)の暴走防止用ページ上限。
const MAX_REGULAR_PAGES = 10;
// フルバックフィルの暴走防止用ページ上限(最大 MAX_BACKFILL_PAGES * PAGE_SIZE 件)。
const MAX_BACKFILL_PAGES = 40;
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;

export const syncImmichPhotos = async (
	options: {fullBackfill?: boolean} = {},
): Promise<void> => {
	const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
	const secretDoc = await db
		.collection('dataSourceSecrets')
		.doc(DATA_SOURCE_ID)
		.get();

	if (!secretDoc.exists) {
		logInfo('Immich data source is not connected yet. Skipping sync.');
		return;
	}

	const secret = secretDoc.data() as DataSourceSecret;
	const {apiKey, serverUrl} = secret.payload;
	if (!apiKey || !serverUrl) {
		logError('Immich secret is missing an apiKey or serverUrl.');
		return;
	}

	const now = Timestamp.now();

	try {
		const takenAfter = options.fullBackfill
			? undefined
			: new Date(now.toMillis() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
		const maxPages = options.fullBackfill
			? MAX_BACKFILL_PAGES
			: MAX_REGULAR_PAGES;

		const allAssets: ImmichAsset[] = [];
		let page = 1;
		for (; page <= maxPages; page += 1) {
			const result = await searchAssets(serverUrl, apiKey, {
				takenAfter,
				page,
				size: PAGE_SIZE,
			});
			allAssets.push(...result.items);
			if (!result.nextPage) {
				break;
			}
		}

		const normalizedEntries = allAssets.map((asset) => normalizeAsset(asset));

		if (options.fullBackfill) {
			// フルバックフィルは件数が多くなりうるため、Google Maps Timelineインポートと
			// 同様に既存createdAtを保持するための事前読み取りは行わず、バッチ書き込みのみで
			// 完結させる(このため再バックフィル時はcreatedAtも上書きされる)。
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
		} else {
			// 通常同期は直近分のみで件数が少ないため、既存createdAtを保持できるよう
			// 事前読み取りを行う(Google Calendar/Swarm同期と同じ方式)。
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
		}

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
		logInfo(`Synced ${normalizedEntries.length} Immich assets.`);
	} catch (err) {
		logError('Immich sync failed', err);
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
