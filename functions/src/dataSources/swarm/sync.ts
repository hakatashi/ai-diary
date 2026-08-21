import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import {dedupeVisitsAndCheckins} from '../dedup/dedupeVisitsAndCheckins';
import type {DataSourceSecret} from '../types';
import {listCheckins, type RawCheckin} from './client';
import {normalizeCheckin} from './normalize';
import {DATA_SOURCE_ID} from './oauth';

const MAX_BACKFILL_PAGES = 20;
const PAGE_SIZE = 250;

export const syncSwarmCheckins = async (
	options: {fullBackfill?: boolean} = {},
): Promise<void> => {
	const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
	const secretDoc = await db
		.collection('dataSourceSecrets')
		.doc(DATA_SOURCE_ID)
		.get();

	if (!secretDoc.exists) {
		logInfo('Swarm data source is not connected yet. Skipping sync.');
		return;
	}

	const secret = secretDoc.data() as DataSourceSecret;
	const now = Timestamp.now();

	if (!secret.payload.accessToken) {
		logError('Swarm secret is missing an access token.');
		return;
	}

	try {
		const allCheckins: RawCheckin[] = [];
		let offset = 0;
		// 通常同期は最新1ページのみ(既存分は冪等upsertなので取りこぼしにはならない)。
		// フルバックフィルは暴走防止のため最大20ページ(最大5,000件)までに制限する。
		const maxPages = options.fullBackfill ? MAX_BACKFILL_PAGES : 1;

		for (let page = 0; page < maxPages; page += 1) {
			const {items, count} = await listCheckins(secret.payload.accessToken, {
				offset,
				limit: PAGE_SIZE,
			});
			if (items.length === 0) {
				break;
			}
			allCheckins.push(...items);
			offset += items.length;
			if (offset >= count || items.length < PAGE_SIZE) {
				break;
			}
		}

		const affectedDates = new Set<string>();

		await Promise.all(
			allCheckins.map(async (raw) => {
				const {id, entry} = normalizeCheckin(raw);
				affectedDates.add(entry.date);
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

		if (affectedDates.size > 0) {
			await dedupeVisitsAndCheckins([...affectedDates]);
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
		logInfo(`Synced ${allCheckins.length} Swarm checkins.`);
	} catch (err) {
		logError('Swarm sync failed', err);
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
