import {Navigate} from '@solidjs/router';
import {getTodayDateString} from '~/lib/date';

const Home = () => <Navigate href={`/${getTodayDateString()}`} />;

export default Home;
