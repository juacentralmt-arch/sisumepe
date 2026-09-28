class BaseHandler {
  constructor(store, helpers) {
    this.store = store;
    this.helpers = helpers;
  }

  match(query, ctx) {
    throw new Error('match() must be implemented');
  }

  async handle(query, ctx) {
    throw new Error('handle() must be implemented');
  }

  getSuggestions() {
    return [];
  }
}

module.exports = BaseHandler;