const mysql = require('mysql2');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Math.max(1, Number(process.env.DB_POOL_SIZE) || 25),
  queueLimit: 0,
});

module.exports = pool.promise();
