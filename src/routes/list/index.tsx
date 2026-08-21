import {A} from '@solidjs/router';
import {limit, orderBy, query} from 'firebase/firestore';
import {useFirestore} from 'solid-firebase';
import {createMemo, createSignal, For, type JSX, Show} from 'solid-js';
import AppShell from '~/components/AppShell';
import {
	ActivityIcon,
	CalendarIcon,
	CheckinIcon,
	LocationIcon,
	PhotoIcon,
} from '~/components/icons';
import {formatDateTime} from '~/lib/date';
import {LogEntries} from '~/lib/firebase';
import {isVisible} from '~/lib/logEntries';
import type {LogEntry, LogEntryCategory} from '~/lib/schema.ts';

const PAGE_SIZE = 50;

const CATEGORY_ICON: Record<
	LogEntryCategory,
	(props: {size?: number}) => JSX.Element
> = {
	exercise: ActivityIcon,
	location: LocationIcon,
	checkin: CheckinIcon,
	calendar: CalendarIcon,
	photo: PhotoIcon,
};

const CATEGORY_LABEL: Record<LogEntryCategory, string> = {
	exercise: '運動',
	location: '位置情報',
	checkin: 'チェックイン',
	calendar: '予定',
	photo: '写真',
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as LogEntryCategory[];

const ListPage = () => {
	const [pageCount, setPageCount] = createSignal(1);
	const [activeCategories, setActiveCategories] = createSignal<
		Set<LogEntryCategory>
	>(new Set(ALL_CATEGORIES));

	const logEntriesState = useFirestore(() =>
		query(
			LogEntries,
			orderBy('startAt', 'desc'),
			limit(PAGE_SIZE * pageCount()),
		),
	);

	const filteredEntries = createMemo(() =>
		(logEntriesState.data ?? [])
			.filter(isVisible)
			.filter((entry) => activeCategories().has(entry.category)),
	);

	const toggleCategory = (category: LogEntryCategory) => {
		setActiveCategories((prev) => {
			const next = new Set(prev);
			if (next.has(category)) {
				next.delete(category);
			} else {
				next.add(category);
			}
			return next;
		});
	};

	return (
		<AppShell>
			<div class="mx-auto flex max-w-2xl flex-col gap-4">
				<h1 class="font-heading text-xl font-extrabold">一覧</h1>
				<div class="flex flex-wrap gap-2">
					<For each={ALL_CATEGORIES}>
						{(category) => (
							<button
								type="button"
								onClick={() => toggleCategory(category)}
								class={
									activeCategories().has(category)
										? 'tag tag-outline'
										: 'tag tag-neutral'
								}
							>
								{CATEGORY_LABEL[category]}
							</button>
						)}
					</For>
				</div>
				<Show
					when={!logEntriesState.loading}
					fallback={<p class="text-[13px] text-text/55">読み込み中...</p>}
				>
					<ul class="flex flex-col">
						<For
							each={filteredEntries()}
							fallback={
								<p class="text-[13px] text-text/55">記録がありません。</p>
							}
						>
							{(entry: LogEntry) => {
								const Icon = CATEGORY_ICON[entry.category] ?? ActivityIcon;
								return (
									<li class="border-divider border-b py-3">
										<A
											href={`/${entry.date}`}
											class="flex items-center gap-3 hover:text-accent"
										>
											<span class="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-divider">
												<Icon size={14} />
											</span>
											<span class="flex-1">
												<span class="block font-heading text-[14px] font-extrabold">
													{entry.title}
												</span>
												<span class="block text-[12px] text-text/55">
													{formatDateTime(entry.startAt.toDate())}
												</span>
											</span>
										</A>
									</li>
								);
							}}
						</For>
					</ul>
				</Show>
				<Show
					when={(logEntriesState.data?.length ?? 0) >= PAGE_SIZE * pageCount()}
				>
					<button
						type="button"
						onClick={() => setPageCount((n) => n + 1)}
						class="btn btn-secondary self-center"
					>
						もっと見る
					</button>
				</Show>
			</div>
		</AppShell>
	);
};

export default ListPage;
