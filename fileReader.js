import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import util from 'util';

const { argv } = require('yargs');

const rootFolder = process.cwd();
const filesPath = path.resolve(rootFolder, argv.files.trim());

// Gets the the names of all files inside the informed folder.
const getFileNames = async (folderPath) => {
  if (!argv.files) {
    console.log(`Files path is empty.`);
    process.exit();
  }
  const readdir = util.promisify(fs.readdir);
  try {
    const fileNames = await readdir(folderPath);
    return fileNames;
  } catch (err) {
    console.log(`Couldn't find "${folderPath}".`);
  }
};

// Calculates the hash of a single file using md5.
const hashFile = (folder, file) => {
  const hash = crypto.createHash('md5');
  hash.setEncoding('hex');
  const filePath = path.resolve(folder, file);

  if (fs.lstatSync(filePath).isDirectory()) {
    console.log(`Ignored folder: ${file}`);
    return;
  }

  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats.size;

  const fileStream = fs.createReadStream(filePath);

  fileStream.on('data', (data) => {
    hash.update(data, 'utf8');
  });

  fileStream.on('error', () => {});

  const value = new Promise((resolve) => {
    fileStream.on('end', () => {
      const hashed = {
        file,
        size: fileSizeInBytes,
        hash: hash.digest('hex')
      };
      resolve(hashed);
    });
  });
  return value;
};

// Calculates the hash of all files inside the
// folder received on startup.
const calculateHash = async () => {
  const files = await getFileNames(filesPath);
  const result = files.map((file) => hashFile(filesPath, file));

  const hashes = await Promise.all(result.filter((res) => res));
  console.log(`Found ${hashes.length} files.`);
  return hashes;
};

const getFile = async (fileName) => {
  const readFile = util.promisify(fs.readFile);
  const filePath = path.resolve(filesPath, fileName);
  const file = await readFile(filePath);
  return file;
};

// Writes the file to the downloads folder.
const createFile = async (fileName, data, hash) => {
  const writeFile = util.promisify(fs.writeFile);
  const mkdir = util.promisify(fs.mkdir);
  const downloadsPath = path.resolve(rootFolder, 'downloads');
  const filePath = path.resolve(downloadsPath, fileName);
  try {
    await writeFile(filePath, data);
  } catch (error) {
    await mkdir(downloadsPath);
    await writeFile(filePath, data);
  }

  const calculatedHash = await hashFile(downloadsPath, fileName);
  if (hash) return hash === calculatedHash.hash;
};

module.exports = {
  calculateHash,
  getFile,
  createFile
};
