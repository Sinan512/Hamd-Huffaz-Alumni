# Fixes

## routes/admin.js
- Added helper `defaultPasswordFor(admissionNumber)` -> `<admissionNumber>@123`.
- `POST /admin/members` (single add) now saves `password: defaultPasswordFor(admissionNumber)`.
- `POST /admin/members/import` (CSV import) saves the same password per row.
- Stored in the existing MemberDetails model (collection `MEMBER_DETAILS`) with the rest of the member details.

## Login was broken: no session middleware existed
`routes/users.js` uses `req.session` everywhere, but `express-session` was never
installed or mounted, so `req.session.memberId` was never persisted and the
dashboard always fell back to the login view.

### app.js
- Requires `express-session` + `connect-mongo`.
- Mounts session middleware before the routers (Mongo-backed store, httpOnly
  cookie, 7-day TTL, secret from `SESSION_SECRET`).

### package.json
- Added `express-session` and `connect-mongo`.

### .env.example
- Added `SESSION_SECRET`.

### routes/users.js
- Post-login and logout redirects changed from `/` to `/users` (the router is
  mounted at `/users`, so `/` hit the 404 handler instead of the dashboard).
- Guarded `req.session.destroy` when no session exists.

## After copying these files
Run `npm install` then `npm start`.
Existing members created before this change still have no password and log in
with their bare admission number; new members use `<admissionNumber>@123`.
