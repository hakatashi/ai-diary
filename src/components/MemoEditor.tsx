import {doc, serverTimestamp, setDoc} from 'firebase/firestore';
import {useFirestore} from 'solid-firebase';
import {createEffect, createSignal, Show} from 'solid-js';
import {PencilIcon} from '~/components/icons';
import {JournalEntries} from '~/lib/firebase';

const MemoEditor = (props: {date: string}) => {
	const journalRef = () => doc(JournalEntries, props.date);
	const journalState = useFirestore(journalRef);
	const [memo, setMemo] = createSignal('');
	const [editing, setEditing] = createSignal(false);
	const [saving, setSaving] = createSignal(false);

	createEffect(() => {
		if (!journalState.loading) {
			setMemo(journalState.data?.memo ?? '');
		}
	});

	const handleSave = async () => {
		setSaving(true);
		try {
			await setDoc(
				journalRef(),
				{
					date: props.date,
					memo: memo(),
					updatedAt: serverTimestamp(),
					...(journalState.data ? {} : {createdAt: serverTimestamp()}),
				},
				{merge: true},
			);
			setEditing(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Show
			when={editing()}
			fallback={
				<div class="relative">
					<p class="whitespace-pre-wrap pr-9 text-[15px] leading-[1.75]">
						{memo() || 'この日のメモはまだありません。'}
					</p>
					<button
						type="button"
						onClick={() => setEditing(true)}
						class="absolute top-0 right-0 flex h-7 w-7 cursor-pointer items-center justify-center border-0 bg-transparent text-text/35 hover:bg-text/7"
					>
						<PencilIcon />
					</button>
				</div>
			}
		>
			<div class="flex flex-col gap-2">
				<textarea
					class="input min-h-32"
					value={memo()}
					onInput={(event) => setMemo(event.currentTarget.value)}
					placeholder="今日の出来事を記録..."
				/>
				<div class="flex gap-2 self-start">
					<button
						type="button"
						onClick={handleSave}
						disabled={saving()}
						class="btn btn-primary"
					>
						{saving() ? '保存中...' : '保存'}
					</button>
					<button
						type="button"
						onClick={() => setEditing(false)}
						class="btn btn-secondary"
					>
						キャンセル
					</button>
				</div>
			</div>
		</Show>
	);
};

export default MemoEditor;
