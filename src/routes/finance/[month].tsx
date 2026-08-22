import {A, Navigate, useParams} from '@solidjs/router';
import {
	addDoc,
	deleteDoc,
	doc,
	orderBy,
	query,
	serverTimestamp,
	where,
} from 'firebase/firestore';
import {useFirestore} from 'solid-firebase';
import {createMemo, createSignal, For, Show} from 'solid-js';
import AppShell from '~/components/AppShell';
import {ChevronLeftIcon, ChevronRightIcon} from '~/components/icons';
import {
	formatMonthLabel,
	getCurrentMonthString,
	getDaysInMonth,
	isValidMonthString,
	shiftMonthString,
} from '~/lib/date';
import {FinanceRules, LogEntries} from '~/lib/firebase';
import {isVisible} from '~/lib/logEntries';
import type {FinanceDetails, FinanceRule, LogEntry} from '~/lib/schema.ts';

const TREND_MONTHS = 6;

const formatYen = (amountYen: number): string =>
	`¥${Math.round(Math.abs(amountYen)).toLocaleString('ja-JP')}`;

const MonthNav = (props: {month: string}) => (
	<>
		<A
			href={`/finance/${shiftMonthString(props.month, -1)}`}
			class="btn btn-secondary btn-icon"
			aria-label="前月"
		>
			<ChevronLeftIcon />
		</A>
		<span class="min-w-[140px] text-center font-heading text-base font-extrabold">
			{formatMonthLabel(props.month)}
		</span>
		<A
			href={`/finance/${shiftMonthString(props.month, 1)}`}
			class="btn btn-secondary btn-icon"
			aria-label="翌月"
		>
			<ChevronRightIcon />
		</A>
	</>
);

type FinanceLogEntry = LogEntry & {finance: FinanceDetails};

const isFinanceEntry = (entry: LogEntry): entry is FinanceLogEntry =>
	entry.category === 'finance' &&
	Boolean(entry.finance) &&
	!entry.finance?.isTransfer;

const CategoryBreakdown = (props: {entries: FinanceLogEntry[]}) => {
	const totals = createMemo(() => {
		const map = new Map<string, number>();
		for (const entry of props.entries) {
			if (entry.finance.amountYen >= 0) {
				continue;
			}
			const amount = -entry.finance.amountYen;
			map.set(
				entry.finance.majorCategory,
				(map.get(entry.finance.majorCategory) ?? 0) + amount,
			);
		}
		return [...map.entries()].sort((a, b) => b[1] - a[1]);
	});
	const maxTotal = createMemo(() => totals()[0]?.[1] ?? 0);

	return (
		<div class="flex flex-col gap-2">
			<Show
				when={totals().length > 0}
				fallback={
					<p class="text-[13px] text-text/55">支出の記録がありません。</p>
				}
			>
				<For each={totals()}>
					{([category, total]) => (
						<div class="flex flex-col gap-0.5">
							<div class="flex items-baseline justify-between text-[13px]">
								<span>{category}</span>
								<span class="font-heading font-extrabold">
									{formatYen(total)}
								</span>
							</div>
							<div class="h-2 w-full bg-divider">
								<div
									class="h-2 bg-accent"
									style={{
										width: `${maxTotal() > 0 ? (total / maxTotal()) * 100 : 0}%`,
									}}
								/>
							</div>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
};

const TrendChart = (props: {month: string; entries: FinanceLogEntry[]}) => {
	const months = createMemo(() =>
		Array.from({length: TREND_MONTHS}, (_, i) =>
			shiftMonthString(props.month, i - (TREND_MONTHS - 1)),
		),
	);
	const totalsByMonth = createMemo(() => {
		const map = new Map<string, number>(months().map((m) => [m, 0]));
		for (const entry of props.entries) {
			if (entry.finance.amountYen >= 0) {
				continue;
			}
			const monthKey = entry.date.slice(0, 7);
			if (map.has(monthKey)) {
				map.set(monthKey, (map.get(monthKey) ?? 0) + -entry.finance.amountYen);
			}
		}
		return months().map((m) => [m, map.get(m) ?? 0] as const);
	});
	const maxTotal = createMemo(() =>
		Math.max(...totalsByMonth().map(([, total]) => total), 1),
	);

	return (
		<div class="flex items-end gap-3" style={{height: '120px'}}>
			<For each={totalsByMonth()}>
				{([monthKey, total]) => (
					<div class="flex flex-1 flex-col items-center gap-1">
						<span class="text-[11px] text-text/55">{formatYen(total)}</span>
						<div
							class={
								monthKey === props.month
									? 'w-full bg-accent'
									: 'w-full bg-divider'
							}
							style={{height: `${Math.max((total / maxTotal()) * 90, 2)}px`}}
						/>
						<span class="text-[11px] text-text/55">{monthKey.slice(5)}</span>
					</div>
				)}
			</For>
		</div>
	);
};

const TransactionList = (props: {entries: FinanceLogEntry[]}) => (
	<ul class="flex flex-col">
		<For
			each={props.entries}
			fallback={
				<p class="text-[13px] text-text/55">この月の記録はまだありません。</p>
			}
		>
			{(entry) => (
				<li class="flex items-center justify-between gap-2 border-divider border-b py-2">
					<div class="min-w-0">
						<p class="truncate font-heading text-[13px] font-extrabold">
							{entry.title}
						</p>
						<p class="truncate text-[11px] text-text/55">
							{entry.date} ・ {entry.finance.majorCategory}
							{entry.finance.minorCategory &&
								` / ${entry.finance.minorCategory}`}
							{entry.finance.account && ` ・ ${entry.finance.account}`}
						</p>
					</div>
					<span
						class={
							entry.finance.amountYen < 0
								? 'flex-none font-heading text-[13px] font-extrabold'
								: 'flex-none font-heading text-[13px] font-extrabold text-accent'
						}
					>
						{entry.finance.amountYen < 0 ? '-' : '+'}
						{formatYen(entry.finance.amountYen)}
					</span>
				</li>
			)}
		</For>
	</ul>
);

const RulesSection = () => {
	const rulesState = useFirestore(() =>
		query(FinanceRules, orderBy('createdAt', 'asc')),
	);

	const [account, setAccount] = createSignal('');
	const [amountYen, setAmountYen] = createSignal('');
	const [descriptionContains, setDescriptionContains] = createSignal('');
	const [majorCategory, setMajorCategory] = createSignal('');
	const [minorCategory, setMinorCategory] = createSignal('');
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const handleSubmit = async (event: Event) => {
		event.preventDefault();
		if (!majorCategory()) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await addDoc(FinanceRules, {
				account: account() || null,
				amountYen: amountYen() ? Number(amountYen()) : null,
				descriptionContains: descriptionContains() || null,
				assignedMajorCategory: majorCategory(),
				assignedMinorCategory: minorCategory() || null,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});
			setAccount('');
			setAmountYen('');
			setDescriptionContains('');
			setMajorCategory('');
			setMinorCategory('');
		} catch {
			setError('ルールの追加に失敗しました。');
		} finally {
			setBusy(false);
		}
	};

	const handleDelete = async (ruleId: string) => {
		await deleteDoc(doc(FinanceRules, ruleId));
	};

	return (
		<div class="flex flex-col gap-3">
			<h2 class="font-heading text-base font-extrabold">自動振り分けルール</h2>
			<p class="text-[12px] text-text/55">
				条件(口座名・金額・内容の部分一致、いずれも省略可)にすべて一致した記録のカテゴリを上書きします。作成順で最初にマッチしたルールが使われます。既存データへ反映するには「データソース」ページの「ルールを再適用」を実行してください。
			</p>
			<ul class="flex flex-col gap-1">
				<For
					each={(rulesState.data ?? []) as (FinanceRule & {id: string})[]}
					fallback={
						<p class="text-[13px] text-text/55">ルールはまだありません。</p>
					}
				>
					{(rule) => (
						<li class="flex items-center justify-between gap-2 border-divider border-b py-1.5 text-[12px]">
							<span class="min-w-0 truncate">
								{rule.account ?? '任意の口座'} /{' '}
								{rule.amountYen ?? '任意の金額'} /{' '}
								{rule.descriptionContains ?? '任意の内容'} →{' '}
								<strong>
									{rule.assignedMajorCategory}
									{rule.assignedMinorCategory &&
										` / ${rule.assignedMinorCategory}`}
								</strong>
							</span>
							<button
								type="button"
								onClick={() => handleDelete(rule.id)}
								class="btn btn-secondary flex-none"
							>
								削除
							</button>
						</li>
					)}
				</For>
			</ul>
			<form onSubmit={handleSubmit} class="flex flex-wrap items-end gap-2">
				<input
					type="text"
					placeholder="口座名(任意)"
					value={account()}
					onInput={(e) => setAccount(e.currentTarget.value)}
					class="input w-auto"
				/>
				<input
					type="number"
					placeholder="金額・符号込み(任意)"
					value={amountYen()}
					onInput={(e) => setAmountYen(e.currentTarget.value)}
					class="input w-auto"
				/>
				<input
					type="text"
					placeholder="内容に含む文字列(任意)"
					value={descriptionContains()}
					onInput={(e) => setDescriptionContains(e.currentTarget.value)}
					class="input w-auto"
				/>
				<input
					type="text"
					placeholder="振分け先の大項目"
					value={majorCategory()}
					onInput={(e) => setMajorCategory(e.currentTarget.value)}
					required
					class="input w-auto"
				/>
				<input
					type="text"
					placeholder="振分け先の中項目(任意)"
					value={minorCategory()}
					onInput={(e) => setMinorCategory(e.currentTarget.value)}
					class="input w-auto"
				/>
				<button type="submit" disabled={busy()} class="btn btn-primary">
					{busy() ? '追加中...' : 'ルールを追加'}
				</button>
			</form>
			{error() && <p class="text-[13px] text-accent">{error()}</p>}
		</div>
	);
};

const FinanceMonthView = (props: {month: string}) => {
	const monthDays = createMemo(() => getDaysInMonth(props.month));
	const rangeStart = createMemo(
		() => `${shiftMonthString(props.month, -(TREND_MONTHS - 1))}-01`,
	);
	const rangeEnd = createMemo(() => monthDays()[monthDays().length - 1]);

	const logEntriesState = useFirestore(() =>
		query(
			LogEntries,
			where('date', '>=', rangeStart()),
			where('date', '<=', rangeEnd()),
			orderBy('date'),
		),
	);

	const financeEntries = createMemo(() =>
		(logEntriesState.data ?? []).filter(isVisible).filter(isFinanceEntry),
	);

	const currentMonthEntries = createMemo(() =>
		financeEntries()
			.filter((entry) => entry.date.slice(0, 7) === props.month)
			.sort((a, b) => b.startAt.toMillis() - a.startAt.toMillis()),
	);

	const totalExpense = createMemo(() =>
		currentMonthEntries()
			.filter((entry) => entry.finance.amountYen < 0)
			.reduce((sum, entry) => sum + -entry.finance.amountYen, 0),
	);
	const totalIncome = createMemo(() =>
		currentMonthEntries()
			.filter((entry) => entry.finance.amountYen > 0)
			.reduce((sum, entry) => sum + entry.finance.amountYen, 0),
	);

	return (
		<AppShell dateNav={() => <MonthNav month={props.month} />}>
			<div class="mx-auto flex max-w-3xl flex-col gap-8 p-6">
				<Show
					when={!logEntriesState.loading}
					fallback={<p class="text-[13px] text-text/55">読み込み中...</p>}
				>
					<div class="flex flex-wrap gap-6">
						<div>
							<p class="text-[12px] text-text/55">支出</p>
							<p class="font-heading text-xl font-extrabold">
								{formatYen(totalExpense())}
							</p>
						</div>
						<div>
							<p class="text-[12px] text-text/55">収入</p>
							<p class="font-heading text-xl font-extrabold">
								{formatYen(totalIncome())}
							</p>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<h2 class="font-heading text-base font-extrabold">
							直近{TREND_MONTHS}か月の支出推移
						</h2>
						<TrendChart month={props.month} entries={financeEntries()} />
					</div>

					<div class="flex flex-col gap-2">
						<h2 class="font-heading text-base font-extrabold">
							カテゴリ別支出
						</h2>
						<CategoryBreakdown entries={currentMonthEntries()} />
					</div>

					<div class="flex flex-col gap-2">
						<h2 class="font-heading text-base font-extrabold">取引一覧</h2>
						<TransactionList entries={currentMonthEntries()} />
					</div>
				</Show>

				<hr class="hr" />
				<RulesSection />
			</div>
		</AppShell>
	);
};

const FinanceMonthPage = () => {
	const params = useParams<{month: string}>();

	return (
		<Show
			when={isValidMonthString(params.month)}
			fallback={<Navigate href={`/finance/${getCurrentMonthString()}`} />}
		>
			<FinanceMonthView month={params.month} />
		</Show>
	);
};

export default FinanceMonthPage;
