import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';

if (process.env.FUNCTIONS_EMULATOR === 'true') {
	process.env.FIRESTORE_EMULATOR_HOST = 'localhost:40615';
	process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
}

const app = initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);

// bucket()はストレージバケット名の解決を伴うため、Storageを実際に使わない
// テスト/モジュールの読み込み時に評価されないよう遅延させる。
const getBucket = () => getStorage(app).bucket();

export {auth, db, getBucket};
