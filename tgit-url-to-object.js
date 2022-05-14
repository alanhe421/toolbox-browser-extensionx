const isUrl = require('is-url');
const laxUrlRegex = /(?:(?:[^:]+:)?[/][/])?(?:.+@)?([^/]+)([/][^?#]+)/;

function main(repoUrl, opts) {
  const obj = {};
  opts = opts || {}

  if (!repoUrl) return null

  // Allow an object with nested `url` string
  // (common practice in package.json files)
  if (repoUrl.url) repoUrl = repoUrl.url

  if (typeof repoUrl !== 'string') return null

  const shorthand = repoUrl.match(/^([\w-_]+)\/([\w-_\.]+)(?:#([\w-_\.]+))?$/);
  const antiquated = repoUrl.match(/^git@[\w-_\.]+:([\w-_]+)\/([\w-_\.]+)$/);

  if (shorthand) {
    obj.user = shorthand[1]
    obj.repo = shorthand[2]
    obj.branch = shorthand[3] || 'master'
    obj.host = 'git.woa.com'
  } else if (antiquated) {
    obj.user = antiquated[1]
    obj.repo = antiquated[2].replace(/\.git$/i, '')
    obj.branch = 'master'
    obj.host = 'git.woa.com'
  } else {
    // Turn git+http URLs into http URLs
    repoUrl = repoUrl.replace(/^git\+/, '')

    if (!isUrl(repoUrl)) return null

    const [, hostname, pathname] = repoUrl.match(laxUrlRegex) || []
    if (!hostname) return null
    if (hostname !== 'git.woa.com' && !opts.enterprise) return null

    const parts = pathname.match(/^\/([\w-_]+)\/([\w-_\.]+)(\/tree\/[%\w-_\.\/]+)?(\/blob\/[%\w-_\.\/]+)?/);
    // ([\w-_\.]+)
    if (!parts) return null
    obj.user = parts[1]
    obj.repo = parts[2].replace(/\.git$/i, '')

    obj.host = hostname || 'git.woa.com'

    if (parts[3] && /^\/tree\/master\//.test(parts[3])) {
      obj.branch = 'master'
      obj.path = parts[3].replace(/\/$/, '')
    } else if (parts[3]) {
      const branchMatch = parts[3].replace(/^\/tree\//, '').match(/[%\w-_.]*\/?[%\w-_]+/)
      obj.branch = branchMatch && branchMatch[0]
    } else if (parts[4]) {
      const branchMatch = parts[4].replace(/^\/blob\//, '').match(/[%\w-_.]*\/?[%\w-_]+/)
      obj.branch = branchMatch && branchMatch[0]
    } else {
      obj.branch = 'master'
    }
  }
  obj.apiHost = obj.host

  obj.clone_url = `https://${obj.host}/${obj.user}/${obj.repo}`

  if (obj.branch === 'master') {
    obj.https_url = `https://${obj.host}/${obj.user}/${obj.repo}`
    obj.zip_url = `https://${obj.host}/${obj.user}/${obj.repo}/-/repository/archive.zip`
  } else {
    obj.https_url = `https://${obj.host}/${obj.user}/${obj.repo}/blob/${obj.branch}`
    obj.zip_url = `https://${obj.host}/${obj.user}/${obj.repo}/-/repository/archive.zip?ref=${obj.branch}`
  }

  // Support deep paths (like lerna-style repos)
  if (obj.path) {
    obj.https_url += obj.path
  }

  obj.api_url = `https://${obj.apiHost}/${obj.user}/${obj.repo}/-`

  return obj
}

export default main;
