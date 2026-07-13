import {createGoogleOAuthFlow, REGION} from '../../lib/googleOAuth';

export {REGION};
export const DATA_SOURCE_ID = 'google_photos';
const SCOPE = 'https://www.googleapis.com/auth/photospicker.readonly';

const flow = createGoogleOAuthFlow({
	dataSourceId: DATA_SOURCE_ID,
	displayName: 'Google Photos (手動インポート)',
	category: 'photo',
	scope: SCOPE,
	callbackFunctionName: 'googlePhotosOAuthCallback',
});

export const beginGooglePhotosOAuth = flow.beginOAuth;
export const googlePhotosOAuthCallback = flow.oauthCallback;
