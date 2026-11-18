'use strict';
// Only browser assets belong in the static output. API code/data remain in the
// function bundle; do not copy the repository wholesale into the public site.
const fs = require('node:fs'), path = require('node:path');
const PUBLIC_DATA = ['nfl_rankings.json','site_sheets.json','sheet_sources.json'];
function build(root = path.resolve(__dirname, '..')) {
  const output = path.join(root, 'public-build');
  // Fixed child of the verified project root, never a caller-provided delete path.
  if (path.dirname(output) !== path.resolve(root)) throw new Error('Invalid output path');
  fs.rmSync(output, {recursive:true,force:true});
  fs.mkdirSync(output, {recursive:true});
  for (const file of fs.readdirSync(root, {withFileTypes:true})) {
    if (file.isFile() && /\.(html|css|js)$/.test(file.name)) fs.copyFileSync(path.join(root,file.name),path.join(output,file.name));
  }
  fs.cpSync(path.join(root,'assets'),path.join(output,'assets'),{recursive:true});
  fs.mkdirSync(path.join(output,'data'));
  for (const file of PUBLIC_DATA) fs.copyFileSync(path.join(root,'data',file),path.join(output,'data',file));
  return output;
}
if (require.main === module) { build(); console.log('Public site built; server code and weekly datasets excluded.'); }
module.exports = {build, PUBLIC_DATA};
