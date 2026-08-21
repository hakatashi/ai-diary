import {createGoogleOAuthFlow, REGION} from '../../lib/googleOAuth';

export {REGION};
export const DATA_SOURCE_ID = 'google_health';
// exportExerciseTcx(GPSトラック取得)には activity_and_fitness に加えて
// location スコープが別途必要(実接続調査で判明。詳細はAGENTS.md参照)。
const SCOPES = [
	'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
	'https://www.googleapis.com/auth/googlehealth.location.readonly',
];

const flow = createGoogleOAuthFlow({
	dataSourceId: DATA_SOURCE_ID,
	displayName: 'Google Health (運動記録)',
	category: 'fitness',
	scope: SCOPES,
	callbackFunctionName: 'googleHealthOAuthCallback',
});

export const beginGoogleHealthOAuth = flow.beginOAuth;
export const googleHealthOAuthCallback = flow.oauthCallback;
