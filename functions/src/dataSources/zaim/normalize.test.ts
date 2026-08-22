import {expect, test} from 'vitest';
import {buildCategoryMaps, normalizeZaimMoneyRecord} from './normalize.ts';

const maps = buildCategoryMaps(
	[{id: 101, name: '食費', mode: 'payment'}],
	[{id: 10101, name: '食料品', category_id: 101}],
	[
		{id: 1, name: 'モバイルPASMO'},
		{id: 2, name: '財布'},
	],
);

test('normalizeZaimMoneyRecord maps a payment record to a negative amount', () => {
	const {entry} = normalizeZaimMoneyRecord(
		{
			id: 381,
			mode: 'payment',
			date: '2026-07-31',
			category_id: 101,
			genre_id: 10101,
			from_account_id: 1,
			to_account_id: 0,
			amount: 100,
			comment: 'メモ',
			name: '',
			place: 'サブウェイ',
			currency_code: 'JPY',
		},
		maps,
	);

	expect(entry.sourceType).toBe('zaim_money');
	expect(entry.category).toBe('finance');
	expect(entry.date).toBe('2026-07-31');
	expect(entry.title).toBe('サブウェイ');
	expect(entry.summary).toBe('メモ');
	expect(entry.finance).toEqual({
		amountYen: -100,
		majorCategory: '食費',
		minorCategory: '食料品',
		sourceMajorCategory: '食費',
		sourceMinorCategory: '食料品',
		account: 'モバイルPASMO',
		isTransfer: false,
		matchedRuleId: null,
	});
});

test('normalizeZaimMoneyRecord maps an income record to a positive amount using to_account_id', () => {
	const {entry} = normalizeZaimMoneyRecord(
		{
			id: 382,
			mode: 'income',
			date: '2026-08-01',
			category_id: 11,
			genre_id: 0,
			from_account_id: 0,
			to_account_id: 2,
			amount: 10000,
			comment: '',
			name: '給与',
			place: '',
			currency_code: 'JPY',
		},
		maps,
	);

	expect(entry.finance?.amountYen).toBe(10000);
	expect(entry.finance?.account).toBe('財布');
	expect(entry.title).toBe('給与');
});

test('normalizeZaimMoneyRecord flags transfers and excludes them from category resolution', () => {
	const {entry} = normalizeZaimMoneyRecord(
		{
			id: 383,
			mode: 'transfer',
			date: '2026-08-02',
			category_id: 0,
			genre_id: 0,
			from_account_id: 1,
			to_account_id: 2,
			amount: 5000,
			comment: '',
			name: '',
			place: '',
			currency_code: 'JPY',
		},
		maps,
	);

	expect(entry.finance?.isTransfer).toBe(true);
	expect(entry.finance?.majorCategory).toBe('振替');
	expect(entry.finance?.minorCategory).toBeNull();
});

test('normalizeZaimMoneyRecord produces a deterministic id for the same money id', () => {
	const record = {
		id: 999,
		mode: 'payment' as const,
		date: '2026-08-01',
		category_id: 101,
		genre_id: 10101,
		from_account_id: 1,
		to_account_id: 0,
		amount: 300,
		comment: '',
		name: '',
		place: '',
		currency_code: 'JPY',
	};
	const first = normalizeZaimMoneyRecord(record, maps);
	const second = normalizeZaimMoneyRecord(record, maps);
	expect(first.id).toBe(second.id);
});
