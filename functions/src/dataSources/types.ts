import type {Timestamp} from 'firebase-admin/firestore';

export interface DataSourceSecretPayload {
	refreshToken?: string;
	accessToken?: string;
	scope?: string;
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
