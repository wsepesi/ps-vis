#!/usr/bin/env tsx
/**
 * Test script to generate replay summaries from command line
 * Usage: npx tsx test-replay.ts <replay-url>
 * Example: npx tsx test-replay.ts https://replay.pokemonshowdown.com/gen9vgc2024reghbo3-2247069894
 */

import { summarizeReplay } from './src/lib/parser';

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('Usage: npx tsx test-replay.ts <replay-url>');
    console.error('Example: npx tsx test-replay.ts https://replay.pokemonshowdown.com/gen9vgc2024reghbo3-2247069894');
    process.exit(1);
  }

  try {
    console.log(`Fetching replay: ${url}\n`);
    const result = await summarizeReplay(url);

    console.log('=== TEXT OUTPUT ===');
    console.log(result.text);
    console.log('\n=== HTML OUTPUT ===');
    console.log(result.html);
    console.log('\n=== METADATA ===');
    console.log(JSON.stringify(result.meta, null, 2));
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
