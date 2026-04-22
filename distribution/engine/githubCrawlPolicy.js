const { URL } = require('url');

const GITHUB_CRAWL_POLICY = {
    allowedDomain: 'github.com',
    allowedPathPatterns: [
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/,           // /owner/repo
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/wiki/,          // /owner/repo/wiki
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/releases/,      // /owner/repo/releases
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/blob\/[^/]+\/README/, // README files
    ],
    blockedPathPatterns: [
        /^\/login/, /^\/signup/, /^\/settings/,
        /^\/marketplace/, /^\/sponsors/, /^\/apps/,
        /^\/orgs/, /^\/explore/, /^\/notifications/,
        /^\/pulls/, /^\/issues/, /^\/-\//,
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/commit/,
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull/,
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/issues/,
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/actions/,
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/projects/,
    ],
};

function isAllowedUrl(rawUrl, policy) {
    policy = policy || GITHUB_CRAWL_POLICY;
    try {
        const u = new URL(rawUrl);
        const host = u.hostname.toLowerCase();
        if (host !== policy.allowedDomain) return false;

        const path = u.pathname;

        for (const blocked of policy.blockedPathPatterns) {
            if (blocked.test(path)) return false;
        }

        for (const allowed of policy.allowedPathPatterns) {
            if (allowed.test(path)) return true;
        }

        return false;
    } catch (_) {
        return false;
    }
}

module.exports = {
    GITHUB_CRAWL_POLICY,
    isAllowedUrl,
};
