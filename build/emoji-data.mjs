import {gemoji} from 'gemoji';
import {writeFile,copyFile} from 'node:fs/promises';
const rows=gemoji.map(item=>({emoji:item.emoji,names:item.names,tags:item.tags,description:item.description}));
await writeFile(new URL('../public/emoji-data.json',import.meta.url),JSON.stringify(rows)+'\n');
await copyFile(new URL('../node_modules/gemoji/license',import.meta.url),new URL('../public/emoji-data-LICENSE.txt',import.meta.url));
console.log('Built '+rows.length+' standard emoji entries with shortcode aliases.');
