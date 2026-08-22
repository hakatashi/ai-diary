const MAX_DATE_RANGE_DAYS = 366;

/** dateFromからdateToまでの日付("YYYY-MM-DD")を昇順で列挙する。暴走防止のため最大366日分まで。 */
export const enumerateDates = (dateFrom: string, dateTo: string): string[] => {
	const dates: string[] = [];
	const current = new Date(`${dateFrom}T00:00:00Z`);
	const end = new Date(`${dateTo}T00:00:00Z`);
	while (current <= end && dates.length < MAX_DATE_RANGE_DAYS) {
		dates.push(current.toISOString().slice(0, 10));
		current.setUTCDate(current.getUTCDate() + 1);
	}
	return dates;
};
