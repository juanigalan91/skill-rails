#!/usr/bin/env node
// parse: the IDs in $TEXT, and the protected ones. select: the IDs to keep, from the confirmations.
const json = (name) => JSON.parse(process.env[name] || 'null') ?? [];
if (process.argv[2] === 'select') {
  const answers = new Map(json('ANSWERS').map((r) => [r.item, r.steps?.confirm?.outputs?.ok]));
  const skipped = json('PROTECTED').filter((id) => process.env.AUTO === 'true' || answers.get(id) !== true);
  console.log(JSON.stringify({ ids: json('IDS').filter((id) => !skipped.includes(id)), skipped }));
} else {
  const ids = [...new Set((process.env.TEXT ?? '').match(/\b[A-Z]{2,5}-\d+\b/g) ?? [])];
  console.log(JSON.stringify({ ids, protected: ids.filter((id) => id.startsWith('SEC-')) }));
}
