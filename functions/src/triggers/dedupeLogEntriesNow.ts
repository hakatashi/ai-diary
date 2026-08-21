import {HttpsError, onCall} from 'firebase-functions/https';
import {dedupeVisitsAndCheckins} from '../dataSources/dedup/dedupeVisitsAndCheckins';
import {assertOwner} from '../lib/assertOwner';

const REGION = 'asia-northeast1';
const MAX_DATE_RANGE_DAYS = 366;

interface DedupeRequest {
	dateFrom: string;
	dateTo: string;
}

const enumerateDates = (dateFrom: string, dateTo: string): string[] => {
	const dates: string[] = [];
	const current = new Date(`${dateFrom}T00:00:00Z`);
	const end = new Date(`${dateTo}T00:00:00Z`);
	while (current <= end && dates.length < MAX_DATE_RANGE_DAYS) {
		dates.push(current.toISOString().slice(0, 10));
		current.setUTCDate(current.getUTCDate() + 1);
	}
	return dates;
};

// Google Maps訪問記録とSwarmチェックインの重複統合を、指定した日付範囲で
// 手動再実行するためのメンテナンス用Callable。
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

		return {status: 'ok', datesProcessed: dates.length};
	},
);
