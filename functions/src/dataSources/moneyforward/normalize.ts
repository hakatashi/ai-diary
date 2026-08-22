import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';

// クライアント(src/lib/moneyforwardCsv.ts)でパース済みのCSV1行分。
export interface RawMoneyforwardRow {
	/** CSVの"ID"列。Moneyforward側で安定した一意キーのため sourceRecordId として使う。 */
	id: string;
	/** "YYYY/MM/DD"形式。 */
	date: string;
	content: string;
	/** 符号付き円額(支出は負、収入は正)。 */
	amountYen: number;
	account: string;
	majorCategory: string;
	minorCategory: string;
	memo: string;
	/** 振替(口座間移動)なら true。 */
	isTransfer: boolean;
	/** 「計算対象」列。falseの場合、Moneyforward側で集計対象から除外されている(振替とは別軸)。 */
	calcTarget: boolean;
}

export interface NormalizedMoneyforwardTransaction {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

const toDateString = (moneyforwardDate: string): string =>
	moneyforwardDate.split('/').join('-');

export const normalizeMoneyforwardRow = (
	raw: RawMoneyforwardRow,
): NormalizedMoneyforwardTransaction => {
	const date = toDateString(raw.date);
	const startDate = new Date(`${date}T00:00:00+09:00`);
	// 「計算対象」列がfalseの記録(Moneyforward側で集計除外されたもの。振替とは別軸)も、
	// finance.isTransferを流用して支出・収入の集計・重複統合の対象外にする。
	const excludedFromTotals = raw.isTransfer || !raw.calcTarget;
	const majorCategory = raw.isTransfer ? '振替' : raw.majorCategory;
	const minorCategory = raw.isTransfer ? null : raw.minorCategory || null;

	// ドキュメントIDはMoneyforward CSVのID列から決定的に生成し、再アップロード時に冪等な
	// upsertになるようにする(ADR-0003準拠)。
	const id = createHash('sha256')
		.update(`moneyforward_transaction:${raw.id}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'moneyforward_transaction',
			category: 'finance',
			date,
			startAt: Timestamp.fromDate(startDate),
			endAt: null,
			title: raw.content,
			summary: raw.memo || null,
			metrics: null,
			location: null,
			finance: {
				amountYen: raw.amountYen,
				majorCategory,
				minorCategory,
				sourceMajorCategory: majorCategory,
				sourceMinorCategory: minorCategory,
				account: raw.account || null,
				itemName: null,
				isTransfer: excludedFromTotals,
				matchedRuleId: null,
			},
			raw: raw as unknown as Record<string, unknown>,
			sourceRecordId: raw.id,
		},
	};
};
