import {expect, test} from 'vitest';
import {parseMoneyforwardCsv} from './moneyforwardCsv';

const SAMPLE_CSV = [
	'"計算対象","日付","内容","金額（円）","保有金融機関","大項目","中項目","メモ","振替","ID"',
	'"1","2026/07/31","セブン-イレブン松戸南花島4丁目店","-194","みんなの銀行","食費","食料品","","0","YAzlnafo1Ki9-sUiwJ23mTw4g9WTignaSCGmYHD46t4"',
	'"0","2026/07/27","ミツイスミトモカ-ド (カ","-113843","みずほ銀行","現金・カード","カード引き落とし","","1","PlNGE98FS2TYeRXY3MwfjI6AANRDllMSw-3o56GlagU"',
].join('\r\n');

test('parseMoneyforwardCsv parses rows after the header', () => {
	const rows = parseMoneyforwardCsv(SAMPLE_CSV);

	expect(rows).toHaveLength(2);
	expect(rows[0]).toEqual({
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
});

test('parseMoneyforwardCsv flags the transfer and calcTarget columns', () => {
	const rows = parseMoneyforwardCsv(SAMPLE_CSV);
	expect(rows[1].isTransfer).toBe(true);
	expect(rows[1].calcTarget).toBe(false);
	expect(rows[1].amountYen).toBe(-113843);
});

test('parseMoneyforwardCsv rejects a file with an unexpected header', () => {
	expect(() => parseMoneyforwardCsv('"foo","bar"\n"1","2"')).toThrow();
});

test('parseMoneyforwardCsv returns an empty array for an empty file', () => {
	expect(parseMoneyforwardCsv('')).toEqual([]);
});
