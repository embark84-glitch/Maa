'use strict';
/** Every API route, registered on anything with Express-style get/post/put/patch/delete. */
module.exports = function registerRoutes(app, ctx) {
  require('./auth')(app, ctx);
  require('./catalog')(app, ctx);
  require('./supplier')(app, ctx);
  require('./orders')(app, ctx);
  require('./deliveries')(app, ctx);
  require('./admin')(app, ctx);
};
