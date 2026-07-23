const cluster = require('cluster');
const os = require('os');
const pino = require('pino')({ level: 'info' });

const numCPUs = os.cpus().length;
const WORKERS = process.env.CLUSTER_WORKERS || numCPUs;

if (cluster.isMaster) {
  pino.info(`Talon Cluster Master — ${WORKERS} workers on ${numCPUs} cores`);
  
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    pino.warn(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });
} else {
  require('./server');
}
