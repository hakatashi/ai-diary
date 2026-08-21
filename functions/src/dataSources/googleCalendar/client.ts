import {getGoogleAccessToken} from '../../lib/googleOAuth';
import type {RawCalendarEvent} from './normalize';

const API_BASE_URL = 'https://www.googleapis.com/calendar/v3';

interface ListEventsResponse {
	items?: RawCalendarEvent[];
	nextPageToken?: string;
}

export const listEvents = async (
	refreshToken: string,
	startTime: Date,
	endTime: Date,
): Promise<RawCalendarEvent[]> => {
	const accessToken = await getGoogleAccessToken(refreshToken);
	const results: RawCalendarEvent[] = [];
	let pageToken: string | undefined;

	do {
		const url = new URL(`${API_BASE_URL}/calendars/primary/events`);
		url.searchParams.set('timeMin', startTime.toISOString());
		url.searchParams.set('timeMax', endTime.toISOString());
		url.searchParams.set('singleEvents', 'true');
		url.searchParams.set('orderBy', 'startTime');
		url.searchParams.set('maxResults', '250');
		if (pageToken) {
			url.searchParams.set('pageToken', pageToken);
		}

		const response = await fetch(url, {
			headers: {Authorization: `Bearer ${accessToken}`},
		});

		if (!response.ok) {
			throw new Error(
				`Google Calendar API request failed: ${response.status} ${await response.text()}`,
			);
		}

		const body = (await response.json()) as ListEventsResponse;
		results.push(...(body.items ?? []));
		pageToken = body.nextPageToken;
	} while (pageToken);

	return results;
};
