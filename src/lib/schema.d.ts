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
	| 'immich'
	| 'playnite'
	| 'zaim'
	| 'moneyforward';

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
	| 'google_health_nutrition'
	| 'google_health_sleep'
	| 'google_health_weight'
	| 'google_calendar_event'
	| 'google_maps_visit'
	| 'google_maps_activity'
	| 'google_maps_path'
	| 'google_maps_memory'
	| 'swarm_checkin'
	| 'immich_photo'
	| 'playnite_session'
	| 'zaim_money'
	| 'moneyforward_transaction';

export type LogEntryCategory =
	| 'exercise'
	| 'nutrition'
	| 'sleep'
	| 'weight'
	| 'location'
	| 'checkin'
	| 'calendar'
	| 'photo'
	| 'game'
	| 'finance';

export interface LogEntryMetrics {
	durationMinutes?: number;
	distanceMeters?: number;
	calories?: number;
	avgHeartRate?: number;
	weightKilograms?: number;
}

export interface FinanceDetails {
	/** 支出は負、収入は正(円)。isTransfer===trueの記録は集計対象外なので符号は参考値。 */
	amountYen: number;
	/** 表示・集計に使う実効カテゴリ(手動ルール適用後)。 */
	majorCategory: string;
	minorCategory: string | null;
	/** データソース側の元カテゴリ。ルール再適用時の起点として保持する。 */
	sourceMajorCategory: string;
	sourceMinorCategory: string | null;
	/** Zaimの口座名 / Moneyforwardの保有金融機関名。 */
	account: string | null;
	/**
	 * Zaimの品名(nameフィールド)。titleには店名(place)を優先して使うため、
	 * 両方が入力されている場合は品名がtitleに反映されず失われてしまう。それを防ぐために
	 * 保持する。Moneyforwardには対応する概念がないため常にnull。
	 */
	itemName: string | null;
	/** 口座間振替、またはMoneyforwardの「計算対象」外の記録。支出・収入の集計から除外する。 */
	isTransfer: boolean;
	/** 適用された financeRules のドキュメントID(未適用ならnull)。 */
	matchedRuleId: string | null;
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
	finance?: FinanceDetails | null;
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
	/** Places API (New) のレスポンス全体。Pro SKUで追加費用なく取得できるフィールドを
	 * 再呼び出しなしで後から参照できるよう、生のレスポンスをそのまま保持する。 */
	raw: Record<string, unknown>;
	fetchedAt: Timestamp;
}

export interface JournalEntry extends DocumentData {
	date: string;
	memo: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}

/** 手動設定の支出自動振り分けルール。createdAt昇順で最初にマッチしたものを採用する。 */
export interface FinanceRule extends DocumentData {
	/** 完全一致条件(nullなら任意)。 */
	account: string | null;
	/** 完全一致条件(符号込み、円。nullなら任意)。 */
	amountYen: number | null;
	/** logEntryのtitleへの部分一致条件(nullなら任意)。 */
	descriptionContains: string | null;
	assignedMajorCategory: string;
	assignedMinorCategory: string | null;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}
