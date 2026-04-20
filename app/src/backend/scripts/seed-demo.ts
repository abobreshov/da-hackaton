// Demo-data seed — EPIC-12 AC-12-10
// Creates public rooms #general, #random, #demo with sample messages.
// Idempotent: ON CONFLICT DO NOTHING on room name.
//
// Run: yarn workspace @app/backend seed:demo
//
// NOTE: implementation deferred until rooms + messages migrations land
// (EPIC-05 + EPIC-07). Current stub only logs the plan + exits 0 so
// compose lifecycle + dev.sh can invoke it without failing.

import 'dotenv/config';

async function main() {
  const rooms = [
    { name: 'general', topic: 'Welcome! Say hi.' },
    { name: 'random',  topic: 'Casual chat.' },
    { name: 'demo',    topic: 'Showcases reply / edit / delete / attachments.' },
  ];

  // eslint-disable-next-line no-console
  console.log('[seed:demo] planned rooms:', rooms.map((r) => `#${r.name}`).join(', '));
  // eslint-disable-next-line no-console
  console.log('[seed:demo] no-op stub; implement after EPIC-05 + EPIC-07 ship');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed:demo] failed:', err);
  process.exit(1);
});
