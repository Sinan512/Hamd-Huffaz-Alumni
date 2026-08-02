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
const { log } = require('console');

var app = express();


// Connect to MongoDB (optional — home page works without it)
if (process.env.MONGODB_ATLAS) {
  process.env.MONGODB_URI=
  process.env.USE_LOCAL_DB === "false"
  ? process.env.MONGODB_LOCAL
  : process.env.MONGODB_ATLAS;
  connectDB();
  console.log(process.env.MONGODB_URI+ " DB running");
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

/* A changing secret invalidates every existing session, so warn loudly if the
   development fallback is used in production. */
var SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set — using the development fallback. Set it in .env so logins survive restarts.');
}

var sessionConfig = {
  name: 'hamd.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,           // every request pushes the expiry 7 more days out
  unset: 'destroy',
  cookie: {
    maxAge: SEVEN_DAYS_MS,
    expires: new Date(Date.now() + SEVEN_DAYS_MS), // never a browser-session cookie
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/'
  }
};

/* Persist sessions in MongoDB. Without a store express-session falls back to
   MemoryStore, which loses every login on restart / serverless cold start —
   the main reason sessions appeared to expire early. */
var SESSION_MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGODB_ATLAS || process.env.MONGODB_LOCAL;

if (SESSION_MONGO_URI) {
  sessionConfig.store = MongoStore.create({
    mongoUrl: SESSION_MONGO_URI,
    collectionName: 'SESSIONS',
    ttl: SEVEN_DAYS_SEC,
    /* Keep the stored expiry in step with the rolling cookie. With the old
       24 hour value the DB document could expire before the cookie did. */
    touchAfter: 0,
    autoRemove: 'native',
    stringify: false,
  });
} else {
  console.warn('No MongoDB URI configured — sessions use in-memory storage and will NOT survive a restart.');
}

app.use(session(sessionConfig));

/* Refresh both the cookie window and the stored session document on every
   request from a logged-in user, so an active user is never signed out
   before a full 7 idle days have passed. */
app.use(function (req, res, next) {
  if (req.session && (req.session.memberId || req.session.adminId || req.session.leaderId)) {
    req.session.cookie.maxAge = SEVEN_DAYS_MS;
    req.session.cookie.expires = new Date(Date.now() + SEVEN_DAYS_MS);
    req.session.touch();
  }
  next();
});


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
