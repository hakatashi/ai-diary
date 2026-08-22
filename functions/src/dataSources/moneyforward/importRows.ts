import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError, onCall} from 'firebase-functions/https';
import {info as logInfo} from 'firebase-functions/logger';
import {assertOwner} from '../../lib/assertOwner';
import {db} from '../../lib/firebaseAdmin';
import {dedupeZaimAndMoneyforward} from '../dedup/dedupeZaimAndMoneyforward';
import {applyFinanceRules, loadFinanceRules} from '../finance/rules';
import {normalizeMoneyforwardRow, type RawMoneyforwardRow} from './normalize';

export const REGION = 'asia-northeast1';
export const DATA_SOURCE_ID = 'moneyforward';
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;

interface ImportRowsRequest {
	rows: RawMoneyforwardRow[];
}

interface ImportRowsResponse {
	imported: number;
}

// MoneyforwardはCSVの手動エクスポートしかないため、クライアントでShift_JISデコード・CSV
// パース済みの行をGoogle Maps Timelineインポートと同じ「チャンク分割して複数回呼ぶ」方式で
// 取り込む(docs/adr/0013参照)。低頻度手動運用のため、既存createdAtを保持するための
// 事前読み取りは行わずバッチ書き込みのみで完結させる(再アップロード時はcreatedAtも上書き)。
export const importMoneyforwardRows = onCall<ImportRowsRequest>(
	{region: REGION, timeoutSeconds: 300},
	async (request): Promise<ImportRowsResponse> => {
		assertOwner(request);

		const rows = request.data?.rows;
		if (!Array.isArray(rows)) {
			throw new HttpsError('invalid-argument', 'rows must be an array.');
		}

		const rules = await loadFinanceRules();
		const now = Timestamp.now();
		const affectedDates = new Set<string>();

		const normalizedEntries = rows.map((row) => {
			const normalized = normalizeMoneyforwardRow(row);
			affectedDates.add(normalized.entry.date);
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

		if (affectedDates.size > 0) {
			await dedupeZaimAndMoneyforward([...affectedDates]);
		}

		const dataSourceRef = db.collection('dataSources').doc(DATA_SOURCE_ID);
		const existingDataSource = await dataSourceRef.get();
		await dataSourceRef.set(
			{
				type: DATA_SOURCE_ID,
				displayName: 'Moneyforward (手動CSVインポート)',
				category: 'finance',
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

		logInfo(`Imported ${normalizedEntries.length} Moneyforward transactions.`);
		return {imported: normalizedEntries.length};
	},
);
