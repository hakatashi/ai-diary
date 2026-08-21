import type {LogEntry, UseFireStoreReturn} from './schema.ts';

/** 重複統合で他エントリに吸収されたログエントリかどうか。 */
export const isVisible = (entry: LogEntry): boolean => !entry.hidden;

/**
 * Firestoreの `!=` フィルタはフィールド欠如ドキュメントを暗黙に除外してしまうため、
 * hidden の絞り込みはクエリではなくクライアント側で行う。
 */
export const visibleLogEntries = (
	state: UseFireStoreReturn<LogEntry[] | null | undefined>,
): UseFireStoreReturn<LogEntry[] | null | undefined> => ({
	loading: state.loading,
	error: state.error,
	data: state.data?.filter(isVisible),
});
