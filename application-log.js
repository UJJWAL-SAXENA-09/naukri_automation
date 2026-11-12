const fs = require('fs');

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const text = String(input || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function csvRow(values) {
  return values
    .map((value) => '"' + String(value ?? '').replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"')
    .join(',') + '\n';
}

function jobId(link) {
  return ((String(link || '').match(/\/jobs\/(\d+)/) || [])[1] || '');
}

function reconcileWellfoundCsvText(input, appliedSlugs) {
  const rows = parseCsv(input);
  if (!rows.length) return { text: input, updated: 0 };
  const header = rows[0];
  const siteIndex = header.indexOf('Site');
  const linkIndex = header.indexOf('Job Link');
  const verifiedIndex = header.indexOf('Verified');
  if ([siteIndex, linkIndex, verifiedIndex].some((index) => index < 0)) {
    return { text: input, updated: 0 };
  }

  const appliedIds = new Set([...appliedSlugs].map(jobId).filter(Boolean));
  let updated = 0;
  for (const row of rows.slice(1)) {
    if (row[siteIndex] !== 'wellfound') continue;
    const id = jobId(row[linkIndex]);
    if (!id || !appliedIds.has(id) || row[verifiedIndex] === 'verified') continue;
    row[verifiedIndex] = 'verified';
    updated++;
  }
  return { text: '\uFEFF' + rows.map(csvRow).join(''), updated };
}

function reconcileWellfoundCsv(file, appliedSlugs) {
  if (!fs.existsSync(file)) return 0;
  const result = reconcileWellfoundCsvText(fs.readFileSync(file, 'utf8'), appliedSlugs);
  if (result.updated) fs.writeFileSync(file, result.text);
  return result.updated;
}

module.exports = { parseCsv, csvRow, jobId, reconcileWellfoundCsvText, reconcileWellfoundCsv };
