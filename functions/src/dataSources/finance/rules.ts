import type {FinanceDetails, FinanceRule} from '../../../../src/lib/schema.ts';
import {db} from '../../lib/firebaseAdmin';

export type LoadedFinanceRule = FinanceRule & {id: string};

export const loadFinanceRules = async (): Promise<LoadedFinanceRule[]> => {
	const snapshot = await db
		.collection('financeRules')
		.orderBy('createdAt', 'asc')
		.get();
	return snapshot.docs.map(
		(doc) =>
			({id: doc.id, ...(doc.data() as FinanceRule)}) as LoadedFinanceRule,
	);
};

/**
 * ルールを常に sourceMajorCategory/sourceMinorCategory を起点に再計算する(既存の実効
 * カテゴリを起点にしない)ことで、ルールを追加・変更した後に再適用しても結果が発散しない
 * ようにしている。作成順(createdAt昇順)で最初に条件を満たしたルールを採用する単純な
 * 先勝ちで、優先度の並べ替えはサポートしない(docs/adr/0013参照)。
 */
export const applyFinanceRules = (
	finance: FinanceDetails,
	title: string,
	rules: LoadedFinanceRule[],
): FinanceDetails => {
	for (const rule of rules) {
		if (rule.account !== null && rule.account !== finance.account) {
			continue;
		}
		if (rule.amountYen !== null && rule.amountYen !== finance.amountYen) {
			continue;
		}
		if (
			rule.descriptionContains !== null &&
			!title.includes(rule.descriptionContains)
		) {
			continue;
		}
		return {
			...finance,
			majorCategory: rule.assignedMajorCategory,
			minorCategory: rule.assignedMinorCategory,
			matchedRuleId: rule.id,
		};
	}
	return {
		...finance,
		majorCategory: finance.sourceMajorCategory,
		minorCategory: finance.sourceMinorCategory,
		matchedRuleId: null,
	};
};
