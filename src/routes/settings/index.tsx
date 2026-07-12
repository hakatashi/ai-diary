import {useAuth} from 'solid-firebase';
import AppShell from '~/components/AppShell';
import {auth, signOut} from '~/lib/firebase';

const SettingsPage = () => {
	const authState = useAuth(auth);

	return (
		<AppShell>
			<div class="mx-auto flex max-w-3xl flex-col gap-4">
				<h1 class="text-xl font-semibold text-slate-800">設定</h1>
				<div class="rounded-md border border-slate-200 bg-white p-4">
					<p class="text-sm text-slate-500">サインイン中のアカウント</p>
					<p class="text-slate-800">{authState.data?.email}</p>
				</div>
				<button
					type="button"
					onClick={() => signOut()}
					class="self-start rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
				>
					サインアウト
				</button>
			</div>
		</AppShell>
	);
};

export default SettingsPage;
