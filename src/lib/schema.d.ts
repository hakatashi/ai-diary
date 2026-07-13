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

export type DataSourceType = 'google_health';

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

export type LogEntrySourceType = 'google_health_exercise';

export type LogEntryCategory = 'exercise';

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
	createdAt: Timestamp;
	updatedAt: Timestamp;
}

export interface JournalEntry extends DocumentData {
	date: string;
	memo: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}
