/**
 * Loads all personal data + credentials from .env so nothing sensitive lives in code.
 * Tiny hand-rolled parser — no dependency needed for a flat KEY=value file.
 */
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const E = loadEnv(path.join(__dirname, '.env'));
const g = (k, d = '') => (E[k] != null && E[k] !== '' ? E[k] : (process.env[k] || d));

if (!g('NAME') || !g('EMAIL')) {
  console.warn('[config] .env missing or empty — copy .env.example to .env and fill it in.');
}

const CV = {
  name: g('NAME'),
  email: g('EMAIL'),
  phone: g('PHONE'),
  location: g('LOCATION'),
  city: g('CITY', (g('LOCATION').split(',')[0] || '').trim()),
  state: g('STATE'),
  country: g('COUNTRY', (g('LOCATION').split(',').pop() || '').trim()),
  postalCode: g('POSTAL_CODE'),
  nationality: g('NATIONALITY'),
  citizenship: g('CITIZENSHIP', g('NATIONALITY')),
  currentRole: g('CURRENT_ROLE'),
  company: g('COMPANY') || (g('CURRENT_ROLE').split(' at ')[1] || '').split(' (')[0],
  education: g('EDUCATION'),
  degree: g('DEGREE'),
  university: g('UNIVERSITY'),
  graduationYear: g('GRADUATION_YEAR'),
  cgpa: g('CGPA'),
  cgpaScale: g('CGPA_SCALE', '10'),
  tenthScore: g('TENTH_SCORE'),
  tenthYear: g('TENTH_YEAR'),
  tenthSchool: g('TENTH_SCHOOL'),
  tenthBoard: g('TENTH_BOARD'),
  twelfthScore: g('TWELFTH_SCORE'),
  twelfthYear: g('TWELFTH_YEAR'),
  twelfthSchool: g('TWELFTH_SCHOOL'),
  twelfthBoard: g('TWELFTH_BOARD'),
  yearsOfExperience: g('YEARS_EXPERIENCE'),
  yearsNumber: (g('YEARS_EXPERIENCE').match(/\d+/) || ['1'])[0], // numeric-only chatbot fields
  skills: g('SKILLS'),
  highlights: g('HIGHLIGHTS').split('||').map((s) => s.trim()).filter(Boolean),
  // application answers
  noticePeriod: g('NOTICE_PERIOD'),
  currentCTC: g('CURRENT_CTC'),                 // bare number for chatbots, e.g. "10"
  expectedCTC: g('EXPECTED_CTC'),               // e.g. "18-25"
  currentFixedCTC: g('CURRENT_FIXED_CTC'),
  currentVariableCTC: g('CURRENT_VARIABLE_CTC'),
  expectedCTCNegotiable: g('EXPECTED_CTC_NEGOTIABLE'),
  currentSalary: g('CURRENT_CTC') + ' LPA',     // formatted for free-text fields
  expectedSalary: g('EXPECTED_CTC') + ' LPA',
  dob: g('DOB'),
  gender: g('GENDER'),
  workAuth: g('WORK_AUTH'),
  sponsorship: g('WORK_SPONSORSHIP'),
  workAuthIndia: g('WORK_AUTH_INDIA'),
  sponsorshipIndia: g('SPONSORSHIP_INDIA'),
  sponsorshipOutsideIndia: g('SPONSORSHIP_OUTSIDE_INDIA'),
  servingNotice: g('SERVING_NOTICE_PERIOD'),
  lastWorkingDay: g('LAST_WORKING_DAY'),
  maritalStatus: g('MARITAL_STATUS'),
  disabilityStatus: g('DISABILITY_STATUS', 'Prefer not to say'),
  disabilityType: g('DISABILITY_TYPE'),
  disabilityPercentage: g('DISABILITY_PERCENTAGE'),
  disabilityDetails: g('DISABILITY_DETAILS'),
  criminalRecord: g('CRIMINAL_RECORD'),
  backgroundCheck: g('BACKGROUND_CHECK'),
  shiftPreference: g('SHIFT_PREFERENCE'),
  travelPreference: g('TRAVEL_PREFERENCE'),
  contractPreference: g('CONTRACT_PREFERENCE'),
  bondPreference: g('SERVICE_BOND_PREFERENCE'),
  languages: g('LANGUAGES'),
  // links
  github: g('GITHUB_URL'),
  linkedin: g('LINKEDIN_URL'),
  portfolio: g('PORTFOLIO_URL'),
  links: `GitHub: ${g('GITHUB_URL')} | LinkedIn: ${g('LINKEDIN_URL')} | Portfolio: ${g('PORTFOLIO_URL')}`,
  // derived sentences
  remoteOk: g('REMOTE_PREFERENCE'),
  relocate: g('RELOCATION_PREFERENCE'),
  startDate: g('NOTICE_PERIOD') ? `I can start within ${g('NOTICE_PERIOD')}.` : '',
};

// Passwords are deliberately never read or stored. Log in interactively once;
// Chrome keeps the resulting session in a local, git-ignored profile directory.
const CREDS = { email: g('GOOGLE_EMAIL') || g('EMAIL') };
const geminiKey = g('GEMINI_KEY');
const JOB_FILTERS = {
  titleKeywords: g('TARGET_TITLE_KEYWORDS').split(',').map((s) => s.trim()).filter(Boolean),
  titleBlocklist: g('TITLE_BLOCKLIST').split(',').map((s) => s.trim()).filter(Boolean),
};
const naukriProfileUrl = g('NAUKRI_PROFILE_URL', 'https://www.naukri.com/mnjuser/profile');
// The PDF uploaded to the Naukri profile and attached to external application forms.
// Relative names resolve against the repo folder; an absolute path is used as-is.
const resumePath = path.resolve(__dirname, g('RESUME_FILE', 'Ankit Baghel.pdf'));

module.exports = { CV, CREDS, JOB_FILTERS, geminiKey, naukriProfileUrl, resumePath };
