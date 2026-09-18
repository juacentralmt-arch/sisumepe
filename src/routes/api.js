const routes = [
  require('./auth'),
  require('./chat'),
  require('./persons'),
  require('./tickets'),
  require('./admin'),
  require('./google'),
  require('./agenda'),
  require('./termos'),
  require('./scanner'),
];

module.exports = function registerRoutes(app) {
  routes.forEach(mod => app.use(mod));
};
