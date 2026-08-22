import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import {zaimConsumerKey, zaimConsumerSecret} from '../../lib/secrets';
import {dedupeZaimAndMoneyforward} from '../dedup/dedupeZaimAndMoneyforward';
import {applyFinanceRules, loadFinanceRules} from '../finance/rules';
import type {DataSourceSecret} from '../types';
import {
	getAccounts,
	getCategories,
	getGenres,
	getMoneyRecords,
	type ZaimMoneyRecord,
} from './client';
import {buildCategoryMaps, normalizeZaimMoneyRecord} from './normalize';
import {DATA_SOURCE_ID} from './oauth';

const PAGE_SIZE = 100;
// Zaimは手動入力のため記録が数日遅れることを想定し、Google Calendar(7日)より長めに取る。
const DEFAULT_LOOKBACK_DAYS = 30;
// 通常同期(直近分のみ)の暴走防止用ページ上限。
const MAX_REGULAR_PAGES = 10;
// フルバックフィルの暴走防止用ページ上限(最大 MAX_BACKFILL_PAGES * PAGE_SIZE 件)。
const MAX_BACKFILL_PAGES = 200;

const toDateString = (date: Date): string => date.toISOString().slice(0, 10);

export const syncZaimMoney = async (
	options: {fullBackfill?: boolean} = {},
): Promise<void> => {
	const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
	const secretDoc = await db
		.collection('dataSourceSecrets')
		.doc(DATA_SOURCE_ID)
		.get();

	if (!secretDoc.exists) {
		logInfo('Zaim data source is not connected yet. Skipping sync.');
		return;
	}

	const secret = secretDoc.data() as DataSourceSecret;
	const {accessToken, accessTokenSecret} = secret.payload;
	if (!accessToken || !accessTokenSecret) {
		logError('Zaim secret is missing an accessToken or accessTokenSecret.');
		return;
	}

	const credentials = {
		consumerKey: zaimConsumerKey.value(),
		consumerSecret: zaimConsumerSecret.value(),
		accessToken,
		accessTokenSecret,
	};

	const now = Timestamp.now();

	try {
		const [categories, genres, accounts, rules] = await Promise.all([
			getCategories(credentials),
			getGenres(credentials),
			getAccounts(credentials),
			loadFinanceRules(),
		]);
		const maps = buildCategoryMaps(categories, genres, accounts);

		const startDate = options.fullBackfill
			? undefined
			: toDateString(
					new Date(
						now.toMillis() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
					),
				);
		const maxPages = options.fullBackfill
			? MAX_BACKFILL_PAGES
			: MAX_REGULAR_PAGES;

		const allRecords: ZaimMoneyRecord[] = [];
		for (let page = 1; page <= maxPages; page += 1) {
			const records = await getMoneyRecords(credentials, {
				startDate,
				page,
				limit: PAGE_SIZE,
			});
			allRecords.push(...records);
			if (records.length < PAGE_SIZE) {
				break;
			}
		}

		const normalizedEntries = allRecords.map((record) => {
			const normalized = normalizeZaimMoneyRecord(record, maps);
			const finance = normalized.entry.finance;
			if (!finance) {
				return normalized;
			}
			return {
				...normalized,
				entry: {
					...normalized.entry,
					finance: applyFinanceRules(finance, normalized.entry.title, rules),
				},
			};
		});
		const affectedDates = new Set(
			normalizedEntries.map(({entry}) => entry.date),
		);

		// 通常同期は直近分のみで件数が少ないため、既存createdAtを保持できるよう
		// 事前読み取りを行う(Google Calendar/Immich通常同期と同じ方式)。フルバックフィルは
		// 件数が多くなりうるため、Immichフルバックフィルと同様に事前読み取りを省く。
		if (options.fullBackfill) {
			const MAX_OPS_PER_COMMIT = 450;
			for (let i = 0; i < normalizedEntries.length; i += MAX_OPS_PER_COMMIT) {
				const batch = db.batch();
				for (const {id, entry} of normalizedEntries.slice(
					i,
					i + MAX_OPS_PER_COMMIT,
				)) {
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

		if (affectedDates.size > 0) {
			await dedupeZaimAndMoneyforward([...affectedDates]);
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
		logInfo(`Synced ${normalizedEntries.length} Zaim money records.`);
	} catch (err) {
		logError('Zaim sync failed', err);
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
