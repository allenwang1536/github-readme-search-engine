const { URL } = require('url');

const ALLOWED_PREFIXES = [
  '/blog', '/engineering', '/developers', '/posts', '/articles',
  '/insights', '/news', '/releases', '/changelog', '/techblog', '/tech',
];

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    let host = u.hostname.toLowerCase();
    if (u.port === '80' || u.port === '443') {
      u.port = '';
    }

    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    u.hash = '';
    const params = new URLSearchParams(u.search);
    params.sort();
    const qs = params.toString();

    const port = u.port ? ':' + u.port : '';
    return u.protocol + '//' + host + port + path + (qs ? '?' + qs : '');
  } catch (_) {
    return null;
  }
}

function companyTag(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const parts = host.split('.');
    const skip = new Set([
      'www', 'blog', 'blogs', 'engineering', 'eng',
      'tech', 'developer', 'developers', 'dev',
    ]);
    const tlds = new Set(['com', 'org', 'net', 'io', 'co', 'dev', 'ai', 'us', 'uk']);

    const meaningful = parts.filter((p) => !skip.has(p) && !tlds.has(p));
    return meaningful[0] || parts[0];
  } catch (_) {
    return 'unknown';
  }
}

function hasAllowedPath(rawUrl) {
  try {
    const path = new URL(rawUrl).pathname.toLowerCase();
    if (path === '/' || path === '') return true;
    for (const prefix of ALLOWED_PREFIXES) {
      if (path.startsWith(prefix)) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function createPolicy(allowedDomains) {
  const domains = allowedDomains instanceof Set ?
    allowedDomains : new Set(allowedDomains.map((d) => d.toLowerCase()));

  function isDomainAllowed(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (domains.has(host)) return true;
      const parts = host.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const parent = parts.slice(i).join('.');
        if (domains.has(parent)) return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function isAllowed(rawUrl) {
    const norm = normalizeUrl(rawUrl);
    if (!norm) return false;
    if (!isDomainAllowed(norm)) return false;
    if (!hasAllowedPath(norm)) return false;
    return true;
  }

  return {
    isAllowed,
    isDomainAllowed,
    hasAllowedPath,
    domains,
  };
}

module.exports = {
  normalizeUrl,
  companyTag,
  hasAllowedPath,
  createPolicy,
  ALLOWED_PREFIXES,
};
