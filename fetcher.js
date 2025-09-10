(function () {
  'use strict';

  // ----- small utilities -----
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function downloadBlob(content, filename, type) {
    const blob =
      content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'gcpd_data.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function getSessionID() {
    if (typeof window.g_sessionID !== 'undefined' && window.g_sessionID)
      return window.g_sessionID;
    const m = document.cookie.match(/(?:^|; )sessionid=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // cormalize label string -> snake_case
  function normalizeKey(label) {
    return (label || '')
      .replace(/\u00A0/g, ' ')
      .trim()
      .replace(/[:–—\-\/\\]+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  // canonical mapping (extend as needed)
  const CANONICAL_MAP = {
    reached_conclusion: 'reached_conclusion',
    type: 'type',
    map_index: 'map_index',
    match_creation_time: 'match_creation_time',
    match_ip: 'match_ip',
    match_port: 'match_port',
    datacenter: 'datacenter',
    match_size: 'match_size',
    join_time: 'join_time',
    party_id_at_join: 'party_id_at_join',
    team_at_join: 'team_at_join',
    ping_estimate_at_join: 'ping_estimate_at_join',
    joined_after_match_start: 'joined_after_match_start',
    time_in_queue: 'time_in_queue',
    match_end_time: 'match_end_time',
    season_id: 'season_id',
    match_status: 'match_status',
    match_duration: 'match_duration',
    red_team_final_score: 'red_team_final_score',
    blu_team_final_score: 'blu_team_final_score',
    winning_team: 'winning_team',
    game_mode: 'game_mode',
    win_reason: 'win_reason',
    match_flags: 'match_flags',
    match_included_bots: 'match_included_bots',
    time_left_match: 'time_left_match',
    result_partyid: 'result_partyid',
    result_team: 'result_team',
    result_score: 'result_score',
    result_ping: 'result_ping',
    result_player_flags: 'result_player_flags',
    result_displayed_rating: 'result_displayed_rating',
    result_displayed_rating_change: 'result_displayed_rating_change',
    result_rank: 'result_rank',
    classes_played: 'classes_played',
    kills: 'kills',
    deaths: 'deaths',
    damage: 'damage',
    healing: 'healing',
    support: 'support',
    score_medal: 'score_medal',
    kills_medal: 'kills_medal',
    damage_medal: 'damage_medal',
    healing_medal: 'healing_medal',
    support_medal: 'support_medal',
    leave_reason: 'leave_reason',
    connection_time: 'connection_time'
  };

  function tryParseNumber(s) {
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return null;
  }

  function tryParseDate(s) {
    if (!s || !s.trim()) return null;
    const d = new Date(s);
    if (!isNaN(d.valueOf())) return d.toISOString();
    const m = s.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) return new Date(m[1] + 'T' + m[2] + 'Z').toISOString();
    return null;
  }

  function parseValue(raw, opts) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (s === '') return null;
    const low = s.toLowerCase();
    if (low === 'yes') return true;
    if (low === 'no') return false;
    if (opts.parseNumbers) {
      const n = tryParseNumber(s);
      if (n !== null) return n;
    }
    if (opts.parseDates) {
      const iso = tryParseDate(s);
      if (iso) return iso;
    }
    return s;
  }

  // parses a single match table HTML to object
  function parseMatchHtml(html, opts) {
    const cfg = Object.assign(
      {
        parseDates: true,
        parseNumbers: true,
        canonicalMap: CANONICAL_MAP
      },
      opts || {}
    );
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    const table =
      doc.querySelector('table.generic_kv_table') || doc.querySelector('table');
    if (!table) return null;

    const out = {};
    const th = table.querySelector('th');
    if (th) {
      const header = (th.textContent || '').trim();
      const m = header.match(/Match\s*([0-9]+)/i);
      if (m) out.match_id = String(m[1]);
      else out.match_title = header;
    }

    table.querySelectorAll('tr').forEach((r) => {
      const cells = r.querySelectorAll('td');
      if (cells.length !== 2) return;
      const rawKey = (cells[0].textContent || '').trim();
      const rawVal = (cells[1].textContent || '').trim();
      const keyNorm = normalizeKey(rawKey);
      const keyCanon = cfg.canonicalMap[keyNorm] || keyNorm;
      out[keyCanon] = parseValue(rawVal, cfg);
    });

    return out;
  }

  // extract table blocks from a big HTML chunk
  function extractTablesFromHtml(bigHtml) {
    const doc = new DOMParser().parseFromString(bigHtml || '', 'text/html');
    let tables = Array.from(doc.querySelectorAll('table.generic_kv_table'));
    if (!tables.length) tables = Array.from(doc.querySelectorAll('table'));
    return tables.map((t) => {
      const th = t.querySelector('th');
      let id = null;
      if (th) {
        const m = (th.textContent || '').match(/Match\s*([0-9]+)/i);
        if (m) id = String(m[1]);
      }
      return { id: id || null, html: t.outerHTML };
    });
  }

  // fixed column order
  const ORDERED_COLUMNS = [
    // identity/meta
    'match_id',
    'match_title', // rarely present if ID header isn't standard
    'type',
    'season_id',
    // times
    'match_creation_time',
    'connection_time',
    'join_time',
    'joined_after_match_start',
    'time_in_queue',
    'match_end_time',
    'time_left_match',
    // match info
    'game_mode',
    'map_index',
    'datacenter',
    'match_ip',
    'match_port',
    'match_size',
    'match_status',
    'match_duration',
    'match_flags',
    'match_included_bots',
    // team outcome
    'red_team_final_score',
    'blu_team_final_score',
    'winning_team',
    'win_reason',
    // join/party info
    'party_id_at_join',
    'team_at_join',
    'ping_estimate_at_join',
    // personal result
    'result_partyid',
    'result_team',
    'result_score',
    'result_ping',
    'result_player_flags',
    'result_displayed_rating',
    'result_displayed_rating_change',
    'result_rank',
    // performance
    'classes_played',
    'kills',
    'deaths',
    'damage',
    'healing',
    'support',
    // medals
    'score_medal',
    'kills_medal',
    'damage_medal',
    'healing_medal',
    'support_medal',
    // misc
    'leave_reason'
  ];

  function buildCsv(rows, fixedOrder, verbose) {
    // find any unexpected keys and attach them (alphabetical) to the end
    const fixed = fixedOrder.slice();
    const known = new Set(fixed);
    const extrasSet = new Set();
    for (const r of rows) {
      Object.keys(r).forEach((k) => {
        if (!known.has(k) && !k.startsWith('_')) extrasSet.add(k);
      });
    }
    const extras = Array.from(extrasSet).sort();
    const headers = fixed.concat(extras);

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    let csv = headers.join(',') + '\n';
    for (const row of rows) {
      csv += headers.map((h) => esc(row[h])).join(',') + '\n';
    }

    if (verbose && extras.length) {
      console.log('[GCPD] extra fields attached to CSV:', extras);
    }
    return { csv, headers };
  }

  // ----- main fetch + parse -----
  async function gcpdFetchAndParseAll(opts) {
    const currentUrl = window.location.href;

    const regex = /(?:profiles|id)\/([^/]+)/;

    const match = currentUrl.match(regex);

    // Check if a match was found and log the result
    if (match) {
      console.log(match[1]); // This will log the first element after the slash
    } else {
      console.log("No match found.");
    }
    const defaultFilenameBase = 'gcpd_matches';

    const cfg = Object.assign(
      {
        tab: 'playermatchhistory',
        delay: 100,
        maxPages: 2000,
        verbose: true,
        filenameBase: match ? match[1] : defaultFilenameBase,
        parseDates: true,
        parseNumbers: true,
        dedupe: true
      },
      opts || {}
    );

    const base = location.origin + location.pathname.replace(/\/$/, '');
    const sessionid = getSessionID();
    if (cfg.verbose)
      console.log('[GCPD] start', {
        base,
        hasSession: !!sessionid,
        delay: cfg.delay,
        maxPages: cfg.maxPages
      });

    const results = [];
    const seen = new Set();
    let token = null;
    let page = 0;

    async function safeFetch(urlStr) {
      let attempt = 0;
      const maxRetries = 5;
      const retryBaseDelay = 1000;
      while (attempt <= maxRetries) {
        try {
          const res = await fetch(urlStr, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
          if (!res.ok) {
            if (res.status === 429 || res.status === 503) {
              const backoff = retryBaseDelay * Math.pow(2, attempt);
              if (cfg.verbose)
                console.warn('[GCPD] throttled', res.status, 'backoff', backoff);
              await wait(backoff);
              attempt++;
              continue;
            }
            throw new Error('HTTP ' + res.status);
          }
          return JSON.parse(await res.text());
        } catch (err) {
          attempt++;
          if (attempt > maxRetries) throw err;
          const backoff = retryBaseDelay * Math.pow(2, attempt - 1);
          if (cfg.verbose)
            console.warn(
              '[GCPD] fetch error retry',
              attempt,
              'wait',
              backoff,
              err
            );
          await wait(backoff);
        }
      }
      throw new Error('unreachable');
    }

    while (page < cfg.maxPages) {
      page++;
      const url = new URL(base);
      url.searchParams.set('ajax', '1');
      url.searchParams.set('tab', cfg.tab);
      if (token) url.searchParams.set('continue_token', token);
      if (sessionid) url.searchParams.set('sessionid', sessionid);

      if (cfg.verbose) console.log('[GCPD] page', page, url.toString());
      const json = await safeFetch(url.toString());
      if (!json || !json.success) {
        if (cfg.verbose) console.warn('[GCPD] success=false or no json; stop.');
        break;
      }

      const tables = extractTablesFromHtml(json.html || '');
      let added = 0;
      for (const t of tables) {
        const parsed = parseMatchHtml(t.html, {
          parseDates: cfg.parseDates,
          parseNumbers: cfg.parseNumbers
        });
        if (!parsed) continue;
        if (t.id && !parsed.match_id) parsed.match_id = String(t.id);
        const key = cfg.dedupe && parsed.match_id ? 'id:' + parsed.match_id : '';
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        results.push(parsed);
        added++;
      }

      if (cfg.verbose)
        console.log(
          '[GCPD] page',
          page,
          'tables',
          tables.length,
          'added',
          added,
          'total',
          results.length
        );

      const newToken = json.continue_token || null;
      if (!newToken || newToken === token) {
        if (cfg.verbose)
          console.log('[GCPD] finished paging. token=', newToken);
        break;
      }
      token = newToken;
      await wait(cfg.delay);
    }

    // build csv
    const { csv, headers } = buildCsv(results, ORDERED_COLUMNS, cfg.verbose);
    const fname =
      (cfg.filenameBase || 'gcpd_matches').replace(/[^\w\-_.]/g, '_') +
      '.csv';
    downloadBlob(csv, fname, 'text/csv');

    const summary = {
      status: 'done',
      pages: page,
      matches: results.length,
      columns: headers.length
    };
    if (cfg.verbose) console.log('[GCPD] complete', summary);
    return summary;
  }

  gcpdFetchAndParseAll({
    delay: 100,
    maxPages: 2000,
    filenameBase: 'gcpd_matches',
    verbose: true
  })
    .then((r) => console.log('finished', r))
    .catch(console.error);
})();
