import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/database";
test("CRM search uses consistent tokens for hyphenated email and name prefixes", async () => {
  const db = await createTestDatabase();
  try {
    for (const [text, query, matches] of [
      [
        "fictional-test@accounts.example.test",
        "fictional-test@accounts.example.test",
        true,
      ],
      [
        "fictional+crm@accounts.example.test",
        "fictional+crm@accounts.example.test",
        true,
      ],
      ["Fictional Smith-Jones", "Smith-Jones", true],
      ["Fictional Eleanor", "Ele", true],
      ["Fictional Eleanor", "Unrelated", false],
    ] as const) {
      const result = await db.query<{ matches: boolean }>(
        "select to_tsvector('simple',$1) @@ private.crm_search($2) as matches",
        [text, query],
      );
      assert.equal(result.rows[0].matches, matches);
    }
    const result = await db.query<{ empty: boolean }>(
      "select private.crm_search('') is null as empty",
    );
    assert.equal(result.rows[0].empty, true);
  } finally {
    await db.close();
  }
});
