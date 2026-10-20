/* Writes golden.json from the current code. Usage: node tests/unit/safety/services/__golden__/generate.js [outFile] */
const fs = require('fs');
const path = require('path');
const { computeGolden } = require('./scenarios');

computeGolden().then((golden) => {
  const out = process.argv[2] || path.join(__dirname, 'golden.json');
  fs.writeFileSync(out, `${JSON.stringify(golden, null, 1)}\n`);
  console.log(`wrote ${out}`);
});
