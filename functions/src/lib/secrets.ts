import {defineSecret, defineString} from 'firebase-functions/params';

export const geminiApiKey = defineSecret('GEMINI_API_KEY');
export const googleClientSecret = defineSecret('GOOGLE_CLIENT_SECRET');
export const googleClientId = defineString('GOOGLE_CLIENT_ID');
export const foursquareClientSecret = defineSecret(
	'FOURSQUARE_OAUTH_CLIENT_SECRET',
);
export const foursquareClientId = defineString('FOURSQUARE_OAUTH_CLIENT_ID');
export const googlePlacesApiKey = defineSecret('GOOGLE_PLACES_API_KEY');
export const immichApiKey = defineSecret('IMMICH_API_KEY');
// 未設定でもCLIが対話的に入力を求めないよう、明示的に空文字をデフォルトにする
// (Google/FoursquareのCLIENT_IDと違い、`functions/.env.hakatadiary` には値を置かない
// 運用のため)。
export const immichServerUrl = defineString('IMMICH_SERVER_URL', {
	default: '',
});
