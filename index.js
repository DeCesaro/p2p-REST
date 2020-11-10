const { argv } = require('yargs');

const mode = argv.server ? require('./server') : require('./client');
