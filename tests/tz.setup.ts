// Pins every test run to India Standard Time (+05:30), which the date and
// month assertions are written against.
//
// This must run before any test module imports a formatter. `Intl.DateTimeFormat`
// caches the zone when it is constructed, while `Date` re-reads `process.env.TZ`
// on each call. Setting the variable after an import leaves the two disagreeing
// (a formatter built in UTC then formatting an IST `Date`), which is what made
// the month-label assertion fail on the UTC CI runner.
process.env.TZ = "Asia/Kolkata";
