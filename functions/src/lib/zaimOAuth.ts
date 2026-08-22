import {createHmac, randomBytes} from 'node:crypto';

// ZaimはOAuth 1.0a(3-legged)。エンドポイントは docs/adr/0013-zaim-moneyforward-finance-integration.md
// に記載の通り実接続で未検証(公開されているZaim API仕様に基づく実装)。
const REQUEST_TOKEN_URL = 'https://api.zaim.net/v2/auth/request';
const AUTHORIZE_URL = 'https://auth.zaim.net/users/auth';
const ACCESS_TOKEN_URL = 'https://api.zaim.net/v2/auth/access';

// RFC 3986準拠のパーセントエンコード(encodeURIComponentは!*'()をエンコードしないため補完する)。
const percentEncode = (value: string): string =>
	encodeURIComponent(value).replace(
		/[!*'()]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);

interface OAuthCredentials {
	consumerKey: string;
	consumerSecret: string;
	token?: string;
	tokenSecret?: string;
}

/** OAuth 1.0a の signature base string を組み立てて HMAC-SHA1 で署名し、Authorization ヘッダを返す。 */
const buildAuthHeader = (
	method: string,
	url: string,
	extraParams: Record<string, string>,
	credentials: OAuthCredentials,
): string => {
	const oauthParams: Record<string, string> = {
		oauth_consumer_key: credentials.consumerKey,
		oauth_nonce: randomBytes(16).toString('hex'),
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: String(Math.floor(Date.now() / 1000)),
		oauth_version: '1.0',
		...(credentials.token ? {oauth_token: credentials.token} : {}),
	};

	const allParams = {...oauthParams, ...extraParams};
	const baseString = [
		method.toUpperCase(),
		percentEncode(url),
		percentEncode(
			Object.keys(allParams)
				.sort()
				.map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
				.join('&'),
		),
	].join('&');

	const signingKey = `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.tokenSecret ?? '')}`;
	const signature = createHmac('sha1', signingKey)
		.update(baseString)
		.digest('base64');

	// oauth_で始まるパラメータ(oauth_callback/oauth_verifier等)はAuthorizationヘッダにも
	// 含める必要がある(署名の計算に使うだけでは不十分。省略するとサーバー側の署名検証が
	// 一致せず401になる。実接続で確認済み)。mapping/start_date等の非oauth_パラメータは
	// クエリ文字列側に載るためヘッダには含めない。
	const headerParams: Record<string, string> = {
		...Object.fromEntries(
			Object.entries(allParams).filter(([key]) => key.startsWith('oauth_')),
		),
		oauth_signature: signature,
	};
	return `OAuth ${Object.keys(headerParams)
		.map((key) => `${percentEncode(key)}="${percentEncode(headerParams[key])}"`)
		.join(', ')}`;
};

const parseFormBody = (text: string): Record<string, string> =>
	Object.fromEntries(new URLSearchParams(text));

export const obtainRequestToken = async (
	consumerKey: string,
	consumerSecret: string,
	callbackUrl: string,
): Promise<{oauthToken: string; oauthTokenSecret: string}> => {
	const authHeader = buildAuthHeader(
		'POST',
		REQUEST_TOKEN_URL,
		{oauth_callback: callbackUrl},
		{consumerKey, consumerSecret},
	);
	const response = await fetch(REQUEST_TOKEN_URL, {
		method: 'POST',
		headers: {Authorization: authHeader},
	});
	if (!response.ok) {
		throw new Error(
			`Zaim request token failed: ${response.status} ${await response.text()}`,
		);
	}
	const body = parseFormBody(await response.text());
	if (!body.oauth_token || !body.oauth_token_secret) {
		throw new Error('Zaim request token response is missing oauth_token.');
	}
	return {
		oauthToken: body.oauth_token,
		oauthTokenSecret: body.oauth_token_secret,
	};
};

export const buildZaimAuthorizeUrl = (oauthToken: string): string =>
	`${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(oauthToken)}`;

export const exchangeAccessToken = async (
	consumerKey: string,
	consumerSecret: string,
	oauthToken: string,
	oauthTokenSecret: string,
	verifier: string,
): Promise<{accessToken: string; accessTokenSecret: string}> => {
	const authHeader = buildAuthHeader(
		'POST',
		ACCESS_TOKEN_URL,
		{oauth_verifier: verifier},
		{
			consumerKey,
			consumerSecret,
			token: oauthToken,
			tokenSecret: oauthTokenSecret,
		},
	);
	const response = await fetch(ACCESS_TOKEN_URL, {
		method: 'POST',
		headers: {Authorization: authHeader},
	});
	if (!response.ok) {
		throw new Error(
			`Zaim access token exchange failed: ${response.status} ${await response.text()}`,
		);
	}
	const body = parseFormBody(await response.text());
	if (!body.oauth_token || !body.oauth_token_secret) {
		throw new Error('Zaim access token response is missing oauth_token.');
	}
	return {
		accessToken: body.oauth_token,
		accessTokenSecret: body.oauth_token_secret,
	};
};

export interface ZaimAccessCredentials {
	consumerKey: string;
	consumerSecret: string;
	accessToken: string;
	accessTokenSecret: string;
}

/** 署名付きでZaim APIをGET呼び出しし、JSONレスポンスを返す。 */
export const zaimSignedGet = async (
	url: string,
	queryParams: Record<string, string>,
	credentials: ZaimAccessCredentials,
): Promise<unknown> => {
	const authHeader = buildAuthHeader('GET', url, queryParams, {
		consumerKey: credentials.consumerKey,
		consumerSecret: credentials.consumerSecret,
		token: credentials.accessToken,
		tokenSecret: credentials.accessTokenSecret,
	});
	const queryString = new URLSearchParams(queryParams).toString();
	const fullUrl = queryString ? `${url}?${queryString}` : url;
	const response = await fetch(fullUrl, {
		method: 'GET',
		headers: {Authorization: authHeader},
	});
	if (!response.ok) {
		throw new Error(
			`Zaim API request failed: ${response.status} ${await response.text()}`,
		);
	}
	return response.json();
};
