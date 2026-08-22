import {info as logInfo} from 'firebase-functions/logger';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import {mapWithConcurrency} from '../../lib/concurrency';
import {db} from '../../lib/firebaseAdmin';
import {applyFinanceRules, loadFinanceRules} from './rules';

// 日付ごとのクエリを逐次awaitすると対象日数に比例して処理時間が伸びるため、
// 同時実行数を上げて待ち時間を短縮する(dedupeZaimAndMoneyforward.tsと同じ方式)。
const CONCURRENCY = 20;
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;
const FINANCE_SOURCE_TYPES = ['zaim_money', 'moneyforward_transaction'];

/**
 * financeRulesを追加・変更した後、指定した日付群の既存finance系logEntriesへ再適用する。
 * `date == X` と `sourceType in [...]` はいずれも等価系フィルタのため複合インデックス不要
 * (実接続で確認済み)。日付範囲全体を無条件クエリすると対象外カテゴリのドキュメントまで
 * 読み込んでしまうため、日付ごとに sourceType で絞り込んだクエリを発行する。
 * applyFinanceRulesは常にsourceMajorCategory/sourceMinorCategoryを起点に再計算するため、
 * 何度実行しても結果は収束する(冪等)。
 */
export const applyFinanceRulesToDates = async (
	dates: string[],
): Promise<number> => {
	const uniqueDates = [...new Set(dates)];
	const rules = await loadFinanceRules();

	const updates: {
		ref: FirebaseFirestore.DocumentReference;
		finance: LogEntry['finance'];
	}[] = [];

	await mapWithConcurrency(uniqueDates, CONCURRENCY, async (date) => {
		const snapshot = await db
			.collection('logEntries')
			.where('date', '==', date)
			.where('sourceType', 'in', FINANCE_SOURCE_TYPES)
			.get();

		for (const doc of snapshot.docs) {
			const data = doc.data() as LogEntry;
			if (!data.finance) {
				continue;
			}
			const recomputed = applyFinanceRules(data.finance, data.title, rules);
			if (
				recomputed.majorCategory !== data.finance.majorCategory ||
				recomputed.minorCategory !== data.finance.minorCategory ||
				recomputed.matchedRuleId !== data.finance.matchedRuleId
			) {
				updates.push({ref: doc.ref, finance: recomputed});
			}
		}
	});

	for (let i = 0; i < updates.length; i += MAX_OPS_PER_COMMIT) {
		const batch = db.batch();
		for (const {ref, finance} of updates.slice(i, i + MAX_OPS_PER_COMMIT)) {
			batch.set(ref, {finance}, {merge: true});
		}
		await batch.commit();
	}

	if (updates.length > 0) {
		logInfo(`Reapplied finance rules to ${updates.length} log entries.`);
	}
	return updates.length;
};
