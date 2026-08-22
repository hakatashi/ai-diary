import {createGoogleOAuthFlow, REGION} from '../../lib/googleOAuth';

export {REGION};
export const DATA_SOURCE_ID = 'google_health';
// exportExerciseTcx(GPSトラック取得)には activity_and_fitness に加えて
// location スコープが別途必要(実接続調査で判明。詳細はAGENTS.md参照)。
// 食事(nutrition)・睡眠(sleep)・体重(health_metrics_and_measurements)は
// それぞれ独立したスコープが必要(公式リファレンス https://developers.google.com/health/scopes 参照)。
const SCOPES = [
	'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
	'https://www.googleapis.com/auth/googlehealth.location.readonly',
	'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
	'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
	'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
];

const flow = createGoogleOAuthFlow({
	dataSourceId: DATA_SOURCE_ID,
	displayName: 'Google Health (運動・食事・睡眠・体重記録)',
	category: 'fitness',
	scope: SCOPES,
	callbackFunctionName: 'googleHealthOAuthCallback',
});

export const beginGoogleHealthOAuth = flow.beginOAuth;
export const googleHealthOAuthCallback = flow.oauthCallback;
