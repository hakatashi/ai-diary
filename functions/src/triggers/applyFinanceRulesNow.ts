import {HttpsError, onCall} from 'firebase-functions/https';
import {applyFinanceRulesToDates} from '../dataSources/finance/applyRulesToRange';
import {assertOwner} from '../lib/assertOwner';
import {enumerateDates} from '../lib/dateRange';

const REGION = 'asia-northeast1';

interface ApplyFinanceRulesRequest {
	dateFrom: string;
	dateTo: string;
}

// financeRulesを追加・変更した後、過去に同期・インポート済みの家計簿データへ再適用するための
// 手動メンテナンス用Callable(dedupeLogEntriesNowと同じ日付範囲指定方式)。
export const applyFinanceRulesNow = onCall<ApplyFinanceRulesRequest>(
	{region: REGION},
	async (request) => {
		assertOwner(request);

		const {dateFrom, dateTo} = request.data ?? {};
		if (!dateFrom || !dateTo) {
			throw new HttpsError(
				'invalid-argument',
				'dateFrom and dateTo are required.',
			);
		}

		const updated = await applyFinanceRulesToDates(
			enumerateDates(dateFrom, dateTo),
		);
		return {status: 'ok', updated};
	},
);
