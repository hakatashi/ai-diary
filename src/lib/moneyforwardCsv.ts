// Moneyforward「収入・支出詳細」CSVエクスポート(Shift_JIS)のパーサ。
// デコードは呼び出し側で `new TextDecoder('shift_jis')`(WHATWG Encoding Standardの
// ラベル、追加ライブラリ不要)を使う想定で、このモジュールはデコード後の文字列を扱う。
// クォート・カンマのみの単純な形式のため外部CSVライブラリは追加しない。

export interface MoneyforwardCsvRow {
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
	isTransfer: boolean;
	/** 「計算対象」列。falseの場合、Moneyforward側で集計対象から除外されている(振替とは別軸)。 */
	calcTarget: boolean;
}

const EXPECTED_HEADER = [
	'計算対象',
	'日付',
	'内容',
	'金額（円）',
	'保有金融機関',
	'大項目',
	'中項目',
	'メモ',
	'振替',
	'ID',
];

const parseCsvLine = (line: string): string[] => {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (inQuotes) {
			if (char === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			fields.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	fields.push(current);
	return fields;
};

export const parseMoneyforwardCsv = (text: string): MoneyforwardCsvRow[] => {
	const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
	if (lines.length === 0) {
		return [];
	}

	const header = parseCsvLine(lines[0]);
	const headerMatches =
		header.length === EXPECTED_HEADER.length &&
		header.every((field, index) => field === EXPECTED_HEADER[index]);
	if (!headerMatches) {
		throw new Error(
			'Moneyforward CSVの形式が想定と異なります(ヘッダ列を確認してください)。',
		);
	}

	return lines.slice(1).map((line) => {
		const fields = parseCsvLine(line);
		const [
			calcTarget,
			date,
			content,
			amount,
			account,
			majorCategory,
			minorCategory,
			memo,
			transfer,
			id,
		] = fields;
		return {
			id,
			date,
			content,
			amountYen: Number(amount),
			account,
			majorCategory,
			minorCategory,
			memo,
			isTransfer: transfer === '1',
			calcTarget: calcTarget === '1',
		};
	});
};
