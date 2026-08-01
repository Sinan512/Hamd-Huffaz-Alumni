const mongoose = require("mongoose");

let connectionPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGODB_URI);
  }

  await connectionPromise;
  return mongoose.connection;
}

module.exports = connectDB;
