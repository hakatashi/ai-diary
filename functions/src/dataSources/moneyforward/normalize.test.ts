import {expect, test} from 'vitest';
import {normalizeMoneyforwardRow} from './normalize.ts';

test('normalizeMoneyforwardRow maps a payment row', () => {
	const {entry} = normalizeMoneyforwardRow({
		id: 'YAzlnafo1Ki9-sUiwJ23mTw4g9WTignaSCGmYHD46t4',
		date: '2026/07/31',
		content: 'セブン-イレブン松戸南花島4丁目店',
		amountYen: -194,
		account: 'みんなの銀行',
		majorCategory: '食費',
		minorCategory: '食料品',
		memo: '',
		isTransfer: false,
		calcTarget: true,
	});

	expect(entry.sourceType).toBe('moneyforward_transaction');
	expect(entry.category).toBe('finance');
	expect(entry.date).toBe('2026-07-31');
	expect(entry.title).toBe('セブン-イレブン松戸南花島4丁目店');
	expect(entry.summary).toBeNull();
	expect(entry.finance).toEqual({
		amountYen: -194,
		majorCategory: '食費',
		minorCategory: '食料品',
		sourceMajorCategory: '食費',
		sourceMinorCategory: '食料品',
		account: 'みんなの銀行',
		isTransfer: false,
		matchedRuleId: null,
	});
});

test('normalizeMoneyforwardRow forces the transfer category and drops the minor category', () => {
	const {entry} = normalizeMoneyforwardRow({
		id: 'PlNGE98FS2TYeRXY3MwfjI6AANRDllMSw-3o56GlagU',
		date: '2026/07/27',
		content: 'ミツイスミトモカ-ド (カ',
		amountYen: -113843,
		account: 'みずほ銀行',
		majorCategory: '現金・カード',
		minorCategory: 'カード引き落とし',
		memo: '',
		isTransfer: true,
		calcTarget: false,
	});

	expect(entry.finance?.isTransfer).toBe(true);
	expect(entry.finance?.majorCategory).toBe('振替');
	expect(entry.finance?.minorCategory).toBeNull();
});

test('normalizeMoneyforwardRow excludes calcTarget=false rows from totals without forcing the transfer category', () => {
	const {entry} = normalizeMoneyforwardRow({
		id: 'reimbursement-1',
		date: '2026/07/15',
		content: '立て替え精算',
		amountYen: -5000,
		account: 'みんなの銀行',
		majorCategory: '仕事',
		minorCategory: '経費',
		memo: '',
		isTransfer: false,
		calcTarget: false,
	});

	expect(entry.finance?.isTransfer).toBe(true);
	// 振替ではないため、大項目・中項目は元のカテゴリのまま(「振替」に上書きしない)。
	expect(entry.finance?.majorCategory).toBe('仕事');
	expect(entry.finance?.minorCategory).toBe('経費');
});

test('normalizeMoneyforwardRow produces a deterministic id for the same CSV ID', () => {
	const row = {
		id: 'same-id',
		date: '2026/08/01',
		content: 'test',
		amountYen: -100,
		account: 'test',
		majorCategory: '未分類',
		minorCategory: '未分類',
		memo: '',
		isTransfer: false,
		calcTarget: true,
	};
	const first = normalizeMoneyforwardRow(row);
	const second = normalizeMoneyforwardRow(row);
	expect(first.id).toBe(second.id);
});
