import {createGoogleOAuthFlow, REGION} from '../../lib/googleOAuth';

export {REGION};
export const DATA_SOURCE_ID = 'google_health';
const SCOPE =
	'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';

const flow = createGoogleOAuthFlow({
	dataSourceId: DATA_SOURCE_ID,
	displayName: 'Google Health (運動記録)',
	category: 'fitness',
	scope: SCOPE,
	callbackFunctionName: 'googleHealthOAuthCallback',
});

export const beginGoogleHealthOAuth = flow.beginOAuth;
export const googleHealthOAuthCallback = flow.oauthCallback;
