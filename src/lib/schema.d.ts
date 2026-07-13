import type {
	DocumentData,
	FirestoreError,
	GeoPoint,
	Timestamp,
} from 'firebase/firestore';

export interface UseFireStoreReturn<T> {
	data: T;
	loading: boolean;
	error: FirestoreError | null;
}

export type DataSourceType =
	| 'google_health'
	| 'google_calendar'
	| 'google_maps_timeline'
	| 'swarm'
	| 'google_photos';

export type DataSourceStatus =
	| 'connected'
	| 'disconnected'
	| 'error'
	| 'pending_auth';

export type DataSourceSyncStatus = 'success' | 'partial' | 'error';

export interface DataSource extends DocumentData {
	type: DataSourceType;
	displayName: string;
	category: string;
	status: DataSourceStatus;
	enabled: boolean;
	lastSyncedAt: Timestamp | null;
	lastSyncStatus: DataSourceSyncStatus | null;
	lastSyncError: string | null;
	syncCursor: Record<string, unknown> | null;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}

export type LogEntrySourceType =
	| 'google_health_exercise'
	| 'google_calendar_event'
	| 'google_maps_visit'
	| 'google_maps_activity'
	| 'swarm_checkin'
	| 'google_photos_photo';

export type LogEntryCategory =
	| 'exercise'
	| 'location'
	| 'checkin'
	| 'calendar'
	| 'photo';

export interface LogEntryMetrics {
	durationMinutes?: number;
	distanceMeters?: number;
	calories?: number;
	avgHeartRate?: number;
}

export interface LogEntry extends DocumentData {
	sourceType: LogEntrySourceType;
	dataSourceId: string;
	category: LogEntryCategory;
	date: string;
	startAt: Timestamp;
	endAt: Timestamp | null;
	title: string;
	summary: string | null;
	metrics: LogEntryMetrics | null;
	location: GeoPoint | null;
	raw: Record<string, unknown>;
	sourceRecordId: string;
	/** 重複統合で他のエントリに吸収された場合にtrue。UI側で非表示にする(rawは保持し削除はしない)。 */
	hidden?: boolean;
	/** hidden===trueの場合、統合先のlogEntryId */
	dedupedInto?: string | null;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}

export interface PlaceCacheEntry extends DocumentData {
	displayName: string;
	formattedAddress: string | null;
	location: GeoPoint | null;
	types: string[];
	fetchedAt: Timestamp;
}

export interface JournalEntry extends DocumentData {
	date: string;
	memo: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}
