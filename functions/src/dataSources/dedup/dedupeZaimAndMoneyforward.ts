import {info as logInfo} from 'firebase-functions/logger';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import {mapWithConcurrency} from '../../lib/concurrency';
import {db} from '../../lib/firebaseAdmin';

// 日付ごとのクエリを逐次awaitすると対象日数に比例して処理時間が伸びるため、
// 同時実行数を上げて待ち時間を短縮する。
const DEDUPE_CONCURRENCY = 20;
// 1コミットあたりのFirestore書き込み上限(500)に対して余裕を持たせる。
const MAX_OPS_PER_COMMIT = 450;

/**
 * 指定した日付群について、Zaim(手動記録、sourceType: zaim_money)とMoneyforward
 * (自動記録、sourceType: moneyforward_transaction)が同一取引を指していると判定できる
 * 場合、Moneyforward側を hidden にして dedupedInto に統合先(Zaim側)を記録する。
 * Zaimは手動入力で品目・場所等の詳細を持つため常にZaim側を残す。どちらのエントリも
 * 削除はしない(生データは保持する)。
 *
 * 判定は「同一日付・同額(finance.amountYen完全一致)」のみで、位置情報のような連続値の
 * マッチングは行わない。同額候補が複数ある場合は口座名(finance.account)が一致するものを
 * 優先する。振替(finance.isTransfer)は対象外。
 */
export const dedupeZaimAndMoneyforward = async (
	dates: string[],
): Promise<void> => {
	const uniqueDates = [...new Set(dates)];

	const pendingWrites: {
		ref: FirebaseFirestore.DocumentReference;
		dedupedInto: string;
	}[] = [];

	await mapWithConcurrency(uniqueDates, DEDUPE_CONCURRENCY, async (date) => {
		const [zaimSnap, moneyforwardSnap] = await Promise.all([
			db
				.collection('logEntries')
				.where('date', '==', date)
				.where('sourceType', '==', 'zaim_money')
				.get(),
			db
				.collection('logEntries')
				.where('date', '==', date)
				.where('sourceType', '==', 'moneyforward_transaction')
				.get(),
		]);

		const zaimEntries = zaimSnap.docs
			.map((doc) => ({id: doc.id, data: doc.data() as LogEntry}))
			.filter(({data}) => !data.hidden && !data.finance?.isTransfer);

		const moneyforwardDocs = moneyforwardSnap.docs.filter((doc) => {
			const data = doc.data() as LogEntry;
			return !data.hidden && !data.dedupedInto && !data.finance?.isTransfer;
		});

		const usedZaimIds = new Set<string>();
		for (const moneyforwardDoc of moneyforwardDocs) {
			const moneyforwardData = moneyforwardDoc.data() as LogEntry;
			const amount = moneyforwardData.finance?.amountYen;
			if (amount === undefined) {
				continue;
			}

			const candidates = zaimEntries.filter(
				(zaim) =>
					!usedZaimIds.has(zaim.id) && zaim.data.finance?.amountYen === amount,
			);
			if (candidates.length === 0) {
				continue;
			}

			const exactAccountMatch = candidates.find(
				(zaim) =>
					zaim.data.finance?.account &&
					zaim.data.finance.account === moneyforwardData.finance?.account,
			);
			const match = exactAccountMatch ?? candidates[0];
			usedZaimIds.add(match.id);
			pendingWrites.push({ref: moneyforwardDoc.ref, dedupedInto: match.id});
		}
	});

	for (let i = 0; i < pendingWrites.length; i += MAX_OPS_PER_COMMIT) {
		const batch = db.batch();
		for (const {ref, dedupedInto} of pendingWrites.slice(
			i,
			i + MAX_OPS_PER_COMMIT,
		)) {
			batch.set(ref, {hidden: true, dedupedInto}, {merge: true});
		}
		await batch.commit();
	}

	if (pendingWrites.length > 0) {
		logInfo(
			`Deduped ${pendingWrites.length} Moneyforward transactions across ${uniqueDates.length} dates.`,
		);
	}
};
