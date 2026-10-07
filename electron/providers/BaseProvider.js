class BaseProvider {
  id = '';
  name = '';
  icon = '';
  authType = '';
  status = 'unauthorized';
  loginUrl = '';
  consoleUrl = '';

  async checkAuth(scraper) {
    throw new Error('checkAuth not implemented');
  }

  async login(scraper) {
    throw new Error('login not implemented');
  }

  async fetchData(scraper) {
    throw new Error('fetchData not implemented');
  }
}

module.exports = BaseProvider;
