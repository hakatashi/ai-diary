import {Timestamp} from 'firebase-admin/firestore';
import {error as logError, info as logInfo} from 'firebase-functions/logger';
import {db} from '../../lib/firebaseAdmin';
import {immichApiKey, immichServerUrl} from '../../lib/secrets';
import {type ImmichAsset, searchAssets} from './client';
import {normalizeAsset} from './normalize';

export const REGION = 'asia-northeast1';
export const DATA_SOURCE_ID = 'immich';
export const DISPLAY_NAME = 'Immich (自己ホスト写真管理)';

const PAGE_SIZE = 250;
const DEFAULT_LOOKBACK_DAYS = 7;
// 通常同期(直近分のみ)の暴走防止用ページ上限。
const MAX_REGULAR_PAGES = 10;
// フルバックフィルの暴走防止用ページ上限(最大 MAX_BACKFILL_PAGES * PAGE_SIZE 件)。
const MAX_BACKFILL_PAGES = 40;
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;

// ImmichはOAuthを持たない単一ユーザーの自己ホストサーバーのため、Google/Swarmのような
// dataSourceSecrets経由のユーザー入力フローは使わず、GOOGLE_PLACES_API_KEY等と同様に
// Secret Manager(IMMICH_API_KEY)+ 非秘匿パラメータ(IMMICH_SERVER_URL)で設定する。
// 未設定の間は同期のたびにエラーとして dataSources/immich に記録される
// (`/data-sources` 画面でエラー内容を確認できる)。
export const syncImmichPhotos = async (
	options: {fullBackfill?: boolean} = {},
): Promise<void> => {
	const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
	const existingDataSource = await dataSourceRef.get();
	// 他のデータソースと違いOAuthコールバックのような別途の「接続」ステップが存在しない
	// ため、静的フィールドの初期化はここで行う。IMMICH_API_KEY未設定期間中の同期失敗で
	// ステータスのみのドキュメントが先に作られる場合があるため、`displayName` の有無で
	// 判定する(ドキュメントの存在有無だけで判定すると、設定完了後の初回成功時に
	// 静的フィールドが永久に補完されなくなる)。
	const needsInit = !existingDataSource.data()?.displayName;
	const staticFields = needsInit
		? {
				type: DATA_SOURCE_ID,
				displayName: DISPLAY_NAME,
				category: 'photo',
				enabled: true,
				syncCursor: null,
			}
		: {};
	const now = Timestamp.now();
	const createdAtField = existingDataSource.exists ? {} : {createdAt: now};

	try {
		let apiKey: string;
		try {
			apiKey = immichApiKey.value();
		} catch {
			apiKey = '';
		}
		const serverUrl = immichServerUrl.value().trim().replace(/\/+$/, '');
		if (!apiKey || !serverUrl) {
			throw new Error('IMMICH_API_KEY / IMMICH_SERVER_URL is not configured.');
		}

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
				...staticFields,
				...createdAtField,
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
				...staticFields,
				...createdAtField,
			},
			{merge: true},
		);
		throw err;
	}
};
