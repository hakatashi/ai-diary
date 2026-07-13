import {Navigate, useSearchParams} from '@solidjs/router';
import {useAuth} from 'solid-firebase';
import {Match, Switch, createSignal} from 'solid-js';
import {ALLOWED_EMAIL} from '~/lib/constants';
import {auth, signInWithGoogle, signOut} from '~/lib/firebase';

const Login = () => {
	const [searchParams] = useSearchParams();
	const authState = useAuth(auth);
	const [error, setError] = createSignal<string | null>(null);

	const redirectTarget = () => {
		const redirect = searchParams.redirect;
		return typeof redirect === 'string' && redirect.startsWith('/')
			? redirect
			: '/';
	};

	const handleSignIn = async () => {
		setError(null);
		try {
			const result = await signInWithGoogle();
			if (result.user.email !== ALLOWED_EMAIL || !result.user.emailVerified) {
				await signOut();
				setError('このアカウントではログインできません。');
			}
		} catch {
			setError('ログインに失敗しました。もう一度お試しください。');
		}
	};

	return (
		<Switch>
			<Match
				when={
					!authState.loading &&
					authState.data?.email === ALLOWED_EMAIL &&
					authState.data.emailVerified
				}
			>
				<Navigate href={redirectTarget()} />
			</Match>
			<Match when={true}>
				<div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4">
					<h1 class="text-2xl font-semibold text-slate-800">ai-diary</h1>
					<p class="text-slate-500">
						続けるにはGoogleアカウントでログインしてください
					</p>
					<button
						type="button"
						onClick={handleSignIn}
						class="rounded-md bg-slate-900 px-6 py-2 text-white hover:bg-slate-700"
					>
						Googleでログイン
					</button>
					{error() && <p class="text-red-600">{error()}</p>}
				</div>
			</Match>
		</Switch>
	);
};

export default Login;
