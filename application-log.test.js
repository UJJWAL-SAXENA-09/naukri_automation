const assert = require('assert');
const { parseCsv, reconcileWellfoundCsvText } = require('./application-log');

const input = '\uFEFF"Date","Site","Role","Company","CTC/Salary","Skills","Job Link","Verified","Job Description"\n' +
  '"today","wellfound","Engineer, Platform","Example","","","https://wellfound.com/jobs/123-engineer","missing","Uses ""quoted"" text"\n' +
  '"today","wellfound","Other","Example","","","https://wellfound.com/jobs/456-other","unknown",""\n' +
  '"today","naukri","Naukri role","Example","","","https://www.naukri.com/job-listings-789","verified",""\n';

const parsed = parseCsv(input);
assert.strictEqual(parsed[1][2], 'Engineer, Platform');
assert.strictEqual(parsed[1][8], 'Uses "quoted" text');

const result = reconcileWellfoundCsvText(input, ['/jobs/123']);
assert.strictEqual(result.updated, 1);
const reconciled = parseCsv(result.text);
assert.strictEqual(reconciled[1][7], 'verified');
assert.strictEqual(reconciled[2][7], 'unknown');
assert.strictEqual(reconciled[3][7], 'verified');

console.log('application-log: all checks passed');
