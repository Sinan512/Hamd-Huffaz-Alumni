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
var mediaRouter   = require('./routes/media');
var usersRouter = require('./routes/users');
var leadersRouter = require('./routes/leaders');
var financeRouter = require('./routes/finance');
const { log } = require('console');

var app = express();


// Connect to MongoDB (optional — home page works without it)
if (process.env.MONGODB_ATLAS) {
  process.env.MONGODB_URI=
  process.env.USE_ATLAS_DB === "false"
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
/* Multi-role isolation: dedicated cookie name per portal so that     */
/* Admin, Finance, Leader, and User can stay logged in simultaneously */
/* on the same system without cookie collisions or session overrides. */
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

/* Persist sessions in MongoDB. Without a store express-session falls back to
   MemoryStore, which loses every login on restart / serverless cold start —
   the main reason sessions appeared to expire early. */
var SESSION_MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGODB_ATLAS || process.env.MONGODB_LOCAL;

var sharedMongoStore = null;
if (SESSION_MONGO_URI) {
  sharedMongoStore = MongoStore.create({
    mongoUrl: SESSION_MONGO_URI,
    collectionName: 'SESSIONS',
    ttl: SEVEN_DAYS_SEC,
    touchAfter: 0,
    autoRemove: 'native',
    stringify: false,
  });
} else {
  console.warn('No MongoDB URI configured — sessions use in-memory storage and will NOT survive a restart.');
}

function createSessionMiddleware(cookieName) {
  var sessionConfig = {
    name: cookieName,
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

  if (sharedMongoStore) {
    sessionConfig.store = sharedMongoStore;
  }

  return session(sessionConfig);
}

var adminSession   = createSessionMiddleware('hamd.admin.sid');
var financeSession = createSessionMiddleware('hamd.finance.sid');
var leaderSession  = createSessionMiddleware('hamd.leader.sid');
var userSession    = createSessionMiddleware('hamd.user.sid');

function touchSession(req, res, next) {
  if (req.session && (req.session.memberId || req.session.adminId || req.session.leaderId || req.session.financeId)) {
    req.session.cookie.maxAge = SEVEN_DAYS_MS;
    req.session.cookie.expires = new Date(Date.now() + SEVEN_DAYS_MS);
    if (typeof req.session.touch === 'function') {
      req.session.touch();
    }
  }
  next();
}

// Public, read-only image endpoints (not behind admin auth) — see routes/media.js
app.use('/media', mediaRouter);

// Role-specific portals with isolated session cookies
app.use('/admin', adminSession, touchSession, adminRouter);
app.use('/finance', financeSession, touchSession, financeRouter);
app.use('/leaders', leaderSession, touchSession, leadersRouter);
app.use('/users', userSession, touchSession, usersRouter);

// Home page + its public image endpoints — see routes/home.js
app.use('/', userSession, touchSession, function (req, res, next) {
  res.locals.isLoggedIn = !!(req.session && req.session.memberId);
  res.locals.memberName = (req.session && req.session.memberName) || null;
  next();
}, homeRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  var status = err.status || 500;
  var message = err.message || (status === 404 ? 'Page Not Found' : 'Internal Server Error');

  // set locals, only providing error in development
  res.locals.message = message;
  res.locals.status = status;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(status);
  res.render('error', {
    layout: false,
    status: status,
    message: message,
    error: res.locals.error
  });
});

module.exports = app;
