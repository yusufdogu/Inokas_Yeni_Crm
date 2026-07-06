(function() {
  const _originalFetch = window.fetch.bind(window);
  window.fetch = function(url, options) {
    const token = sessionStorage.getItem('login_auth_token');
    if (token && typeof url === 'string' && url.startsWith('/api/')) {
      options = options || {};
      options.headers = Object.assign({}, options.headers, {
        'x-auth-token': token,
      });
    }
    return _originalFetch(url, options);
  };
})();