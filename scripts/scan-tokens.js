const fs = require('fs');
const path = require('path');

function scan(dir) {
  const results = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      results.push(...scan(p));
    } else if (f.name.endsWith('.html') || f.name.endsWith('.css') || f.name.endsWith('.js')) {
      const c = fs.readFileSync(p, 'utf8');
      const matches = c.match(/var\(--(ink-[0-9]+|paper|forest-[0-9]+|gold-[0-9]+|line)\)/g);
      if (matches) {
        results.push({ file: p, tokens: [...new Set(matches)] });
      }
    }
  }
  return results;
}

const found = scan('public');
console.log(JSON.stringify(found, null, 2));
