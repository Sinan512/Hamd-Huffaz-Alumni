const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    console.log("URI exists:", !!process.env.MONGODB_URI);
    console.log(process.env.MONGODB_URI);

    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB Connected:", conn.connection.host);
  } catch (err) {
    console.error(err);
  }
};

module.exports = connectDB;