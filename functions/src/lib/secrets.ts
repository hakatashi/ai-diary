import {defineSecret, defineString} from 'firebase-functions/params';

export const geminiApiKey = defineSecret('GEMINI_API_KEY');
export const googleClientSecret = defineSecret('GOOGLE_CLIENT_SECRET');
export const googleClientId = defineString('GOOGLE_CLIENT_ID');
