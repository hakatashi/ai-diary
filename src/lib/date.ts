const TIME_ZONE = 'Asia/Tokyo';

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

export const getTodayDateString = (): string =>
	dateFormatter.format(new Date());

export const shiftDateString = (date: string, days: number): string => {
	const [year, month, day] = date.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, day));
	shifted.setUTCDate(shifted.getUTCDate() + days);
	return shifted.toISOString().slice(0, 10);
};

export const isValidDateString = (date: string): boolean =>
	/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));

const journalDateFormatter = new Intl.DateTimeFormat('ja-JP', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: 'long',
	day: 'numeric',
	weekday: 'short',
});

export const formatJournalDate = (date: string): string => {
	const [year, month, day] = date.split('-').map(Number);
	return journalDateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
};

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
	timeZone: TIME_ZONE,
	hour: '2-digit',
	minute: '2-digit',
});

export const formatTime = (date: Date): string => timeFormatter.format(date);

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
});

export const formatDateTime = (date: Date): string =>
	dateTimeFormatter.format(date);

export const getCurrentMonthString = (): string =>
	getTodayDateString().slice(0, 7);

export const isValidMonthString = (month: string): boolean =>
	/^\d{4}-\d{2}$/.test(month);

export const shiftMonthString = (month: string, delta: number): string => {
	const [year, monthIndex] = month.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
	return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
};

const monthLabelFormatter = new Intl.DateTimeFormat('ja-JP', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: 'long',
});

export const formatMonthLabel = (month: string): string => {
	const [year, monthIndex] = month.split('-').map(Number);
	return monthLabelFormatter.format(
		new Date(Date.UTC(year, monthIndex - 1, 1)),
	);
};

/** 指定した月の全日付("YYYY-MM-DD")を昇順で返す。 */
export const getDaysInMonth = (month: string): string[] => {
	const [year, monthIndex] = month.split('-').map(Number);
	const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
	return Array.from(
		{length: daysInMonth},
		(_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
	);
};

/** 日曜日を0とする曜日インデックスを返す。 */
export const getWeekdayIndex = (date: string): number => {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};
