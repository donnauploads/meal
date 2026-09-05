'use strict';
/*
 * Fetch the MaxMind GeoLite2 database at build/start time so IP → city lookups
 * work on hosts where the .mmdb isn't committed (it's gitignored + license-
 * restricted). Pure Node — no curl/tar dependency — and NON-FATAL: it exits 0
 * on a missing key, an already-present file, or any error, so it can never
 * break a build or a boot. Geo is an optional enhancement.
 *
 *   MAXMIND_LICENSE_KEY  — required to download (from maxmind.com). If unset,
 *                          this is a no-op and geo enrichment stays disabled.
 *   GEOIP_MMDB_PATH      — where to write it (default ./tooling/geoip/GeoLite2-City.mmdb).
 *                          MUST match what the app reads at runtime.
 *   GEOIP_EDITION        — optional; default "GeoLite2-City".
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const KEY = process.env.MAXMIND_LICENSE_KEY;
const OUT = process.env.GEOIP_MMDB_PATH || './tooling/geoip/GeoLite2-City.mmdb';
const EDITION = process.env.GEOIP_EDITION || 'GeoLite2-City';

const log = (m) => console.log(`[fetch-geoip] ${m}`);

async function main() {
  if (!KEY) {
    log('MAXMIND_LICENSE_KEY not set — skipping GeoIP download (geo stays disabled).');
    return;
  }
  // Skip if we already have a plausibly-complete file (baked in by an earlier
  // build, or a previous start on the same container).
  if (fs.existsSync(OUT) && fs.statSync(OUT).size > 1_000_000) {
    log(`Already present at ${OUT} — skipping download.`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const url =
    `https://download.maxmind.com/app/geoip_download?edition_id=${EDITION}` +
    `&license_key=${encodeURIComponent(KEY)}&suffix=tar.gz`;
  log(`Downloading ${EDITION}…`);
  const gz = await get(url);
  const tar = zlib.gunzipSync(gz);
  const mmdb = extractMmdb(tar);
  if (!mmdb) throw new Error('no .mmdb entry found in archive');
  fs.writeFileSync(OUT, mmdb);
  log(`Wrote ${OUT} (${(mmdb.length / 1024 / 1024).toFixed(1)} MB).`);
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const { statusCode, headers } = res;
        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && redirects < 5) {
          res.resume();
          return resolve(get(headers.location, redirects + 1));
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

/**
 * Minimal tar reader — returns the bytes of the first `.mmdb` entry. GeoLite2
 * tarballs contain a single dated folder with COPYRIGHT/LICENSE txt files plus
 * the .mmdb; we only need the database.
 */
function extractMmdb(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break; // end-of-archive zero block
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const start = off + 512;
    if (name.endsWith('.mmdb')) return buf.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512; // advance past this entry's data
  }
  return null;
}

main().catch((e) => {
  log(`Skipping GeoIP download (non-fatal): ${e.message}`);
  process.exit(0); // never fail the build/boot over geo
});
