function hasLine(text, value) {
  return String(text || '')
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase() === value.toLowerCase());
}

function sessionLooksLoggedOut(site, { url = '', text = '' } = {}) {
  if (site === 'wellfound') {
    return /wellfound\.com\/(login|signup)/i.test(url) ||
      (hasLine(text, 'Log in') && hasLine(text, 'Create profile'));
  }
  if (site === 'naukri' || site === 'refresh') {
    return /naukri\.com\/(nlogin|login|registration)/i.test(url) ||
      (hasLine(text, 'Login') && hasLine(text, 'Register'));
  }
  return /sign in|log in to continue|create an account/i.test(text);
}

function sessionLooksAuthenticated(site, state = {}) {
  if (sessionLooksLoggedOut(site, state)) return false;
  const { url = '', text = '' } = state;
  if (site === 'wellfound') {
    return /wellfound\.com/i.test(url) && /\b(Applied|Messages|Saved|Profile)\b/i.test(text);
  }
  if (site === 'naukri' || site === 'refresh') {
    return /naukri\.com\/mnjuser/i.test(url) &&
      /Application status|Recommended jobs|resume headline/i.test(text);
  }
  return true;
}

module.exports = { sessionLooksAuthenticated, sessionLooksLoggedOut };
