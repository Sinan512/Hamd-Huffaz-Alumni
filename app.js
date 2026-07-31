require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');
var MongoStore = require('connect-mongo');

var connectDB = require('./config/db');

var homeRouter   = require('./routes/home');
var adminRouter = require('./routes/admin');
var usersRouter = require('./routes/users');
var leadersRouter = require('./routes/leaders');

var app = express();

// Connect to MongoDB (optional — home page works without it)
if (process.env.MONGODB_URI) {
  connectDB();
} else {
  console.warn('MONGODB_URI not set — running without database (home page only).');
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ================================================================== */
/* SESSIONS  –  stored in MongoDB "SESSIONS" collection, 7 day validity */
/* ================================================================== */

var SEVEN_DAYS_MS  = 7 * 24 * 60 * 60 * 1000;
var SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

var isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

// Required so the "secure" cookie works behind a proxy
app.set('trust proxy', 1);

var sessionConfig = {
  name: 'hamd.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: SEVEN_DAYS_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/'
  }
};

if (process.env.MONGODB_URI) {
  sessionConfig.store = MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'SESSIONS',
    ttl: SEVEN_DAYS_SEC,
    touchAfter: 24 * 3600,
    autoRemove: 'native',
    stringify: false
  });
}

app.use(session(sessionConfig));

// Make login state available to every view
app.use(function (req, res, next) {
  res.locals.isLoggedIn = !!(req.session && req.session.memberId);
  res.locals.memberName = (req.session && req.session.memberName) || null;
  next();
});

// Home page + its public image endpoints — see routes/home.js
app.use('/', homeRouter);

app.use('/admin', adminRouter);
app.use('/users', usersRouter);
app.use('/leaders', leadersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
