import {type ZaimAccessCredentials, zaimSignedGet} from '../../lib/zaimOAuth';

// 参照: testing/Zaim REST API Reference.html (API ver 2.1.0)
const BASE_URL = 'https://api.zaim.net/v2';

export interface ZaimMoneyRecord {
	id: number;
	mode: 'payment' | 'income' | 'transfer';
	date: string;
	category_id: number;
	genre_id: number;
	from_account_id: number;
	to_account_id: number;
	amount: number;
	comment: string;
	name: string;
	place: string;
	currency_code: string;
	[key: string]: unknown;
}

export interface ZaimCategory {
	id: number;
	name: string;
	mode: string;
}

export interface ZaimGenre {
	id: number;
	name: string;
	category_id: number;
}

export interface ZaimAccount {
	id: number;
	name: string;
}

export const getMoneyRecords = async (
	credentials: ZaimAccessCredentials,
	options: {startDate?: string; endDate?: string; page: number; limit: number},
): Promise<ZaimMoneyRecord[]> => {
	const params: Record<string, string> = {
		mapping: '1',
		page: String(options.page),
		limit: String(options.limit),
	};
	if (options.startDate) {
		params.start_date = options.startDate;
	}
	if (options.endDate) {
		params.end_date = options.endDate;
	}
	const body = (await zaimSignedGet(
		`${BASE_URL}/home/money`,
		params,
		credentials,
	)) as {
		money?: ZaimMoneyRecord[];
	};
	return body.money ?? [];
};

export const getCategories = async (
	credentials: ZaimAccessCredentials,
): Promise<ZaimCategory[]> => {
	const body = (await zaimSignedGet(
		`${BASE_URL}/home/category`,
		{mapping: '1'},
		credentials,
	)) as {categories?: ZaimCategory[]};
	return body.categories ?? [];
};

export const getGenres = async (
	credentials: ZaimAccessCredentials,
): Promise<ZaimGenre[]> => {
	const body = (await zaimSignedGet(
		`${BASE_URL}/home/genre`,
		{mapping: '1'},
		credentials,
	)) as {
		genres?: ZaimGenre[];
	};
	return body.genres ?? [];
};

export const getAccounts = async (
	credentials: ZaimAccessCredentials,
): Promise<ZaimAccount[]> => {
	const body = (await zaimSignedGet(
		`${BASE_URL}/home/account`,
		{mapping: '1'},
		credentials,
	)) as {accounts?: ZaimAccount[]};
	return body.accounts ?? [];
};

export const verifyUser = async (
	credentials: ZaimAccessCredentials,
): Promise<{login: string} | null> => {
	const body = (await zaimSignedGet(
		`${BASE_URL}/home/user/verify`,
		{},
		credentials,
	)) as {
		me?: {login?: string};
	};
	return body.me?.login ? {login: body.me.login} : null;
};
