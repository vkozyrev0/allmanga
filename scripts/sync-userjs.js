'use strict';

// Copy redirect-blocking-extension.js → .user.js, pointing
// @downloadURL / @updateURL at the .user.js file. The two artifacts
// must stay identical except for those URLs.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'redirect-blocking-extension.js');
const dest = path.join(root, 'redirect-blocking-extension.user.js');
const js = fs.readFileSync(src, 'utf8');
const user = js.replace(/redirect-blocking-extension\.js/g, 'redirect-blocking-extension.user.js');
fs.writeFileSync(dest, user);
console.log('Wrote', path.relative(root, dest));
