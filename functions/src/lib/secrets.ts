import {defineSecret, defineString} from 'firebase-functions/params';

export const geminiApiKey = defineSecret('GEMINI_API_KEY');
export const googleClientSecret = defineSecret('GOOGLE_CLIENT_SECRET');
export const googleClientId = defineString('GOOGLE_CLIENT_ID');
export const foursquareClientSecret = defineSecret(
	'FOURSQUARE_OAUTH_CLIENT_SECRET',
);
export const foursquareClientId = defineString('FOURSQUARE_OAUTH_CLIENT_ID');
export const googlePlacesApiKey = defineSecret('GOOGLE_PLACES_API_KEY');
