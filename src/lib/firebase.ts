import {isServer} from 'solid-js/web';
import {initializeApp} from 'firebase/app';
import {
	connectAuthEmulator,
	getAuth,
	GoogleAuthProvider,
	signInWithPopup,
	signOut,
} from 'firebase/auth';
import {
	getFirestore,
	connectFirestoreEmulator,
	collection,
	type CollectionReference,
} from 'firebase/firestore';
import {connectFunctionsEmulator, getFunctions} from 'firebase/functions';
import type {DataSource, JournalEntry, LogEntry} from './schema.ts';

const FUNCTIONS_REGION = 'asia-northeast1';

const firebaseConfigResponse = await fetch('/__/firebase/init.json');
const firebaseConfig = await firebaseConfigResponse.json();

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const functions = getFunctions(app, FUNCTIONS_REGION);

if (import.meta.env.DEV && !isServer) {
	connectFirestoreEmulator(db, 'localhost', 40615);
	connectAuthEmulator(auth, 'http://localhost:9099');
	connectFunctionsEmulator(functions, 'localhost', 5001);
}

const DataSources = collection(
	db,
	'dataSources',
) as CollectionReference<DataSource>;
const LogEntries = collection(
	db,
	'logEntries',
) as CollectionReference<LogEntry>;
const JournalEntries = collection(
	db,
	'journalEntries',
) as CollectionReference<JournalEntry>;

const signInWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());

const signOutFromApp = () => signOut(auth);

export {
	app as default,
	auth,
	db,
	functions,
	DataSources,
	LogEntries,
	JournalEntries,
	signInWithGoogle,
	signOutFromApp as signOut,
};
