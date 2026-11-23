'use strict';
/*
 * Shared-link pilot: keeps one Maa database shared by everyone on the artifact,
 * using the artifact's `db` capability.
 *
 * The whole SQLite file is the unit of truth. It is gzipped, base64-encoded and
 * stored in chunks (documents are capped at 256 KiB), with a small `maa/head`
 * document naming the current version. Every change:
 *   1. takes the `maa/lock` lease (one writer at a time),
 *   2. downloads the newest version if this browser is behind,
 *   3. runs the real server route on it,
 *   4. uploads the new version (chunks first, then head) and releases the lease.
 * Every open page listens to `maa/head` and reloads when someone else saves.
 *
 * Product photos live in their own documents (`maa/img-<productId>`), so a save
 * does not re-upload them.
 */
const { HttpError } = require('../src/http');

const CHUNK = 180_000;              // base64 characters per document (well under 256 KiB)
const LOCK_TTL = 15_000;
const LOCK_WAIT = 25_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('');

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

/**
 * @param store   the `db` capability namespace
 * @param holder  a stable string for this tab (lease holder)
 * @param open    (bytes|null) => void  replaces the local database with these bytes (null = new)
 * @param exportBytes () => Uint8Array  current local database file
 * @param onRemote () => void  called after another person's save was loaded
 */
function createSharedSync({ store, holder, open, exportBytes, onRemote }) {
  const headRef = store.doc('maa/head');
  const lockRef = store.doc('maa/lock');
  let local = null;        // { tag, version, bytes } of the version loaded here
  let writing = false;
  let pendingRemote = null;

  async function download(head) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = await Promise.all(Array.from({ length: head.chunks }, (_, i) => store.doc(`maa/s-${head.tag}-${i}`).get()));
      if (parts.every((p) => p.exists)) return gunzip(fromB64(parts.map((p) => p.data().d).join('')));
      // A newer save replaced this version while we were reading: read the new head.
      const fresh = (await headRef.get()).data();
      if (!fresh) break;
      head = fresh;
    }
    throw new HttpError(503, 'Could not load the shared data. Check the connection and reload.', { code: 'sync_failed' });
  }

  async function load(head) {
    const bytes = await download(head);
    open(bytes);
    local = { tag: head.tag, version: head.version, bytes, chunksCount: head.chunks };
  }

  async function upload() {
    const bytes = exportBytes();
    const b64 = toB64(await gzip(bytes));
    const version = (local?.version || 0) + 1;
    const tag = `${version}-${randomId()}`;
    const chunks = Math.max(1, Math.ceil(b64.length / CHUNK));
    for (let i = 0; i < chunks; i++) await store.doc(`maa/s-${tag}-${i}`).set({ d: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
    const previous = local;
    await headRef.set({ tag, version, chunks, at: new Date().toISOString(), bytes: bytes.length });
    local = { tag, version, bytes, chunksCount: chunks };
    // Best effort: remove the replaced version's chunks (a reader caught mid-download re-reads the head).
    if (previous?.tag && previous.chunksCount) {
      for (let i = 0; i < previous.chunksCount; i++) store.doc(`maa/s-${previous.tag}-${i}`).delete().catch(() => {});
    }
  }

  async function lock() {
    const until = Date.now() + LOCK_WAIT;
    for (;;) {
      const r = await lockRef.acquire({ holder, ttlMs: LOCK_TTL });
      if (r.acquired) return;
      if (Date.now() > until) throw new HttpError(503, 'Someone else is saving right now. Try again in a moment.', { code: 'busy' });
      await sleep(250 + Math.random() * 350);
    }
  }
  // Leases have no release call: renewing with the shortest length ends it within a second.
  const unlock = () => lockRef.acquire({ holder, ttlMs: 1000 }).catch(() => {});

  return {
    /** First load. Resolves 'ready', or 'not_setup' when nobody has created the shared data yet. */
    async start({ canCreate, create }) {
      const head = (await headRef.get()).data();
      if (head) {
        await load(head);
      } else {
        if (!canCreate) return 'not_setup';
        await lock();
        try {
          const again = (await headRef.get()).data();
          if (again) await load(again);
          else { open(null); create(); await upload(); }
        } finally { unlock(); }
      }
      headRef.onSnapshot((snap) => {
        const h = snap.data();
        if (!h || h.tag === local?.tag || snap.metadata.hasPendingWrites) return;
        if (writing) { pendingRemote = h; return; }
        load(h).then(onRemote).catch(() => {});
      }, () => {});
      return 'ready';
    },

    /**
     * Run a change against the newest shared version. `fn` returns true when it
     * changed the database (then the new version is uploaded). On any failure the
     * local copy goes back to the last shared version.
     */
    async write(fn) {
      writing = true;
      await lock();
      try {
        const head = (await headRef.get()).data();
        if (head && head.tag !== local?.tag) await load(head);
        let changed;
        try {
          changed = await fn();
        } catch (e) {
          open(local.bytes);
          throw e;
        }
        if (changed) {
          try { await upload(); } catch (e) {
            open(local.bytes);
            throw new HttpError(503, 'Saving failed. Check the connection and try again.', { code: 'sync_failed' });
          }
        }
        return changed;
      } finally {
        unlock();
        writing = false;
        if (pendingRemote && pendingRemote.tag !== local?.tag) { const h = pendingRemote; pendingRemote = null; load(h).then(onRemote).catch(() => {}); }
        pendingRemote = null;
      }
    },
  };
}

module.exports = { createSharedSync, toB64, fromB64 };
