// tests/test-elogo-sync.js
// Dry run for eLogo sync — run with: node tests/test-elogo-sync.js
'use strict';

require('dotenv').config();

const { runElogoSync } = require('./services/elogo-sync-service');

(async () => {
  console.log('🧪 eLogo Sync Dry Run başlatılıyor...\n');
  try {
    await runElogoSync();
    console.log('\n✅ Dry run tamamlandı.');
  } catch (err) {
    console.error('\n❌ Dry run hatası:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();