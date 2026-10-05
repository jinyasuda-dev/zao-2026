/**
 * 2026 蔵王の集い 参加者サイト用 API
 * GET ?p=<合言葉> → 公開_ シートの内容を JSON で返す
 * 合言葉はスクリプトプロパティ PASSPHRASE に保存（コードに書かない）
 * スタンドアロンスクリプト。実行アカウントにはスプレッドシートの閲覧権限が必要
 */
const SPREADSHEET_ID = '1QJuPJd_H9NHYrvsDAXaJmVipEGtIY-tTzBoc1rAGb80';

const SHEETS = {
  info:         '公開_基本情報',
  timetable:    '公開_タイムテーブル',
  participants: '公開_参加者',
  rooms:        '公開_部屋割り',
  meals:        '公開_食事',
  fees:         '公開_参加費',
  notes:        '公開_持ち物・注意',
};

// サイトに出さない列（運営用メモ）
const HIDDEN_COLUMNS = {
  info:      ['備考（サイトには出さない）', '備考'],
  timetable: ['備考'],
};

const CACHE_KEY = 'payload_v1';
const CACHE_SECONDS = 60;

function doGet(e) {
  const given = String((e && e.parameter && e.parameter.p) || '').trim();
  const expected = PropertiesService.getScriptProperties().getProperty('PASSPHRASE');

  // 総当たり対策：直近1分間の失敗が多いときは一時的に全リクエストを拒否
  if (isLocked_()) return json_({ ok: false, error: 'locked' });
  if (!expected || !safeEqual_(given, expected)) {
    countFailure_();
    Utilities.sleep(800);
    return json_({ ok: false, error: 'unauthorized' });
  }

  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  const payload = JSON.stringify(buildPayload_());
  if (payload.length < 90000) cache.put(CACHE_KEY, payload, CACHE_SECONDS);
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function buildPayload_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = { ok: true, generatedAt: new Date().toISOString() };

  Object.keys(SHEETS).forEach(function (key) {
    const sheet = ss.getSheetByName(SHEETS[key]);
    if (!sheet) { data[key] = []; return; }
    const values = sheet.getDataRange().getDisplayValues();
    if (values.length < 2) { data[key] = []; return; }

    const header = values[0].map(function (h) { return String(h).trim(); });
    const hidden = HIDDEN_COLUMNS[key] || [];

    data[key] = values.slice(1)
      .filter(function (row) { return row.some(function (c) { return c !== ''; }); })
      .map(function (row) {
        const obj = {};
        header.forEach(function (h, i) {
          if (h && hidden.indexOf(h) === -1) obj[h] = row[i];
        });
        return obj;
      })
      // 「要確認」で内容が空の行は出さない
      .filter(function (o) { return !(o['状態'] === '要確認' && (o['内容'] || '') === ''); });
  });

  // 基本情報はキーで引けるように辞書化
  const infoMap = {};
  data.info.forEach(function (o) { if (o['キー']) infoMap[o['キー']] = { label: o['項目'], value: o['内容'], status: o['状態'] }; });
  data.info = infoMap;

  return data;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function countFailure_() {
  const c = CacheService.getScriptCache();
  const n = Number(c.get('fail') || 0) + 1;
  c.put('fail', String(n), 60);
}

function isLocked_() {
  return Number(CacheService.getScriptCache().get('fail') || 0) > 30;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** シート更新後すぐ反映させたいときに手動実行 */
function clearCache() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

/** 初回の権限承認と読み取り確認用（エディタから実行） */
function testRead() {
  const p = buildPayload_();
  Object.keys(SHEETS).forEach(function (k) {
    const v = p[k];
    Logger.log(SHEETS[k] + ': ' + (Array.isArray(v) ? v.length : Object.keys(v).length) + '件');
  });
}
