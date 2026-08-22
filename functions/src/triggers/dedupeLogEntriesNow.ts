import {HttpsError, onCall} from 'firebase-functions/https';
import {dedupeVisitsAndCheckins} from '../dataSources/dedup/dedupeVisitsAndCheckins';
import {dedupeZaimAndMoneyforward} from '../dataSources/dedup/dedupeZaimAndMoneyforward';
import {assertOwner} from '../lib/assertOwner';
import {enumerateDates} from '../lib/dateRange';

const REGION = 'asia-northeast1';

interface DedupeRequest {
	dateFrom: string;
	dateTo: string;
}

// Google Maps訪問記録⇔Swarmチェックイン、Zaim記録⇔Moneyforward明細の重複統合を、
// 指定した日付範囲で手動再実行するためのメンテナンス用Callable。
export const dedupeLogEntriesNow = onCall<DedupeRequest>(
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

		const dates = enumerateDates(dateFrom, dateTo);
		await dedupeVisitsAndCheckins(dates);
		await dedupeZaimAndMoneyforward(dates);

		return {status: 'ok', datesProcessed: dates.length};
	},
);
