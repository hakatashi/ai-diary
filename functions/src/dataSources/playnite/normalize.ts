import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import type {LogEntry} from '../../../../src/lib/schema.ts';

export type PlaynitePlatform =
	| 'steam'
	| 'epic'
	| 'gog'
	| 'xbox'
	| 'standalone'
	| 'other';

const PLATFORM_LABELS: Record<PlaynitePlatform, string> = {
	steam: 'Steam',
	epic: 'Epic Games',
	gog: 'GOG',
	xbox: 'Xbox',
	standalone: 'スタンドアロン',
	other: 'その他',
};

const TIME_ZONE = 'Asia/Tokyo';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

// Playnite拡張から届く `Game.Source.Name`(未設定の場合は空文字/null。ストアを介さず
// 単体インストールしたゲームはこれが該当)を既知のプラットフォームに正規化する。
export const normalizePlatform = (
	sourceName: string | null | undefined,
): PlaynitePlatform => {
	const normalized = (sourceName ?? '').trim().toLowerCase();
	if (!normalized) {
		return 'standalone';
	}
	if (normalized.includes('steam')) {
		return 'steam';
	}
	if (normalized.includes('epic')) {
		return 'epic';
	}
	if (normalized.includes('gog')) {
		return 'gog';
	}
	if (normalized.includes('xbox') || normalized.includes('microsoft')) {
		return 'xbox';
	}
	return 'other';
};

export interface RawPlayniteSession {
	gameId: string;
	gameName: string;
	source: string | null;
	/** セッション終了時刻とelapsedSecondsから算出した開始時刻(ISO 8601)。 */
	startAt: string;
	endAt: string;
	elapsedSeconds: number;
}

export interface NormalizedPlayniteSession {
	id: string;
	entry: Omit<LogEntry, 'createdAt' | 'updatedAt' | 'dataSourceId'>;
}

export const normalizePlayniteSession = (
	raw: RawPlayniteSession,
): NormalizedPlayniteSession => {
	const platform = normalizePlatform(raw.source);
	const startDate = new Date(raw.startAt);
	const endDate = new Date(raw.endAt);
	const durationMinutes = Math.max(0, Math.round(raw.elapsedSeconds / 60));

	// ドキュメントIDはゲームID+開始時刻から決定的に生成し、拡張スクリプトの
	// リトライで重複POSTされても冪等なupsertになるようにする(ADR-0003準拠)。
	const id = createHash('sha256')
		.update(`playnite_session:${raw.gameId}:${raw.startAt}`)
		.digest('hex');

	return {
		id,
		entry: {
			sourceType: 'playnite_session',
			category: 'game',
			date: dateFormatter.format(startDate),
			startAt: Timestamp.fromDate(startDate),
			endAt: Timestamp.fromDate(endDate),
			title: raw.gameName,
			summary: PLATFORM_LABELS[platform],
			metrics: {durationMinutes},
			location: null,
			raw: {
				gameName: raw.gameName,
				platform,
				playniteGameId: raw.gameId,
				elapsedSeconds: raw.elapsedSeconds,
			},
			sourceRecordId: raw.gameId,
		},
	};
};
