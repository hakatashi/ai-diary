import {Navigate, useLocation} from '@solidjs/router';
import {useAuth} from 'solid-firebase';
import {type JSX, Match, Switch} from 'solid-js';
import {ALLOWED_EMAIL} from '~/lib/constants';
import {auth} from '~/lib/firebase';

const PUBLIC_PATHS = new Set(['/login']);

const FullScreenLoading = () => (
	<div class="flex min-h-screen items-center justify-center text-slate-500">
		読み込み中...
	</div>
);

const AuthGuard = (props: {children: JSX.Element}) => {
	const location = useLocation();
	const authState = useAuth(auth);

	return (
		<Switch fallback={props.children}>
			<Match when={PUBLIC_PATHS.has(location.pathname)}>{props.children}</Match>
			<Match when={authState.loading}>
				<FullScreenLoading />
			</Match>
			<Match
				when={
					!authState.data ||
					authState.data.email !== ALLOWED_EMAIL ||
					!authState.data.emailVerified
				}
			>
				<Navigate
					href={`/login?redirect=${encodeURIComponent(location.pathname)}`}
				/>
			</Match>
		</Switch>
	);
};

export default AuthGuard;
