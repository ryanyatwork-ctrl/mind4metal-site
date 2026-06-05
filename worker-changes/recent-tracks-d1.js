// ===========================================================================
// D1-backed "recently played"  (drop-in replacement for the KV recent logic)
// ---------------------------------------------------------------------------
// WHY: the every-minute cron writing the recent list to KV is what blows the
// free-tier KV write limit (1,000/day) and forced LOW_KV_MODE on. D1's free
// tier is 100,000 writes/day, so the recent list belongs there. Album art
// stays in KV (write-once, read-many).
//
// HOW TO APPLY (against the LIVE mind4metal-art-resolver source — pull it first,
// do not deploy the stale repo copy; see INTEGRATION.md):
//   1. Add the D1 binding from wrangler-additions.jsonc (binding name RECENT_DB).
//   2. Paste the three functions below, replacing the KV versions of
//      updateRecentTracks / handleRecent / handleRecentPoll.
//   3. In fetch(): route /api/recent -> handleRecent, /api/recent/poll ->
//      handleRecentPoll (names unchanged below, so no router edit needed).
//   4. In scheduled(): call updateRecentTracks WITHOUT the LOW_KV_MODE guard
//      (D1 has the write headroom):  ctx.waitUntil(updateRecentTracks(env));
//   5. With recent off KV, art-only writes are well under 1,000/day, so you can
//      also set LOW_KV_MODE = false to re-enable art persistence.
//
// Reuses existing helpers from the worker: readCurrentTrack(), recentCombo(),
// RECENT_MAX, json().
// ===========================================================================

async function updateRecentTracks(env) {
  const db = env.RECENT_DB;
  if (!db) return { ok: false, error: 'recent_db_not_bound' };

  const track = await readCurrentTrack();
  const combo = recentCombo(track);
  if (!combo) return { ok: true, changed: false, current: track };

  // No-op if the newest row is already this track.
  const last = await db
    .prepare('SELECT combo FROM recent_tracks ORDER BY played_at DESC LIMIT 1')
    .first('combo');
  if (last === combo) return { ok: true, changed: false, current: track };

  // Upsert to the top.
  await db
    .prepare(
      `INSERT INTO recent_tracks (combo, artist, title, listeners, raw, played_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(combo) DO UPDATE SET
         artist=excluded.artist, title=excluded.title,
         listeners=excluded.listeners, raw=excluded.raw, played_at=excluded.played_at`
    )
    .bind(combo, track.artist, track.title, track.listeners, track.raw, track.at)
    .run();

  // Trim to the most-recent RECENT_MAX rows.
  await db
    .prepare(
      `DELETE FROM recent_tracks WHERE combo NOT IN
         (SELECT combo FROM recent_tracks ORDER BY played_at DESC LIMIT ?1)`
    )
    .bind(RECENT_MAX)
    .run();

  return { ok: true, changed: true, current: track };
}

async function handleRecent(env) {
  const db = env.RECENT_DB;
  if (!db) return json({ ok: false, error: 'recent_db_not_bound', recent: [] }, { status: 503 });

  const { results } = await db
    .prepare(
      `SELECT artist, title, listeners, raw, played_at AS at
         FROM recent_tracks ORDER BY played_at DESC LIMIT ?1`
    )
    .bind(RECENT_MAX)
    .all();

  return json({ ok: true, recent: results || [] });
}

async function handleRecentPoll(env) {
  try {
    return json(await updateRecentTracks(env));
  } catch (error) {
    return json(
      { ok: false, error: 'recent_poll_failed', detail: String(error?.message || error) },
      { status: 502 }
    );
  }
}
