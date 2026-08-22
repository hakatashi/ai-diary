import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';
import type {
	ZaimAccount,
	ZaimCategory,
	ZaimGenre,
	ZaimMoneyRecord,
} from './client';

export interface ZaimCategoryMaps {
	categoryNames: Map<number, string>;
	genreNames: Map<number, string>;
	accountNames: Map<number, string>;
}

export const buildCategoryMaps = (
	categories: ZaimCategory[],
	genres: ZaimGenre[],
	accounts: ZaimAccount[],
): ZaimCategoryMaps => ({
	categoryNames: new Map(
		categories.map((category) => [category.id, category.name]),
	),
	genreNames: new Map(genres.map((genre) => [genre.id, genre.name])),
	accountNames: new Map(accounts.map((account) => [account.id, account.name])),
});

export interface NormalizedZaimMoney {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

export const normalizeZaimMoneyRecord = (
	raw: ZaimMoneyRecord,
	maps: ZaimCategoryMaps,
): NormalizedZaimMoney => {
	const isTransfer = raw.mode === 'transfer';
	const majorCategory = isTransfer
		? '振替'
		: (maps.categoryNames.get(raw.category_id) ?? '未分類');
	const minorCategory = isTransfer
		? null
		: (maps.genreNames.get(raw.genre_id) ?? null);
	// payment: from_account_idが支払い元、income: to_account_idが入金先。
	// transferはfrom側を代表口座として使う(集計対象外のためどちらでも実害はない)。
	const accountId =
		raw.mode === 'income' ? raw.to_account_id : raw.from_account_id;
	const account = accountId ? (maps.accountNames.get(accountId) ?? null) : null;
	const amountYen = raw.mode === 'income' ? raw.amount : -raw.amount;

	const startDate = new Date(`${raw.date}T00:00:00+09:00`);
	const title = raw.place || raw.name || majorCategory;

	// ドキュメントIDはZaimのmoney idから決定的に生成し、再同期時に冪等なupsertになるようにする
	// (ADR-0003準拠)。
	const id = createHash('sha256').update(`zaim_money:${raw.id}`).digest('hex');

	return {
		id,
		entry: {
			sourceType: 'zaim_money',
			category: 'finance',
			date: raw.date,
			startAt: Timestamp.fromDate(startDate),
			endAt: null,
			title,
			summary: raw.comment || null,
			metrics: null,
			location: null,
			finance: {
				amountYen,
				majorCategory,
				minorCategory,
				sourceMajorCategory: majorCategory,
				sourceMinorCategory: minorCategory,
				account,
				itemName: raw.name || null,
				isTransfer,
				matchedRuleId: null,
			},
			raw: raw as unknown as Record<string, unknown>,
			sourceRecordId: String(raw.id),
		},
	};
};
