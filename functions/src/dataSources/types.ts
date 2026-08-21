import type {Timestamp} from 'firebase-admin/firestore';

export interface DataSourceSecretPayload {
	refreshToken?: string;
	accessToken?: string;
	scope?: string;
	/** api_key型データソース(Immich等)のAPIキー。 */
	apiKey?: string;
	/** api_key型データソースの接続先サーバーURL(例: ImmichのAPIベースURL)。 */
	serverUrl?: string;
}

export interface DataSourceSecret {
	credentialType:
		| 'oauth2_refresh_token'
		| 'oauth2_access_token'
		| 'api_key'
		| 'basic_auth';
	payload: DataSourceSecretPayload;
	updatedAt: Timestamp;
}

export interface OAuthState {
	dataSourceId: string;
	createdAt: Timestamp;
}
