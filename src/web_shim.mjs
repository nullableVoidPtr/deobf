let isBufferShim = () => false;
export { isBufferShim as 'Buffer.isBuffer' };

let processEnvShim = {};
export { processEnvShim as 'process.env' };

let processPlatformShim = 'browser';
export { processPlatformShim as 'process.platform' };