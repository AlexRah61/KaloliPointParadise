/**
 * @OnlyCurrentDoc
 *
 * Kaloli Point Paradise: forwards Meta lead-form rows from this Google Sheet to the property website, which stores
 * each lead in D1 and emails the listing agent (copy to the owner). Bound to the AmauHouseLeadContacts sheet.
 *
 * Setup (once): Project Settings > Script properties > KP_SYNC_SECRET = the Worker secret SHEET_SYNC_SECRET,
 * then run installTrigger() from the editor and allow access. It runs syncLeads() every 5 minutes.
 * A row is sent until the website answers for it (stored, already stored or not a lead); the website ignores repeats.
 */
var KP_ENDPOINT = 'https://kalolipointparadisehawaii.com/api/meta-leads';
var KP_SENT_PREFIX = 'KP_SENT_';
var KP_CHUNK = 8000;
var KP_MAX_ROWS = 25;

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncLeads') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncLeads').timeBased().everyMinutes(5).create();
  syncLeads();
}

function syncLeads() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('KP_SYNC_SECRET');
    if (!secret) throw new Error('Script property KP_SYNC_SECRET is not set.');
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var values = sheet.getDataRange().getDisplayValues();
    if (values.length < 2) {
      console.log('KP sync: no lead rows');
      return;
    }
    var headers = values[0].map(function (h) {
      return String(h).trim();
    });
    var sent = loadSent_(props);
    var rows = [];
    for (var r = 1; r < values.length && rows.length < KP_MAX_ROWS; r++) {
      var rec = {};
      var filled = false;
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        var v = String(values[r][c] == null ? '' : values[r][c]).trim();
        if (v) filled = true;
        rec[headers[c]] = v;
      }
      if (!filled) continue;
      var key = rowKey_(rec);
      if (sent[key]) continue;
      rows.push({ key: key, row: r + 1, values: rec });
    }
    if (!rows.length) {
      console.log('KP sync: nothing new');
      return;
    }

    // ASCII-only JSON (non-ASCII escaped) so the signed text and the bytes sent are identical.
    var body = JSON.stringify({ source: 'meta_lead_form', sheet: sheet.getName(), rows: rows }).replace(/[\u007f-\uffff]/g, function (ch) {
      return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
    });
    var ts = String(Math.floor(Date.now() / 1000));
    var sig = toHex_(Utilities.computeHmacSha256Signature(ts + '.' + body, secret));
    var res = UrlFetchApp.fetch(KP_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      payload: body,
      headers: { 'X-KP-Timestamp': ts, 'X-KP-Signature': sig },
      muteHttpExceptions: true,
      followRedirects: false,
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code !== 200) {
      console.warn('KP sync: HTTP ' + code + ' ' + text.slice(0, 300));
      return;
    }
    var out = JSON.parse(text);
    var summary = [];
    // "error" rows are sent again on the next run; every other status is final.
    (out.results || []).forEach(function (x) {
      summary.push(x.status);
      if (x.status === 'inserted' || x.status === 'duplicate' || x.status === 'skipped') sent[x.key] = 1;
    });
    saveSent_(props, sent);
    console.log('KP sync: ' + rows.length + ' sent -> ' + summary.join(', '));
  } finally {
    lock.releaseLock();
  }
}

// Meta's lead ID when present, otherwise a digest of the submission.
function rowKey_(rec) {
  if (rec.id) return String(rec.id).slice(0, 100);
  var raw = [rec.created_time, rec.email, rec.phone || rec.phone_number, rec.full_name].join('|');
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return 'h:' + toHex_(d).slice(0, 24);
}

function toHex_(bytes) {
  return bytes
    .map(function (b) {
      return ('0' + (b & 0xff).toString(16)).slice(-2);
    })
    .join('');
}

function loadSent_(props) {
  var all = props.getProperties();
  var keys = Object.keys(all)
    .filter(function (k) {
      return k.indexOf(KP_SENT_PREFIX) === 0;
    })
    .sort();
  var joined = keys
    .map(function (k) {
      return all[k];
    })
    .join('');
  var set = {};
  (joined ? JSON.parse(joined) : []).forEach(function (k) {
    set[k] = 1;
  });
  return set;
}

function saveSent_(props, set) {
  var json = JSON.stringify(Object.keys(set));
  var old = Object.keys(props.getProperties()).filter(function (k) {
    return k.indexOf(KP_SENT_PREFIX) === 0;
  });
  var next = {};
  for (var i = 0, n = 0; i < json.length; i += KP_CHUNK, n++) next[KP_SENT_PREFIX + ('000' + n).slice(-3)] = json.slice(i, i + KP_CHUNK);
  old.forEach(function (k) {
    if (!(k in next)) props.deleteProperty(k);
  });
  props.setProperties(next);
}
