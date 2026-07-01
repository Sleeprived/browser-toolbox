// Test setup: expose the vendored zxcvbn as a global, mirroring how the browser
// loads assets/vendor/zxcvbn.js as a classic <script> before the ES modules run.
// The strength module reads globalThis.zxcvbn; without this the gate fails closed.
import zxcvbn from 'zxcvbn';

globalThis.zxcvbn = zxcvbn;
