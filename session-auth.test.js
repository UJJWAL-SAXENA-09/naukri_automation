const assert = require('assert');
const { sessionLooksAuthenticated, sessionLooksLoggedOut } = require('./session-auth');

const publicWellfound = `Why Wellfound\nJobs\nLog in\nCreate profile\nTrending startup jobs\nProfile tips`;
assert.strictEqual(
  sessionLooksLoggedOut('wellfound', { url: 'https://wellfound.com/jobs', text: publicWellfound }),
  true,
);
assert.strictEqual(
  sessionLooksAuthenticated('wellfound', { url: 'https://wellfound.com/jobs', text: publicWellfound }),
  false,
  '"Create profile" must not be mistaken for an authenticated profile',
);

const privateWellfound = `Discover\nJobs\nMessages\nApplied\nSaved\nProfile`;
assert.strictEqual(
  sessionLooksAuthenticated('wellfound', { url: 'https://wellfound.com/jobs', text: privateWellfound }),
  true,
);

assert.strictEqual(
  sessionLooksAuthenticated('naukri', {
    url: 'https://www.naukri.com/mnjuser/profile',
    text: 'Application status\nRecommended jobs\nResume headline',
  }),
  true,
);

console.log('session-auth: all checks passed');
