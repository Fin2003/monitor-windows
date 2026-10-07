const worker = process.argv.find(argument => argument.startsWith('--esp32-worker='))?.split('=')[1];
if (worker === 'encrypt') require('../scripts/esp32-encrypt-secret.cjs');
else if (worker === 'translation') require('../scripts/esp32-radar-translation.cjs');
else require('./main.js');
