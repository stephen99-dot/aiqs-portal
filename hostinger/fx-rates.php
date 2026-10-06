<?php
// ═══════════════════════════════════════════════════════════════════════════════
// LIVE EXCHANGE RATES — fx-rates.php
//
// Included by index.php. Hands the page one GBP-based rate table so the prices
// a visitor sees in their own currency follow the real exchange rate instead of
// a table someone typed in months ago.
//
//   $fx = aiqs_fx();
//   $fx['rates']      ['USD' => 1.3412, 'EUR' => 1.1698, ...]  GBP -> currency
//   $fx['live']       true when at least one rate came from the feed
//   $fx['asOf']       'YYYY-MM-DD' the feed said the rates are good for, or null
//   $fx['source']     feed name for the attribution line, or null
//   $fx['sourceUrl']  feed link, or null
//
// How it behaves, so a page view is never held up by somebody else's server:
//   - rates are fetched at most once a day (AIQS_FX_TTL) and cached on disk
//   - a stale cache is still served; only one request every AIQS_FX_RETRY
//     seconds tries to refresh it, with a short timeout
//   - with no cache at all (first view after upload) one fetch is tried with the
//     same short timeout, and the static table below stands if it fails
//   - every live rate is sanity-checked against the static table: a figure more
//     than AIQS_FX_MAX_DRIFT times away from it is a feed fault and is ignored
//   - a feed that only carries some currencies is fine: the rest stay static
//
// Run `php fx-rates.php` on the server to see what the page would be given.
// ═══════════════════════════════════════════════════════════════════════════════

const AIQS_FX_TTL       = 86400;  // seconds between refreshes (one day)
const AIQS_FX_RETRY     = 300;    // seconds to wait after a failed refresh before trying again
const AIQS_FX_TIMEOUT   = 3;      // seconds a page view may wait on the feed
const AIQS_FX_MAX_DRIFT = 3.0;    // live/static ratio beyond which a rate is rejected

// Feeds, tried in order until one answers. Both are free and need no key.
// The first covers every currency on the site; the ECB feed is the fallback
// and carries the majors only (no Gulf, East African or Latin American
// currencies), which the merge handles.
function aiqs_fx_feeds() {
  return [
    [
      'name' => 'Exchange Rate API',
      'url' => 'https://open.er-api.com/v6/latest/GBP',
      'link' => 'https://www.exchangerate-api.com',
      'parse' => 'aiqs_fx_parse_erapi',
    ],
    [
      'name' => 'Frankfurter (ECB)',
      'url' => 'https://api.frankfurter.dev/v1/latest?base=GBP',
      'link' => 'https://frankfurter.dev',
      'parse' => 'aiqs_fx_parse_frankfurter',
    ],
  ];
}

// The fallback table, GBP -> currency. Also the list of currencies the page
// knows: a live rate for anything not in here is dropped. Check these against
// a live quote every few months so the fallback stays close.
function aiqs_fx_static() {
  return [
    'GBP' => 1, 'EUR' => 1.17, 'USD' => 1.34, 'AUD' => 2.03, 'NZD' => 2.27, 'CAD' => 1.85, 'ZAR' => 23.8,
    'AED' => 4.92, 'SAR' => 5.03, 'QAR' => 4.88, 'KWD' => 0.41, 'BHD' => 0.505, 'OMR' => 0.515,
    'CHF' => 1.07, 'SEK' => 12.7, 'NOK' => 13.5, 'DKK' => 8.73, 'PLN' => 4.95, 'CZK' => 28.3, 'HUF' => 455,
    'RON' => 5.9, 'ISK' => 166, 'SGD' => 1.72, 'MYR' => 5.7, 'HKD' => 10.45, 'INR' => 117, 'PHP' => 76,
    'IDR' => 22000, 'THB' => 43.5, 'JPY' => 198, 'KRW' => 1860, 'CNY' => 9.6, 'KES' => 173, 'ILS' => 4.6,
    'MXN' => 25, 'BRL' => 7.3, 'CLP' => 1260, 'COP' => 5350, 'PEN' => 4.8, 'MUR' => 61,
  ];
}

/**
 * The rate table for the page. $opts is for tests: 'feeds', 'cacheFile',
 * 'ttl', 'retry', 'now' override the defaults above.
 */
function aiqs_fx(array $opts = []) {
  $static = aiqs_fx_static();
  $now = $opts['now'] ?? time();
  $ttl = $opts['ttl'] ?? AIQS_FX_TTL;
  $retry = $opts['retry'] ?? AIQS_FX_RETRY;
  $cacheFile = $opts['cacheFile'] ?? aiqs_fx_cache_path();
  $feeds = $opts['feeds'] ?? aiqs_fx_feeds();

  $cache = aiqs_fx_read_cache($cacheFile);
  $hasRates = $cache && !empty($cache['rates']);
  $fresh = $hasRates && ($now - (int)$cache['fetchedAt']) < $ttl;
  $mayTry = !$cache || ($now - (int)($cache['attemptedAt'] ?? 0)) >= $retry;

  if (!$fresh && $mayTry) {
    // Claim the retry slot before fetching, so parallel page views on a dead
    // feed do not all wait on it.
    aiqs_fx_write_cache($cacheFile, array_merge($cache ?: [], ['attemptedAt' => $now]));
    $live = aiqs_fx_fetch($feeds, $static);
    if ($live) {
      $cache = $live + ['fetchedAt' => $now, 'attemptedAt' => $now];
      $hasRates = true;
      aiqs_fx_write_cache($cacheFile, $cache);
    }
  }

  $out = ['rates' => $static, 'live' => false, 'asOf' => null, 'source' => null, 'sourceUrl' => null, 'fetchedAt' => null];
  if (!$hasRates) return $out;

  $used = 0;
  foreach ($static as $cur => $sv) {
    if ($cur === 'GBP') continue;
    $lv = $cache['rates'][$cur] ?? null;
    if (!is_numeric($lv) || $lv <= 0) continue;
    if ($lv / $sv > AIQS_FX_MAX_DRIFT || $sv / $lv > AIQS_FX_MAX_DRIFT) continue;   // feed fault
    $out['rates'][$cur] = aiqs_fx_round((float)$lv);
    $used++;
  }
  if ($used) {
    $out['live'] = true;
    $out['asOf'] = $cache['asOf'] ?? null;
    $out['source'] = $cache['source'] ?? null;
    $out['sourceUrl'] = $cache['sourceUrl'] ?? null;
    $out['fetchedAt'] = (int)$cache['fetchedAt'];
  }
  return $out;
}

// ---- feeds -------------------------------------------------------------------

function aiqs_fx_fetch(array $feeds, array $static) {
  foreach ($feeds as $feed) {
    $body = aiqs_fx_http($feed['url']);
    if ($body === null) continue;
    $json = json_decode($body, true);
    if (!is_array($json)) continue;
    $parsed = call_user_func($feed['parse'], $json);
    if (!$parsed || empty($parsed['rates'])) continue;
    // Keep only the currencies the page knows, so the cache stays small.
    $rates = [];
    foreach ($parsed['rates'] as $cur => $v) {
      if (isset($static[$cur]) && is_numeric($v) && $v > 0) $rates[$cur] = (float)$v;
    }
    // A feed answering with neither of the two biggest currencies is broken.
    if (!isset($rates['USD'], $rates['EUR'])) continue;
    return ['rates' => $rates, 'asOf' => $parsed['asOf'], 'source' => $feed['name'], 'sourceUrl' => $feed['link']];
  }
  return null;
}

function aiqs_fx_parse_erapi(array $j) {
  if (($j['result'] ?? '') !== 'success' || ($j['base_code'] ?? '') !== 'GBP' || empty($j['rates'])) return null;
  $ts = $j['time_last_update_unix'] ?? null;
  return ['rates' => $j['rates'], 'asOf' => is_numeric($ts) ? gmdate('Y-m-d', (int)$ts) : gmdate('Y-m-d')];
}

function aiqs_fx_parse_frankfurter(array $j) {
  if (($j['base'] ?? '') !== 'GBP' || empty($j['rates'])) return null;
  $d = $j['date'] ?? '';
  return ['rates' => $j['rates'], 'asOf' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) ? $d : gmdate('Y-m-d')];
}

function aiqs_fx_http($url) {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_CONNECTTIMEOUT => AIQS_FX_TIMEOUT,
      CURLOPT_TIMEOUT => AIQS_FX_TIMEOUT,
      CURLOPT_FOLLOWLOCATION => false,
      CURLOPT_HTTPHEADER => ['Accept: application/json'],
      CURLOPT_USERAGENT => 'theaiqs.co.uk fx-rates',
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return ($body !== false && $status === 200) ? $body : null;
  }
  $ctx = stream_context_create(['http' => ['timeout' => AIQS_FX_TIMEOUT, 'header' => "Accept: application/json\r\n", 'user_agent' => 'theaiqs.co.uk fx-rates', 'ignore_errors' => false]]);
  $body = @file_get_contents($url, false, $ctx);
  return $body === false ? null : $body;
}

// ---- cache -------------------------------------------------------------------

function aiqs_fx_cache_path() {
  $dir = __DIR__ . '/cache';
  if (!is_dir($dir)) @mkdir($dir, 0755, true);
  if (is_dir($dir) && is_writable($dir)) return $dir . '/fx-rates.json';
  return rtrim(sys_get_temp_dir(), '/\\') . '/theaiqs-fx-rates.json';
}

function aiqs_fx_read_cache($file) {
  if (!is_file($file)) return null;
  $json = json_decode((string)@file_get_contents($file), true);
  if (!is_array($json)) return null;
  if (isset($json['rates']) && !is_array($json['rates'])) return null;
  return $json;
}

function aiqs_fx_write_cache($file, array $data) {
  $tmp = $file . '.' . getmypid() . '.tmp';
  if (@file_put_contents($tmp, json_encode($data), LOCK_EX) === false) return false;
  if (@rename($tmp, $file)) return true;
  @unlink($tmp);
  return false;
}

// Four significant figures is plenty for a price and keeps the table short.
function aiqs_fx_round($v) {
  if ($v <= 0) return $v;
  $places = 4 - (int)floor(log10($v)) - 1;
  return round($v, $places);
}

// `php fx-rates.php` on the server: shows what the page would be handed.
if (PHP_SAPI === 'cli' && isset($argv[0]) && realpath($argv[0]) === __FILE__) {
  $fx = aiqs_fx();
  echo 'live:     ', $fx['live'] ? 'yes' : 'no (static table)', "\n";
  echo 'as of:    ', $fx['asOf'] ?? '-', "\n";
  echo 'source:   ', $fx['source'] ?? '-', "\n";
  echo 'cache:    ', aiqs_fx_cache_path(), "\n";
  foreach ($fx['rates'] as $cur => $v) echo str_pad($cur, 5), $v, "\n";
}
