import type {Timestamp} from 'firebase-admin/firestore';

export interface DataSourceSecretPayload {
	refreshToken: string;
	scope: string;
}

export interface DataSourceSecret {
	credentialType: 'oauth2_refresh_token' | 'api_key' | 'basic_auth';
	payload: DataSourceSecretPayload;
	updatedAt: Timestamp;
}

export interface OAuthState {
	dataSourceId: string;
	createdAt: Timestamp;
}
