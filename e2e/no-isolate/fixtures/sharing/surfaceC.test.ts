import { runSurfaceGuard } from './surfaceHelper';

// Peer of surfaceA/surfaceB — see surfaceHelper.runSurfaceGuard. A third peer is
// what lets a NON-FIRST file's shared afterAll be observed: whichever file runs
// second registers its afterAll from a non-first position, and the file that
// runs third asserts (in beforeAll) that it fired.
runSurfaceGuard('surfaceC');
