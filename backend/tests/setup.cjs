if (typeof globalThis.File === 'undefined') {
  globalThis.File = class File {};
}

if (!process.env.CDS_CONFIG_PATH) {
  const path = require('node:path');
  const fs = require('node:fs');
  const candidatePaths = [
    path.resolve(process.cwd(), '../cds-automated-minutes.appConfig.json'),
    path.resolve(process.cwd(), '../cds-automated-minutes.LOCALDEV.appConfig.json')
  ];
  const existingPath = candidatePaths.find(p => fs.existsSync(p));
  if (existingPath) {
    process.env.CDS_CONFIG_PATH = existingPath;
  }
}
