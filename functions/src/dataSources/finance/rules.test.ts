import {Timestamp} from 'firebase-admin/firestore';
import {expect, test} from 'vitest';
import type {FinanceDetails} from '../../../../src/lib/schema.ts';
import {applyFinanceRules, type LoadedFinanceRule} from './rules.ts';

const baseFinance: FinanceDetails = {
	amountYen: -100,
	majorCategory: '食費',
	minorCategory: '食費',
	sourceMajorCategory: '食費',
	sourceMinorCategory: '食費',
	account: 'モバイルPASMO',
	isTransfer: false,
	matchedRuleId: null,
};

const rule = (overrides: Partial<LoadedFinanceRule>): LoadedFinanceRule => ({
	id: 'rule-1',
	account: null,
	amountYen: null,
	descriptionContains: null,
	assignedMajorCategory: '趣味・娯楽',
	assignedMinorCategory: 'ゲームセンター',
	createdAt: Timestamp.now(),
	updatedAt: Timestamp.now(),
	...overrides,
});

test('applyFinanceRules reassigns category when account, amount, and description all match', () => {
	const result = applyFinanceRules(baseFinance, '物販', [
		rule({
			account: 'モバイルPASMO',
			amountYen: -100,
			descriptionContains: '物販',
		}),
	]);

	expect(result.majorCategory).toBe('趣味・娯楽');
	expect(result.minorCategory).toBe('ゲームセンター');
	expect(result.matchedRuleId).toBe('rule-1');
});

test('applyFinanceRules skips a rule when any condition does not match', () => {
	const result = applyFinanceRules(baseFinance, '物販', [
		rule({account: '財布', amountYen: -100, descriptionContains: '物販'}),
	]);

	expect(result.majorCategory).toBe(baseFinance.sourceMajorCategory);
	expect(result.matchedRuleId).toBeNull();
});

test('applyFinanceRules falls back to source category when no rule matches', () => {
	const result = applyFinanceRules(baseFinance, '物販', []);

	expect(result.majorCategory).toBe('食費');
	expect(result.minorCategory).toBe('食費');
	expect(result.matchedRuleId).toBeNull();
});

test('applyFinanceRules always recomputes from source fields, ignoring a stale effective category', () => {
	const alreadyRewritten: FinanceDetails = {
		...baseFinance,
		majorCategory: 'その他',
		minorCategory: 'その他',
		matchedRuleId: 'stale-rule',
	};

	const result = applyFinanceRules(alreadyRewritten, '物販', []);

	expect(result.majorCategory).toBe(baseFinance.sourceMajorCategory);
	expect(result.matchedRuleId).toBeNull();
});

test('applyFinanceRules uses the first matching rule in array order', () => {
	const result = applyFinanceRules(baseFinance, '物販', [
		rule({id: 'first', assignedMajorCategory: '第一'}),
		rule({id: 'second', assignedMajorCategory: '第二'}),
	]);

	expect(result.matchedRuleId).toBe('first');
	expect(result.majorCategory).toBe('第一');
});
