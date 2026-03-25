const fs = require('fs');
const path = require('path');

const SRC_ORDER = [
  'src/header.js',
  'src/worldmap.js',
  'src/grouping.js',
  'src/rate-limit.js',
  'src/api.js',
  'src/save-ops.js',
  'src/modal.js',
  'src/header-button.js',
  'src/init.js',
];

const OUT = 'universalis-alert.user.js';

const combined = SRC_ORDER.map(f => {
  const content = fs.readFileSync(path.join(__dirname, f), 'utf8');
  return `// ===== ${f} =====\n${content}`;
}).join('\n\n');

fs.writeFileSync(path.join(__dirname, OUT), combined, 'utf8');
console.log(`Built ${OUT} (${combined.length} bytes)`);
