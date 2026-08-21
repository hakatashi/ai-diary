import {createGoogleOAuthFlow, REGION} from '../../lib/googleOAuth';

export {REGION};
export const DATA_SOURCE_ID = 'google_calendar';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const flow = createGoogleOAuthFlow({
	dataSourceId: DATA_SOURCE_ID,
	displayName: 'Google Calendar (予定)',
	category: 'calendar',
	scope: SCOPE,
	callbackFunctionName: 'googleCalendarOAuthCallback',
});

export const beginGoogleCalendarOAuth = flow.beginOAuth;
export const googleCalendarOAuthCallback = flow.oauthCallback;
