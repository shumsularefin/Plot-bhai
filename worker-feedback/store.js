/* The database of the feedback Worker: the store interface of feedback.js on Cloudflare D1. */

/** The store interface of feedback.js on D1. */
export function d1Store(db) {
  const one = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .first();
  const run = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .run();
  const all = async (sql, ...args) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .all()
    ).results;
  return {
    async counters() {
      const rows = await all('SELECT name, value FROM counters');
      const value = (name) => rows.find((r) => r.name === name)?.value ?? 0;
      return {
        visits: value('visits'),
        analyses: value('analyses'),
        validations: value('validations'),
      };
    },
    bump: (name) =>
      run(
        'INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET value = value + 1',
        name,
      ),
    async daily(day, kind, who) {
      const row = await one(
        'SELECT count FROM daily WHERE day = ? AND kind = ? AND who = ?',
        day,
        kind,
        who,
      );
      return row?.count ?? 0;
    },
    incrementDaily: (day, kind, who) =>
      run(
        'INSERT INTO daily (day, kind, who, count) VALUES (?, ?, ?, 1) ON CONFLICT (day, kind, who) DO UPDATE SET count = count + 1',
        day,
        kind,
        who,
      ),
    prune: (before) => run('DELETE FROM daily WHERE day < ?', before),
    addAnalysis: (a) =>
      run(
        'INSERT INTO analyses (id, day, tool, browser) VALUES (?, ?, ?, ?)',
        a.id,
        a.day,
        a.tool,
        a.browser,
      ),
    async analysis(id) {
      const row = await one(
        'SELECT id, day, tool, browser, validated FROM analyses WHERE id = ?',
        id,
      );
      return row ? { ...row, validated: row.validated === 1 } : null;
    },
    markValidated: (id) => run('UPDATE analyses SET validated = 1 WHERE id = ?', id),
    addValidation: (v) =>
      run(
        'INSERT INTO validations (created, tool, verdict, comment, status) VALUES (?, ?, ?, ?, ?)',
        v.created,
        v.tool,
        v.verdict,
        v.comment,
        v.status,
      ),
    approved: (limit) =>
      all(
        "SELECT id, created, tool, verdict, comment FROM validations WHERE status = 'approved' AND comment != '' ORDER BY id DESC LIMIT ?",
        limit,
      ),
    pending: (limit) =>
      all(
        "SELECT id, created, tool, verdict, comment FROM validations WHERE status = 'pending' ORDER BY id LIMIT ?",
        limit,
      ),
    async setStatus(id, status) {
      const result = await run(
        "UPDATE validations SET status = ? WHERE id = ? AND status = 'pending'",
        status,
        id,
      );
      return (result.meta?.changes ?? 0) > 0;
    },
  };
}
