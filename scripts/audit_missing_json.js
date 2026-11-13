const fs = require('fs');
const path = require('path');

const dp = fs.readFileSync(path.join(__dirname, '..', 'data_provider.js'), 'utf8');
const regex = /['"]([a-zA-Z0-9_\-]+\.json)['"]/g;
let m;
const files = new Set();
while ((m = regex.exec(dp)) !== null) {
  files.add(m[1]);
}

console.log('--- ALL JSON REFERENCES IN data_provider.js ---');
const allJson = Array.from(files).sort();

allJson.forEach(f => {
  // check where it exists in data/
  const searchDirs = [
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, '..', 'data', 'neosoft_db'),
    path.join(__dirname, '..', 'data', 'operational_db'),
    path.join(__dirname, '..', 'data', 'marketing_db'),
    path.join(__dirname, '..', 'data', 'google_sheets_db'),
    path.join(__dirname, '..', 'data', 'google_maps_db')
  ];
  let found = [];
  searchDirs.forEach(d => {
    const p = path.join(d, f);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      let count = 0;
      try {
        const c = JSON.parse(fs.readFileSync(p, 'utf8'));
        count = Array.isArray(c) ? c.length : Object.keys(c).length;
      } catch(e) { count = 'ERR'; }
      found.push(`${path.relative(path.join(__dirname, '..'), p)} (${stat.size}b, ${count} items)`);
    }
  });
  if (found.length === 0) {
    console.log(`[MISSING] ${f}`);
  } else {
    console.log(`[FOUND] ${f} -> ${found.join(', ')}`);
  }
});
