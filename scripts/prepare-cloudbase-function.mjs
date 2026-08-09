import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envId = 'yuxi-d1gt0cq1de912944c';
const source = path.join(root, 'server');
const target = path.join(root, 'cloudfunctions', 'somewhere-api', 'server');
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const localEnv = read(path.join(root, '.env.local'));
const value = (name) => localEnv.match(new RegExp(`^${name}\\s*=\\s*([^\\n#]+)`, 'm'))?.[1]?.trim().replace(/^['\"]|['\"]$/g, '');
fs.cpSync(source, target, { recursive: true, filter: (entry) => !entry.endsWith('.test.mjs') });
const config = {
  $schema: 'https://static.cloudbase.net/cli/cloudbaserc.schema.json', envId, functionRoot: 'cloudfunctions',
  functions: [{ name: 'somewhere-api', runtime: 'Nodejs20.19', timeout: 60, memorySize: 512, isHTTP: true, handler: 'index.main', envVariables: {
    TOKENHUB_BASE_URL: value('TOKENHUB_BASE_URL') || 'https://tokenhub.tencentmaas.com',
    TOKENHUB_MODEL: value('TOKENHUB_MODEL') || 'hy3',
    TOKENHUB_MEDIA_MODEL: value('TOKENHUB_MEDIA_MODEL') || 'youtu-vita',
  } }],
};
fs.writeFileSync(path.join(root, 'cloudbaserc.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log('CloudBase function package prepared without printing credentials.');
