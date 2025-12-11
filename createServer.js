'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var cors = _interopDefault(require('cors'));
var express = _interopDefault(require('express'));
var morgan = _interopDefault(require('morgan'));
var compression = _interopDefault(require('compression'));
var path = _interopDefault(require('path'));
var tar = _interopDefault(require('tar-stream'));
var mime = _interopDefault(require('mime'));
var SRIToolbox = _interopDefault(require('sri-toolbox'));
var url = _interopDefault(require('url'));
var https = _interopDefault(require('https'));
var gunzip = _interopDefault(require('gunzip-maybe'));
var LRUCache = _interopDefault(require('lru-cache'));
var fs = _interopDefault(require('fs'));
var server = require('react-dom/server');
var semver = _interopDefault(require('semver'));
var core = require('@emotion/core');
var React = require('react');
var PropTypes = _interopDefault(require('prop-types'));
var VisuallyHidden = _interopDefault(require('@reach/visually-hidden'));
var sortBy = _interopDefault(require('sort-by'));
var formatBytes = _interopDefault(require('pretty-bytes'));
var jsesc = _interopDefault(require('jsesc'));
var hljs = _interopDefault(require('highlight.js'));
var etag = _interopDefault(require('etag'));
var cheerio = _interopDefault(require('cheerio'));
var babel = _interopDefault(require('@babel/core'));
var URL = _interopDefault(require('whatwg-url'));
var warning = _interopDefault(require('warning'));
var util = _interopDefault(require('util'));
var validateNpmPackageName = _interopDefault(require('validate-npm-package-name'));

function getBaseUrl() {
  const baseUrl = process.env.UNPKG_BASE_URL || '/unpkg';
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Useful for wrapping `async` request handlers in Express
 * so they automatically propagate errors.
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(error => {
      req.log.error(`Unexpected error in ${handler.name}!`);
      req.log.error(error.stack);
      next(error);
    });
  };
}

function bufferStream(stream) {
  return new Promise((accept, reject) => {
    const chunks = [];
    stream.on('error', reject).on('data', chunk => chunks.push(chunk)).on('end', () => accept(Buffer.concat(chunks)));
  });
}

mime.define({
  'text/plain': ['authors', 'changes', 'license', 'makefile', 'patents', 'readme', 'ts', 'flow']
},
/* force */
true);
const textFiles = /\/?(\.[a-z]*rc|\.git[a-z]*|\.[a-z]*ignore|\.lock)$/i;
function getContentType(file) {
  const name = path.basename(file);
  return textFiles.test(name) ? 'text/plain' : mime.getType(name) || 'text/plain';
}

function getIntegrity(data) {
  return SRIToolbox.generate({
    algorithms: ['sha384']
  }, data);
}

const npmRegistryURL = process.env.NPM_CONFIG_REGISTRY || process.env.NPM_REGISTRY_URL || 'https://registry.npmjs.org';
const npmCacheEnabled = process.env.NPM_CACHE_ENABLED !== 'false';
const npmCacheFolder = process.env.NPM_CACHE_FOLDER || path.join(__dirname, 'caches');

if (npmCacheEnabled) {
  fs.mkdir(npmCacheFolder, {
    recursive: true
  }, err => {
    if (err) {
      return console.error(err);
    }
  });
}

const npmCacheAutoUpgrade = process.env.NPM_CACHE_AUTO_UPGRADE !== 'false';
const npmCachePackageInfo = process.env.NPM_CACHE_PACKAGE_INFO !== 'false';
const npmCachePackageContent = process.env.NPM_CACHE_PACKAGE_CONTENT !== 'false';
const agent = new https.Agent({
  keepAlive: true
});
const oneMegabyte = 1024 * 1024;
const oneSecond = 1000;
const oneMinute = oneSecond * 60;
const cache = new LRUCache({
  max: oneMegabyte * 40,
  length: Buffer.byteLength,
  maxAge: oneSecond
});
const notFound = '';

function get(options) {
  return new Promise((accept, reject) => {
    https.get(options, accept).on('error', reject);
  });
}

function isScopedPackageName(packageName) {
  return packageName.startsWith('@');
}

function encodePackageName(packageName) {
  return isScopedPackageName(packageName) ? `@${encodeURIComponent(packageName.substring(1))}` : encodeURIComponent(packageName);
}

async function fetchPackageInfo(packageName, log) {
  const name = encodePackageName(packageName);
  const infoURL = `${npmRegistryURL}/${name}`;
  packageName.split('/').join('_');

  if (npmCacheEnabled && npmCacheFolder && npmCachePackageInfo) {
    const infoFile = path.join(npmCacheFolder, packageName.split('/').join('_') + `.json`);

    if (fs.existsSync(infoFile)) {
      log.debug('Fetching package info for %s from %s', packageName, infoFile);
      const fileStream = fs.createReadStream(infoFile);
      return bufferStream(fileStream).then(JSON.parse);
    }
  }

  log.debug('Fetching package info for %s from %s', packageName, infoURL);
  const {
    hostname,
    pathname
  } = url.parse(infoURL);
  const options = {
    agent: agent,
    hostname: hostname,
    path: pathname,
    headers: {
      Accept: 'application/json'
    }
  };
  const res = await get(options);

  if (res.statusCode === 200) {
    if (npmCacheEnabled && npmCacheFolder && npmCachePackageInfo) {
      const infoFile = path.join(npmCacheFolder, packageName.split('/').join('_') + `.json`);
      log.debug('Caching package info for %s to %s', packageName, infoFile);
      const fileStream = fs.createWriteStream(infoFile);
      res.pipe(fileStream);
    }

    return bufferStream(res).then(JSON.parse);
  }

  if (res.statusCode === 404) {
    return null;
  }

  const content = (await bufferStream(res)).toString('utf-8');
  log.error('Error fetching info for %s (status: %s)', packageName, res.statusCode);
  log.error(content);
  return null;
}

async function fetchVersionsAndTags(packageName, log) {
  const info = await fetchPackageInfo(packageName, log);
  return info && info.versions ? {
    versions: Object.keys(info.versions),
    tags: info['dist-tags']
  } : null;
}
/**
 * Returns an object of available { versions, tags }.
 * Uses a cache to avoid over-fetching from the registry.
 */


async function getVersionsAndTags(packageName, log) {
  const cacheKey = `versions-${packageName}`;
  const cacheValue = cache.get(cacheKey);

  if (cacheValue != null) {
    return cacheValue === notFound ? null : JSON.parse(cacheValue);
  }

  const value = await fetchVersionsAndTags(packageName, log);

  if (value == null) {
    cache.set(cacheKey, notFound, 5 * oneMinute);
    return null;
  }

  cache.set(cacheKey, JSON.stringify(value), oneMinute);
  return value;
} // All the keys that sometimes appear in package info
// docs that we don't need. There are probably more.

const packageConfigExcludeKeys = ['browserify', 'bugs', 'directories', 'engines', 'files', 'homepage', 'keywords', 'maintainers', 'scripts'];

function cleanPackageConfig(config) {
  return Object.keys(config).reduce((memo, key) => {
    if (!key.startsWith('_') && !packageConfigExcludeKeys.includes(key)) {
      memo[key] = config[key];
    }

    return memo;
  }, {});
}

async function fetchPackageConfig(packageName, version, log) {
  const info = await fetchPackageInfo(packageName, log);
  return info && info.versions && version in info.versions ? cleanPackageConfig(info.versions[version]) : null;
}
/**
 * Returns metadata about a package, mostly the same as package.json.
 * Uses a cache to avoid over-fetching from the registry.
 */


async function getPackageConfig(packageName, version, log) {
  const cacheKey = `config-${packageName}-${version}`;
  const cacheValue = cache.get(cacheKey);

  if (cacheValue != null) {
    return cacheValue === notFound ? null : JSON.parse(cacheValue);
  }

  const value = await fetchPackageConfig(packageName, version, log);

  if (value == null) {
    cache.set(cacheKey, notFound, 5 * oneMinute);
    return null;
  }

  cache.set(cacheKey, JSON.stringify(value), oneMinute);
  return value;
}
/**
 * Returns a stream of the tarball'd contents of the given package.
 */

async function getPackage(packageName, version, log) {
  const tarballName = isScopedPackageName(packageName) ? packageName.split('/')[1] : packageName;

  if (npmCacheEnabled && npmCacheFolder && npmCachePackageContent) {
    const tarballFile = path.join(npmCacheFolder, packageName.split('/').join('_') + `-${version}.tgz`);

    if (fs.existsSync(tarballFile)) {
      log.debug('Fetching package for %s from %s', packageName, tarballFile);
      const fileStream = fs.createReadStream(tarballFile);
      const stream = fileStream.pipe(gunzip());
      return stream;
    }
  }

  const tarballURL = `${npmRegistryURL}/${packageName}/-/${tarballName}-${version}.tgz`;
  log.debug('Fetching package for %s from %s', packageName, tarballURL);
  const {
    hostname,
    pathname
  } = url.parse(tarballURL);
  const options = {
    agent: agent,
    hostname: hostname,
    path: pathname
  };
  let res = await get(options);

  if (res.statusCode == 302) {
    res = await get(res.headers.location);
  }

  if (res.statusCode === 200) {
    const stream = res.pipe(gunzip()); // stream.pause();

    if (npmCacheEnabled && npmCacheFolder && npmCachePackageContent) {
      const tarballFile = path.join(npmCacheFolder, packageName.split('/').join('_') + `-${version}.tgz`);
      log.debug('Caching package for %s to %s', packageName, tarballFile);
      const fileStream = fs.createWriteStream(tarballFile);
      stream.pipe(fileStream);
      return stream;
    }

    return stream;
  }

  if (res.statusCode === 404) {
    return null;
  }

  const content = (await bufferStream(res)).toString('utf-8');
  log.error('Error fetching tarball for %s@%s (status: %s)', packageName, version, res.statusCode);
  log.error(content);
  return null;
}
async function removePackageInfoCache(packageName, log) {
  if (npmCacheEnabled && npmCacheFolder && npmCacheAutoUpgrade) {
    const infoFile = path.join(npmCacheFolder, packageName.split('/').join('_') + `.json`);

    if (fs.existsSync(infoFile)) {
      log.debug('Removing package info cache for %s', packageName);
      const cacheKey = `versions-${packageName}`;
      cache.del(cacheKey);
      fs.unlinkSync(infoFile);
    }
  }
}

function _extends() {
  _extends = Object.assign || function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];

      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }

    return target;
  };

  return _extends.apply(this, arguments);
}

function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;

  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }

  return target;
}

function _taggedTemplateLiteralLoose(strings, raw) {
  if (!raw) {
    raw = strings.slice(0);
  }

  strings.raw = raw;
  return strings;
}

var fontSans = "\nfont-family: -apple-system,\n  BlinkMacSystemFont,\n  \"Segoe UI\",\n  \"Roboto\",\n  \"Oxygen\",\n  \"Ubuntu\",\n  \"Cantarell\",\n  \"Fira Sans\",\n  \"Droid Sans\",\n  \"Helvetica Neue\",\n  sans-serif;\n";
var fontMono = "\nfont-family: Menlo,\n  Monaco,\n  Lucida Console,\n  Liberation Mono,\n  DejaVu Sans Mono,\n  Bitstream Vera Sans Mono,\n  Courier New,\n  monospace;\n";

function formatNumber(n) {
  var digits = String(n).split('');
  var groups = [];

  while (digits.length) {
    groups.unshift(digits.splice(-3).join(''));
  }

  return groups.join(',');
}
function formatPercent(n, decimals) {
  if (decimals === void 0) {
    decimals = 1;
  }

  return (n * 100).toPrecision(decimals + 2);
}

var maxWidth = 700;
function ContentArea(_ref) {
  var _extends2;

  var children = _ref.children,
      css = _ref.css;
  return core.jsx("div", {
    css: _extends((_extends2 = {
      border: '1px solid #dfe2e5',
      borderRadius: 3
    }, _extends2["@media (max-width: " + maxWidth + "px)"] = {
      borderRightWidth: 0,
      borderLeftWidth: 0
    }, _extends2), css)
  }, children);
}
function ContentAreaHeaderBar(_ref2) {
  var _extends3;

  var children = _ref2.children,
      css = _ref2.css;
  return core.jsx("div", {
    css: _extends((_extends3 = {
      padding: 10,
      background: '#f6f8fa',
      color: '#424242',
      border: '1px solid #d1d5da',
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      margin: '-1px -1px 0',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    }, _extends3["@media (max-width: " + maxWidth + "px)"] = {
      paddingRight: 20,
      paddingLeft: 20
    }, _extends3), css)
  }, children);
}

var DefaultContext = {
  color: undefined,
  size: undefined,
  className: undefined,
  style: undefined,
  attr: undefined
};
var IconContext = React.createContext && React.createContext(DefaultContext);

var __assign = global && global.__assign || function () {
  __assign = Object.assign || function (t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];

      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }

    return t;
  };

  return __assign.apply(this, arguments);
};

var __rest = global && global.__rest || function (s, e) {
  var t = {};

  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];

  if (s != null && typeof Object.getOwnPropertySymbols === "function") for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0) t[p[i]] = s[p[i]];
  return t;
};

function Tree2Element(tree) {
  return tree && tree.map(function (node, i) {
    return React.createElement(node.tag, __assign({
      key: i
    }, node.attr), Tree2Element(node.child));
  });
}

function GenIcon(data) {
  return function (props) {
    return React.createElement(IconBase, __assign({
      attr: __assign({}, data.attr)
    }, props), Tree2Element(data.child));
  };
}
function IconBase(props) {
  var elem = function (conf) {
    var computedSize = props.size || conf.size || "1em";
    var className;
    if (conf.className) className = conf.className;
    if (props.className) className = (className ? className + ' ' : '') + props.className;

    var attr = props.attr,
        title = props.title,
        svgProps = __rest(props, ["attr", "title"]);

    return React.createElement("svg", __assign({
      stroke: "currentColor",
      fill: "currentColor",
      strokeWidth: "0"
    }, conf.attr, attr, svgProps, {
      className: className,
      style: __assign({
        color: props.color || conf.color
      }, conf.style, props.style),
      height: computedSize,
      width: computedSize,
      xmlns: "http://www.w3.org/2000/svg"
    }), title && React.createElement("title", null, title), props.children);
  };

  return IconContext !== undefined ? React.createElement(IconContext.Consumer, null, function (conf) {
    return elem(conf);
  }) : elem(DefaultContext);
}

// THIS FILE IS AUTO GENERATED
var GoFileCode = function (props) {
  return GenIcon({"tag":"svg","attr":{"viewBox":"0 0 12 16"},"child":[{"tag":"path","attr":{"fillRule":"evenodd","d":"M8.5 1H1c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h10c.55 0 1-.45 1-1V4.5L8.5 1zM11 14H1V2h7l3 3v9zM5 6.98L3.5 8.5 5 10l-.5 1L2 8.5 4.5 6l.5.98zM7.5 6L10 8.5 7.5 11l-.5-.98L8.5 8.5 7 7l.5-1z"}}]})(props);
};
GoFileCode.displayName = "GoFileCode";
var GoFileDirectory = function (props) {
  return GenIcon({"tag":"svg","attr":{"viewBox":"0 0 14 16"},"child":[{"tag":"path","attr":{"fillRule":"evenodd","d":"M13 4H7V3c0-.66-.31-1-1-1H1c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zM6 4H1V3h5v1z"}}]})(props);
};
GoFileDirectory.displayName = "GoFileDirectory";
var GoFile = function (props) {
  return GenIcon({"tag":"svg","attr":{"viewBox":"0 0 12 16"},"child":[{"tag":"path","attr":{"fillRule":"evenodd","d":"M6 5H2V4h4v1zM2 8h7V7H2v1zm0 2h7V9H2v1zm0 2h7v-1H2v1zm10-7.5V14c0 .55-.45 1-1 1H1c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1h7.5L12 4.5zM11 5L8 2H1v12h10V5z"}}]})(props);
};
GoFile.displayName = "GoFile";

// THIS FILE IS AUTO GENERATED
var FaGithub = function (props) {
  return GenIcon({"tag":"svg","attr":{"viewBox":"0 0 496 512"},"child":[{"tag":"path","attr":{"d":"M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"}}]})(props);
};
FaGithub.displayName = "FaGithub";
var FaTwitter = function (props) {
  return GenIcon({"tag":"svg","attr":{"viewBox":"0 0 512 512"},"child":[{"tag":"path","attr":{"d":"M459.37 151.716c.325 4.548.325 9.097.325 13.645 0 138.72-105.583 298.558-298.558 298.558-59.452 0-114.68-17.219-161.137-47.106 8.447.974 16.568 1.299 25.34 1.299 49.055 0 94.213-16.568 130.274-44.832-46.132-.975-84.792-31.188-98.112-72.772 6.498.974 12.995 1.624 19.818 1.624 9.421 0 18.843-1.3 27.614-3.573-48.081-9.747-84.143-51.98-84.143-102.985v-1.299c13.969 7.797 30.214 12.67 47.431 13.319-28.264-18.843-46.781-51.005-46.781-87.391 0-19.492 5.197-37.36 14.294-52.954 51.655 63.675 129.3 105.258 216.365 109.807-1.624-7.797-2.599-15.918-2.599-24.04 0-57.828 46.782-104.934 104.934-104.934 30.213 0 57.502 12.67 76.67 33.137 23.715-4.548 46.456-13.32 66.599-25.34-7.798 24.366-24.366 44.833-46.132 57.827 21.117-2.273 41.584-8.122 60.426-16.243-14.292 20.791-32.161 39.308-52.628 54.253z"}}]})(props);
};
FaTwitter.displayName = "FaTwitter";

function createIcon(Type, _ref) {
  var css = _ref.css,
      rest = _objectWithoutPropertiesLoose(_ref, ["css"]);

  return core.jsx(Type, _extends({
    css: _extends({}, css, {
      verticalAlign: 'text-bottom'
    })
  }, rest));
}

function FileIcon(props) {
  return createIcon(GoFile, props);
}
function FileCodeIcon(props) {
  return createIcon(GoFileCode, props);
}
function FolderIcon(props) {
  return createIcon(GoFileDirectory, props);
}
function TwitterIcon(props) {
  return createIcon(FaTwitter, props);
}
function GitHubIcon(props) {
  return createIcon(FaGithub, props);
}

var linkStyle = {
  color: '#0076ff',
  textDecoration: 'none',
  ':hover': {
    textDecoration: 'underline'
  }
};
var tableCellStyle = {
  paddingTop: 6,
  paddingRight: 3,
  paddingBottom: 6,
  paddingLeft: 3,
  borderTop: '1px solid #eaecef'
};

var iconCellStyle = _extends({}, tableCellStyle, {
  color: '#424242',
  width: 17,
  paddingRight: 2,
  paddingLeft: 10,
  '@media (max-width: 700px)': {
    paddingLeft: 20
  }
});

var typeCellStyle = _extends({}, tableCellStyle, {
  textAlign: 'right',
  paddingRight: 10,
  '@media (max-width: 700px)': {
    paddingRight: 20
  }
});

function getRelName(path, base) {
  return path.substr(base.length > 1 ? base.length + 1 : 1);
}

function FolderViewer(_ref) {
  var path = _ref.path,
      entries = _ref.details;

  var _Object$keys$reduce = Object.keys(entries).reduce(function (memo, key) {
    var subdirs = memo.subdirs,
        files = memo.files;
    var entry = entries[key];

    if (entry.type === 'directory') {
      subdirs.push(entry);
    } else if (entry.type === 'file') {
      files.push(entry);
    }

    return memo;
  }, {
    subdirs: [],
    files: []
  }),
      subdirs = _Object$keys$reduce.subdirs,
      files = _Object$keys$reduce.files;

  subdirs.sort(sortBy('path'));
  files.sort(sortBy('path'));
  var rows = [];

  if (path !== '/') {
    rows.push(core.jsx("tr", {
      key: ".."
    }, core.jsx("td", {
      css: iconCellStyle
    }), core.jsx("td", {
      css: tableCellStyle
    }, core.jsx("a", {
      title: "Parent directory",
      href: "../",
      css: linkStyle
    }, "..")), core.jsx("td", {
      css: tableCellStyle
    }), core.jsx("td", {
      css: typeCellStyle
    })));
  }

  subdirs.forEach(function (_ref2) {
    var dirname = _ref2.path;
    var relName = getRelName(dirname, path);
    var href = relName + '/';
    rows.push(core.jsx("tr", {
      key: relName
    }, core.jsx("td", {
      css: iconCellStyle
    }, core.jsx(FolderIcon, null)), core.jsx("td", {
      css: tableCellStyle
    }, core.jsx("a", {
      title: relName,
      href: href,
      css: linkStyle
    }, relName)), core.jsx("td", {
      css: tableCellStyle
    }, "-"), core.jsx("td", {
      css: typeCellStyle
    }, "-")));
  });
  files.forEach(function (_ref3) {
    var filename = _ref3.path,
        size = _ref3.size,
        contentType = _ref3.contentType;
    var relName = getRelName(filename, path);
    var href = relName;
    rows.push(core.jsx("tr", {
      key: relName
    }, core.jsx("td", {
      css: iconCellStyle
    }, contentType === 'text/plain' || contentType === 'text/markdown' ? core.jsx(FileIcon, null) : core.jsx(FileCodeIcon, null)), core.jsx("td", {
      css: tableCellStyle
    }, core.jsx("a", {
      title: relName,
      href: href,
      css: linkStyle
    }, relName)), core.jsx("td", {
      css: tableCellStyle
    }, formatBytes(size)), core.jsx("td", {
      css: typeCellStyle
    }, contentType)));
  });
  var counts = [];

  if (files.length > 0) {
    counts.push(files.length + " file" + (files.length === 1 ? '' : 's'));
  }

  if (subdirs.length > 0) {
    counts.push(subdirs.length + " folder" + (subdirs.length === 1 ? '' : 's'));
  }

  return core.jsx(ContentArea, null, core.jsx(ContentAreaHeaderBar, null, core.jsx("span", null, counts.join(', '))), core.jsx("table", {
    css: {
      width: '100%',
      borderCollapse: 'collapse',
      borderRadius: 2,
      background: '#fff',
      '@media (max-width: 700px)': {
        '& th + th + th + th, & td + td + td + td': {
          display: 'none'
        }
      },
      '& tr:first-of-type td': {
        borderTop: 0
      }
    }
  }, core.jsx("thead", null, core.jsx("tr", null, core.jsx("th", null, core.jsx(VisuallyHidden, null, "Icon")), core.jsx("th", null, core.jsx(VisuallyHidden, null, "Name")), core.jsx("th", null, core.jsx(VisuallyHidden, null, "Size")), core.jsx("th", null, core.jsx(VisuallyHidden, null, "Content Type")))), core.jsx("tbody", null, rows)));
}

if (process.env.NODE_ENV !== 'production') {
  FolderViewer.propTypes = {
    path: PropTypes.string.isRequired,
    details: PropTypes.objectOf(PropTypes.shape({
      path: PropTypes.string.isRequired,
      type: PropTypes.oneOf(['directory', 'file']).isRequired,
      contentType: PropTypes.string,
      // file only
      integrity: PropTypes.string,
      // file only
      size: PropTypes.number // file only

    })).isRequired
  };
}

function createHTML(content) {
  return {
    __html: content
  };
}

/** @jsx jsx */

function getBasename(path) {
  var segments = path.split('/');
  return segments[segments.length - 1];
}

function ImageViewer(_ref) {
  var path = _ref.path,
      uri = _ref.uri;
  return core.jsx("div", {
    css: {
      padding: 20,
      textAlign: 'center'
    }
  }, core.jsx("img", {
    alt: getBasename(path),
    src: uri
  }));
}

function CodeListing(_ref2) {
  var highlights = _ref2.highlights;
  var lines = highlights.slice(0);
  var hasTrailingNewline = lines.length && lines[lines.length - 1] === '';

  if (hasTrailingNewline) {
    lines.pop();
  }

  return core.jsx("div", {
    className: "code-listing",
    css: {
      overflowX: 'auto',
      overflowY: 'hidden',
      paddingTop: 5,
      paddingBottom: 5
    }
  }, core.jsx("table", {
    css: {
      border: 'none',
      borderCollapse: 'collapse',
      borderSpacing: 0
    }
  }, core.jsx("tbody", null, lines.map(function (line, index) {
    var lineNumber = index + 1;
    return core.jsx("tr", {
      key: index
    }, core.jsx("td", {
      id: "L" + lineNumber,
      css: {
        paddingLeft: 10,
        paddingRight: 10,
        color: 'rgba(27,31,35,.3)',
        textAlign: 'right',
        verticalAlign: 'top',
        width: '1%',
        minWidth: 50,
        userSelect: 'none'
      }
    }, core.jsx("span", null, lineNumber)), core.jsx("td", {
      id: "LC" + lineNumber,
      css: {
        paddingLeft: 10,
        paddingRight: 10,
        color: '#24292e',
        whiteSpace: 'pre'
      }
    }, core.jsx("code", {
      dangerouslySetInnerHTML: createHTML(line)
    })));
  }), !hasTrailingNewline && core.jsx("tr", {
    key: "no-newline"
  }, core.jsx("td", {
    css: {
      paddingLeft: 10,
      paddingRight: 10,
      color: 'rgba(27,31,35,.3)',
      textAlign: 'right',
      verticalAlign: 'top',
      width: '1%',
      minWidth: 50,
      userSelect: 'none'
    }
  }, "\\"), core.jsx("td", {
    css: {
      paddingLeft: 10,
      color: 'rgba(27,31,35,.3)',
      userSelect: 'none'
    }
  }, "No newline at end of file")))));
}

function BinaryViewer() {
  return core.jsx("div", {
    css: {
      padding: 20
    }
  }, core.jsx("p", {
    css: {
      textAlign: 'center'
    }
  }, "No preview available."));
}

function FileViewer(_ref3) {
  var baseUrl = _ref3.baseUrl,
      packageName = _ref3.packageName,
      packageVersion = _ref3.packageVersion,
      path = _ref3.path,
      details = _ref3.details;
  var highlights = details.highlights,
      uri = details.uri,
      language = details.language,
      size = details.size;
  return core.jsx(ContentArea, null, core.jsx(ContentAreaHeaderBar, null, core.jsx("span", null, formatBytes(size)), core.jsx("span", null, language), core.jsx("span", null, core.jsx("a", {
    href: baseUrl + "/" + packageName + "@" + packageVersion + path,
    css: {
      display: 'inline-block',
      marginLeft: 8,
      padding: '2px 8px',
      textDecoration: 'none',
      fontWeight: 600,
      fontSize: '0.9rem',
      color: '#24292e',
      backgroundColor: '#eff3f6',
      border: '1px solid rgba(27,31,35,.2)',
      borderRadius: 3,
      ':hover': {
        backgroundColor: '#e6ebf1',
        borderColor: 'rgba(27,31,35,.35)'
      },
      ':active': {
        backgroundColor: '#e9ecef',
        borderColor: 'rgba(27,31,35,.35)',
        boxShadow: 'inset 0 0.15em 0.3em rgba(27,31,35,.15)'
      }
    }
  }, "View Raw"))), highlights ? core.jsx(CodeListing, {
    highlights: highlights
  }) : uri ? core.jsx(ImageViewer, {
    path: path,
    uri: uri
  }) : core.jsx(BinaryViewer, null));
}

if (process.env.NODE_ENV !== 'production') {
  FileViewer.propTypes = {
    path: PropTypes.string.isRequired,
    details: PropTypes.shape({
      contentType: PropTypes.string.isRequired,
      highlights: PropTypes.arrayOf(PropTypes.string),
      // code
      uri: PropTypes.string,
      // images
      integrity: PropTypes.string.isRequired,
      language: PropTypes.string.isRequired,
      size: PropTypes.number.isRequired
    }).isRequired
  };
}

var SelectDownArrow = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAYAAAC9vt6cAAAAAXNSR0IArs4c6QAAARFJREFUKBVjZAACNS39RhBNKrh17WI9o4quoT3Dn78HSNUMUs/CzOTI/O7Vi4dCYpJ3/jP+92BkYGAlyiBGhm8MjIxJt65e3MQM0vDu9YvLYmISILYZELOBxHABRkaGr0yMzF23r12YDFIDNgDEePv65SEhEXENBkYGFSAXuyGMjF8Z/jOsvX3tYiFIDwgwQSgIaaijnvj/P8M5IO8HsjiY/f//D4b//88A1SQhywG9jQr09PS4v/1mPAeUUPzP8B8cJowMjL+Bqu6xMQmaXL164AuyDgwDQJLa2qYSP//9vARkCoMVMzK8YeVkNbh+9uxzMB+JwGoASF5Vx0jz/98/18BqmZi171w9D2EjaaYKEwAEK00XQLdJuwAAAABJRU5ErkJggg==";

function _templateObject2() {
  var data = _taggedTemplateLiteralLoose(["\n  .code-listing {\n    background: #fbfdff;\n    color: #383a42;\n  }\n  .code-comment,\n  .code-quote {\n    color: #a0a1a7;\n    font-style: italic;\n  }\n  .code-doctag,\n  .code-keyword,\n  .code-link,\n  .code-formula {\n    color: #a626a4;\n  }\n  .code-section,\n  .code-name,\n  .code-selector-tag,\n  .code-deletion,\n  .code-subst {\n    color: #e45649;\n  }\n  .code-literal {\n    color: #0184bb;\n  }\n  .code-string,\n  .code-regexp,\n  .code-addition,\n  .code-attribute,\n  .code-meta-string {\n    color: #50a14f;\n  }\n  .code-built_in,\n  .code-class .code-title {\n    color: #c18401;\n  }\n  .code-attr,\n  .code-variable,\n  .code-template-variable,\n  .code-type,\n  .code-selector-class,\n  .code-selector-attr,\n  .code-selector-pseudo,\n  .code-number {\n    color: #986801;\n  }\n  .code-symbol,\n  .code-bullet,\n  .code-meta,\n  .code-selector-id,\n  .code-title {\n    color: #4078f2;\n  }\n  .code-emphasis {\n    font-style: italic;\n  }\n  .code-strong {\n    font-weight: bold;\n  }\n"]);

  _templateObject2 = function _templateObject2() {
    return data;
  };

  return data;
}

function _templateObject() {
  var data = _taggedTemplateLiteralLoose(["\n  html {\n    box-sizing: border-box;\n  }\n  *,\n  *:before,\n  *:after {\n    box-sizing: inherit;\n  }\n\n  html,\n  body,\n  #root {\n    height: 100%;\n    margin: 0;\n  }\n\n  body {\n    ", "\n    font-size: 16px;\n    line-height: 1.5;\n    overflow-wrap: break-word;\n    background: white;\n    color: black;\n  }\n\n  code {\n    ", "\n  }\n\n  th,\n  td {\n    padding: 0;\n  }\n\n  select {\n    font-size: inherit;\n  }\n\n  #root {\n    display: flex;\n    flex-direction: column;\n  }\n"]);

  _templateObject = function _templateObject() {
    return data;
  };

  return data;
}
var buildId = "6ec4aa4";
var globalStyles = core.css(_templateObject(), fontSans, fontMono); // Adapted from https://github.com/highlightjs/highlight.js/blob/master/src/styles/atom-one-light.css

var lightCodeStyles = core.css(_templateObject2());

function Link(_ref) {
  var css = _ref.css,
      rest = _objectWithoutPropertiesLoose(_ref, ["css"]);

  return (// eslint-disable-next-line jsx-a11y/anchor-has-content
    core.jsx("a", _extends({}, rest, {
      css: _extends({
        color: '#0076ff',
        textDecoration: 'none',
        ':hover': {
          textDecoration: 'underline'
        }
      }, css)
    }))
  );
}

function AppHeader(_ref2) {
  var baseUrl = _ref2.baseUrl;
  return core.jsx("header", {
    css: {
      marginTop: '2rem'
    }
  }, core.jsx("h1", {
    css: {
      textAlign: 'center',
      fontSize: '3rem',
      letterSpacing: '0.05em'
    }
  }, core.jsx("a", {
    href: baseUrl + "/",
    css: {
      color: '#000',
      textDecoration: 'none'
    }
  }, "UNPKG")));
}

function AppNavigation(_ref3) {
  var baseUrl = _ref3.baseUrl,
      packageName = _ref3.packageName,
      packageVersion = _ref3.packageVersion,
      availableVersions = _ref3.availableVersions,
      filename = _ref3.filename;

  function handleVersionChange(nextVersion) {
    window.location.href = window.location.href.replace('@' + packageVersion, '@' + nextVersion);
  }

  var breadcrumbs = [];

  if (filename === '/') {
    breadcrumbs.push(packageName);
  } else {
    var url = baseUrl + "/browse/" + packageName + "@" + packageVersion;
    breadcrumbs.push(core.jsx(Link, {
      href: url + "/"
    }, packageName));
    var segments = filename.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
    var lastSegment = segments.pop();
    segments.forEach(function (segment) {
      url += "/" + segment;
      breadcrumbs.push(core.jsx(Link, {
        href: url + "/"
      }, segment));
    });
    breadcrumbs.push(lastSegment);
  }

  return core.jsx("header", {
    css: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      '@media (max-width: 700px)': {
        flexDirection: 'column-reverse',
        alignItems: 'flex-start'
      }
    }
  }, core.jsx("h1", {
    css: {
      fontSize: '1.5rem',
      fontWeight: 'normal',
      flex: 1,
      wordBreak: 'break-all'
    }
  }, core.jsx("nav", null, breadcrumbs.map(function (item, index, array) {
    return core.jsx(React.Fragment, {
      key: index
    }, index !== 0 && core.jsx("span", {
      css: {
        paddingLeft: 5,
        paddingRight: 5
      }
    }, "/"), index === array.length - 1 ? core.jsx("strong", null, item) : item);
  }))), core.jsx(PackageVersionPicker, {
    packageVersion: packageVersion,
    availableVersions: availableVersions,
    onChange: handleVersionChange
  }));
}

function PackageVersionPicker(_ref4) {
  var packageVersion = _ref4.packageVersion,
      availableVersions = _ref4.availableVersions,
      onChange = _ref4.onChange;

  function handleChange(event) {
    if (onChange) onChange(event.target.value);
  }

  return core.jsx("p", {
    css: {
      marginLeft: 20,
      '@media (max-width: 700px)': {
        marginLeft: 0,
        marginBottom: 0
      }
    }
  }, core.jsx("label", null, "Version:", ' ', core.jsx("select", {
    name: "version",
    defaultValue: packageVersion,
    onChange: handleChange,
    css: {
      appearance: 'none',
      cursor: 'pointer',
      padding: '4px 24px 4px 8px',
      fontWeight: 600,
      fontSize: '0.9em',
      color: '#24292e',
      border: '1px solid rgba(27,31,35,.2)',
      borderRadius: 3,
      backgroundColor: '#eff3f6',
      backgroundImage: "url(" + SelectDownArrow + ")",
      backgroundPosition: 'right 8px center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'auto 25%',
      ':hover': {
        backgroundColor: '#e6ebf1',
        borderColor: 'rgba(27,31,35,.35)'
      },
      ':active': {
        backgroundColor: '#e9ecef',
        borderColor: 'rgba(27,31,35,.35)',
        boxShadow: 'inset 0 0.15em 0.3em rgba(27,31,35,.15)'
      }
    }
  }, availableVersions.map(function (v) {
    return core.jsx("option", {
      key: v,
      value: v
    }, v);
  }))));
}

function AppContent(_ref5) {
  var baseUrl = _ref5.baseUrl,
      packageName = _ref5.packageName,
      packageVersion = _ref5.packageVersion,
      target = _ref5.target;
  return target.type === 'directory' ? core.jsx(FolderViewer, {
    path: target.path,
    details: target.details
  }) : target.type === 'file' ? core.jsx(FileViewer, {
    baseUrl: baseUrl,
    packageName: packageName,
    packageVersion: packageVersion,
    path: target.path,
    details: target.details
  }) : null;
}

function App(_ref6) {
  var baseUrl = _ref6.baseUrl,
      packageName = _ref6.packageName,
      packageVersion = _ref6.packageVersion,
      _ref6$availableVersio = _ref6.availableVersions,
      availableVersions = _ref6$availableVersio === void 0 ? [] : _ref6$availableVersio,
      filename = _ref6.filename,
      target = _ref6.target;
  var maxContentWidth = 940; // TODO: Make this changeable
  return core.jsx(React.Fragment, null, core.jsx(core.Global, {
    styles: globalStyles
  }), core.jsx(core.Global, {
    styles: lightCodeStyles
  }), core.jsx("div", {
    css: {
      flex: '1 0 auto'
    }
  }, core.jsx("div", {
    css: {
      maxWidth: maxContentWidth,
      padding: '0 20px',
      margin: '0 auto'
    }
  }, core.jsx(AppHeader, {
    baseUrl: baseUrl
  })), core.jsx("div", {
    css: {
      maxWidth: maxContentWidth,
      padding: '0 20px',
      margin: '0 auto'
    }
  }, core.jsx(AppNavigation, {
    baseUrl: baseUrl,
    packageName: packageName,
    packageVersion: packageVersion,
    availableVersions: availableVersions,
    filename: filename
  })), core.jsx("div", {
    css: {
      maxWidth: maxContentWidth,
      padding: '0 20px',
      margin: '0 auto',
      '@media (max-width: 700px)': {
        padding: 0,
        margin: 0
      }
    }
  }, core.jsx(AppContent, {
    baseUrl: baseUrl,
    packageName: packageName,
    packageVersion: packageVersion,
    target: target
  }))), core.jsx("footer", {
    css: {
      marginTop: '5rem',
      background: 'black',
      color: '#aaa'
    }
  }, core.jsx("div", {
    css: {
      maxWidth: maxContentWidth,
      padding: '10px 20px',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, core.jsx("p", null, core.jsx("span", null, "Build: ", buildId)), core.jsx("p", null, core.jsx("span", null, "\xA9 ", new Date().getFullYear(), " UNPKG")), core.jsx("p", {
    css: {
      fontSize: '1.5rem'
    }
  }, core.jsx("a", {
    href: "https://twitter.com/unpkg",
    css: {
      color: '#aaa',
      display: 'inline-block',
      ':hover': {
        color: 'white'
      }
    }
  }, core.jsx(TwitterIcon, null)), core.jsx("a", {
    href: "https://github.com/mjackson/unpkg",
    css: {
      color: '#aaa',
      display: 'inline-block',
      ':hover': {
        color: 'white'
      },
      marginLeft: '1rem'
    }
  }, core.jsx(GitHubIcon, null))))));
}

if (process.env.NODE_ENV !== 'production') {
  var targetType = PropTypes.shape({
    path: PropTypes.string.isRequired,
    type: PropTypes.oneOf(['directory', 'file']).isRequired,
    details: PropTypes.object.isRequired
  });
  App.propTypes = {
    packageName: PropTypes.string.isRequired,
    packageVersion: PropTypes.string.isRequired,
    availableVersions: PropTypes.arrayOf(PropTypes.string),
    filename: PropTypes.string.isRequired,
    target: targetType.isRequired
  };
}

/**
 * Encodes some data as JSON that may safely be included in HTML.
 */

function encodeJSONForScript(data) {
  return jsesc(data, {
    json: true,
    isScriptContext: true
  });
}

function createHTML$1(code) {
  return {
    __html: code
  };
}
function createScript(script) {
  return React.createElement('script', {
    dangerouslySetInnerHTML: createHTML$1(script)
  });
}

const baseUrl = getBaseUrl();
const promiseShim = 'window.Promise || document.write(\'\\x3Cscript src="/es6-promise@4.2.5/dist/es6-promise.min.js">\\x3C/script>\\x3Cscript>ES6Promise.polyfill()\\x3C/script>\')';
const fetchShim = 'window.fetch || document.write(\'\\x3Cscript src="/whatwg-fetch@3.0.0/dist/fetch.umd.js">\\x3C/script>\')';
function MainTemplate({
  title = 'UNPKG',
  description = 'The CDN for everything on npm',
  favicon = '/favicon.ico',
  data,
  content = createHTML$1(''),
  elements = []
}) {
  return React.createElement('html', {
    lang: 'en'
  }, React.createElement('head', null, // Global site tag (gtag.js) - Google Analytics
  React.createElement('script', {
    async: true,
    src: 'https://www.googletagmanager.com/gtag/js?id=G-GWCHLX9JX0'
  }), createScript(`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-GWCHLX9JX0');`), React.createElement('meta', {
    charSet: 'utf-8'
  }), React.createElement('meta', {
    httpEquiv: 'X-UA-Compatible',
    content: 'IE=edge,chrome=1'
  }), description && React.createElement('meta', {
    name: 'description',
    content: description
  }), React.createElement('meta', {
    name: 'viewport',
    content: 'width=device-width,initial-scale=1,maximum-scale=1'
  }), React.createElement('meta', {
    name: 'timestamp',
    content: new Date().toISOString()
  }), favicon && React.createElement('link', {
    rel: 'shortcut icon',
    href: favicon
  }), React.createElement('title', null, title), createScript(promiseShim), createScript(fetchShim), data && createScript(`window.__DATA__ = ${encodeJSONForScript(data)}`)), React.createElement('body', null, React.createElement('div', {
    id: 'root',
    dangerouslySetInnerHTML: content
  }), ...elements));
}

if (process.env.NODE_ENV !== 'production') {
  const htmlType = PropTypes.shape({
    __html: PropTypes.string
  });
  MainTemplate.propTypes = {
    title: PropTypes.string,
    description: PropTypes.string,
    favicon: PropTypes.string,
    data: PropTypes.any,
    content: htmlType,
    elements: PropTypes.arrayOf(PropTypes.node)
  };
}

var entryManifest = [{"browse":[{"format":"iife","globalImports":["react","react-dom","@emotion/core"],"url":"/_client/browse-d877e926.js","code":"'use strict';(function(v,A,c){function w(){w=Object.assign||function(a){for(var b=1;b<arguments.length;b++){var e=arguments[b],c;for(c in e)Object.prototype.hasOwnProperty.call(e,c)&&(a[c]=e[c])}return a};return w.apply(this,arguments)}function O(a,b){if(null==a)return{};var e={},c=Object.keys(a),d;for(d=0;d<c.length;d++){var h=c[d];0<=b.indexOf(h)||(e[h]=a[h])}return e}function P(a,b){b||(b=a.slice(0));a.raw=b;return a}function Q(a){return a&&a.__esModule&&Object.prototype.hasOwnProperty.call(a,\n\"default\")?a[\"default\"]:a}function C(a,b){return b={exports:{}},a(b,b.exports),b.exports}function I(a,b,e,c,d){for(var g in a)if(ua(a,g)){try{if(\"function\"!==typeof a[g]){var n=Error((c||\"React class\")+\": \"+e+\" type `\"+g+\"` is invalid; it must be a function, usually from the `prop-types` package, but received `\"+typeof a[g]+\"`.\");n.name=\"Invariant Violation\";throw n;}var l=a[g](b,g,c,e,null,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\")}catch(t){l=t}!l||l instanceof Error||J((c||\"React class\")+\": type specification of \"+\ne+\" `\"+g+\"` is invalid; the type checker function must return `null` or an `Error` but returned a \"+typeof l+\". You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).\");if(l instanceof Error&&!(l.message in K)){K[l.message]=!0;var R=d?d():\"\";J(\"Failed \"+e+\" type: \"+l.message+(null!=R?R:\"\"))}}}function F(){return null}function S(a){var b,e=a.children;a=a.css;return c.jsx(\"div\",{css:w((b={border:\"1px solid #dfe2e5\",\nborderRadius:3},b[\"@media (max-width: 700px)\"]={borderRightWidth:0,borderLeftWidth:0},b),a)},e)}function T(a){var b,e=a.children;a=a.css;return c.jsx(\"div\",{css:w((b={padding:10,background:\"#f6f8fa\",color:\"#424242\",border:\"1px solid #d1d5da\",borderTopLeftRadius:3,borderTopRightRadius:3,margin:\"-1px -1px 0\",display:\"flex\",flexDirection:\"row\",alignItems:\"center\",justifyContent:\"space-between\"},b[\"@media (max-width: 700px)\"]={paddingRight:20,paddingLeft:20},b),a)},e)}function U(a){return a&&a.map(function(a,\ne){return v.createElement(a.tag,z({key:e},a.attr),U(a.child))})}function D(a){return function(b){return v.createElement(va,z({attr:z({},a.attr)},b),U(a.child))}}function va(a){var b=function(b){var c=a.size||b.size||\"1em\";if(b.className)var e=b.className;a.className&&(e=(e?e+\" \":\"\")+a.className);var h=a.attr,n=a.title,l=wa(a,[\"attr\",\"title\"]);return v.createElement(\"svg\",z({stroke:\"currentColor\",fill:\"currentColor\",strokeWidth:\"0\"},b.attr,h,l,{className:e,style:z({color:a.color||b.color},b.style,\na.style),height:c,width:c,xmlns:\"http://www.w3.org/2000/svg\"}),n&&v.createElement(\"title\",null,n),a.children)};return void 0!==V?v.createElement(V.Consumer,null,function(a){return b(a)}):b(W)}function E(a,b){var e=b.css;b=O(b,[\"css\"]);return c.jsx(a,w({css:w({},e,{verticalAlign:\"text-bottom\"})},b))}function xa(a){return E(X,a)}function ya(a){return E(Y,a)}function za(a){return E(Z,a)}function Aa(a){return E(aa,a)}function Ba(a){return E(ba,a)}function ca(a){var b=a.path,e=a.details,g=Object.keys(e).reduce(function(a,\nb){var c=a.subdirs,g=a.files;b=e[b];\"directory\"===b.type?c.push(b):\"file\"===b.type&&g.push(b);return a},{subdirs:[],files:[]});a=g.subdirs;g=g.files;a.sort(da(\"path\"));g.sort(da(\"path\"));var d=[];\"/\"!==b&&d.push(c.jsx(\"tr\",{key:\"..\"},c.jsx(\"td\",{css:L}),c.jsx(\"td\",{css:y},c.jsx(\"a\",{title:\"Parent directory\",href:\"../\",css:M},\"..\")),c.jsx(\"td\",{css:y}),c.jsx(\"td\",{css:N})));a.forEach(function(a){a=a.path.substr(1<b.length?b.length+1:1);var e=a+\"/\";d.push(c.jsx(\"tr\",{key:a},c.jsx(\"td\",{css:L},c.jsx(za,\nnull)),c.jsx(\"td\",{css:y},c.jsx(\"a\",{title:a,href:e,css:M},a)),c.jsx(\"td\",{css:y},\"-\"),c.jsx(\"td\",{css:N},\"-\")))});g.forEach(function(a){var e=a.size,g=a.contentType;a=a.path.substr(1<b.length?b.length+1:1);d.push(c.jsx(\"tr\",{key:a},c.jsx(\"td\",{css:L},\"text/plain\"===g||\"text/markdown\"===g?c.jsx(xa,null):c.jsx(ya,null)),c.jsx(\"td\",{css:y},c.jsx(\"a\",{title:a,href:a,css:M},a)),c.jsx(\"td\",{css:y},ea(e)),c.jsx(\"td\",{css:N},g)))});var h=[];0<g.length&&h.push(g.length+\" file\"+(1===g.length?\"\":\"s\"));0<a.length&&\nh.push(a.length+\" folder\"+(1===a.length?\"\":\"s\"));return c.jsx(S,null,c.jsx(T,null,c.jsx(\"span\",null,h.join(\", \"))),c.jsx(\"table\",{css:{width:\"100%\",borderCollapse:\"collapse\",borderRadius:2,background:\"#fff\",\"@media (max-width: 700px)\":{\"& th + th + th + th, & td + td + td + td\":{display:\"none\"}},\"& tr:first-of-type td\":{borderTop:0}}},c.jsx(\"thead\",null,c.jsx(\"tr\",null,c.jsx(\"th\",null,c.jsx(G,null,\"Icon\")),c.jsx(\"th\",null,c.jsx(G,null,\"Name\")),c.jsx(\"th\",null,c.jsx(G,null,\"Size\")),c.jsx(\"th\",null,\nc.jsx(G,null,\"Content Type\")))),c.jsx(\"tbody\",null,d)))}function Ca(a){a=a.split(\"/\");return a[a.length-1]}function Da(a){var b=a.uri;return c.jsx(\"div\",{css:{padding:20,textAlign:\"center\"}},c.jsx(\"img\",{alt:Ca(a.path),src:b}))}function Ea(a){a=a.highlights.slice(0);var b=a.length&&\"\"===a[a.length-1];b&&a.pop();return c.jsx(\"div\",{className:\"code-listing\",css:{overflowX:\"auto\",overflowY:\"hidden\",paddingTop:5,paddingBottom:5}},c.jsx(\"table\",{css:{border:\"none\",borderCollapse:\"collapse\",borderSpacing:0}},\nc.jsx(\"tbody\",null,a.map(function(a,b){var e=b+1;return c.jsx(\"tr\",{key:b},c.jsx(\"td\",{id:\"L\"+e,css:{paddingLeft:10,paddingRight:10,color:\"rgba(27,31,35,.3)\",textAlign:\"right\",verticalAlign:\"top\",width:\"1%\",minWidth:50,userSelect:\"none\"}},c.jsx(\"span\",null,e)),c.jsx(\"td\",{id:\"LC\"+e,css:{paddingLeft:10,paddingRight:10,color:\"#24292e\",whiteSpace:\"pre\"}},c.jsx(\"code\",{dangerouslySetInnerHTML:{__html:a}})))}),!b&&c.jsx(\"tr\",{key:\"no-newline\"},c.jsx(\"td\",{css:{paddingLeft:10,paddingRight:10,color:\"rgba(27,31,35,.3)\",\ntextAlign:\"right\",verticalAlign:\"top\",width:\"1%\",minWidth:50,userSelect:\"none\"}},\"\\\\\"),c.jsx(\"td\",{css:{paddingLeft:10,color:\"rgba(27,31,35,.3)\",userSelect:\"none\"}},\"No newline at end of file\")))))}function Fa(){return c.jsx(\"div\",{css:{padding:20}},c.jsx(\"p\",{css:{textAlign:\"center\"}},\"No preview available.\"))}function fa(a){var b=a.baseUrl,e=a.packageName,g=a.packageVersion,d=a.path;a=a.details;var h=a.highlights,n=a.uri,l=a.language;return c.jsx(S,null,c.jsx(T,null,c.jsx(\"span\",null,ea(a.size)),\nc.jsx(\"span\",null,l),c.jsx(\"span\",null,c.jsx(\"a\",{href:b+\"/\"+e+\"@\"+g+d,css:{display:\"inline-block\",marginLeft:8,padding:\"2px 8px\",textDecoration:\"none\",fontWeight:600,fontSize:\"0.9rem\",color:\"#24292e\",backgroundColor:\"#eff3f6\",border:\"1px solid rgba(27,31,35,.2)\",borderRadius:3,\":hover\":{backgroundColor:\"#e6ebf1\",borderColor:\"rgba(27,31,35,.35)\"},\":active\":{backgroundColor:\"#e9ecef\",borderColor:\"rgba(27,31,35,.35)\",boxShadow:\"inset 0 0.15em 0.3em rgba(27,31,35,.15)\"}}},\"View Raw\"))),h?c.jsx(Ea,{highlights:h}):\nn?c.jsx(Da,{path:d,uri:n}):c.jsx(Fa,null))}function ha(){var a=P([\"\\n  .code-listing {\\n    background: #fbfdff;\\n    color: #383a42;\\n  }\\n  .code-comment,\\n  .code-quote {\\n    color: #a0a1a7;\\n    font-style: italic;\\n  }\\n  .code-doctag,\\n  .code-keyword,\\n  .code-link,\\n  .code-formula {\\n    color: #a626a4;\\n  }\\n  .code-section,\\n  .code-name,\\n  .code-selector-tag,\\n  .code-deletion,\\n  .code-subst {\\n    color: #e45649;\\n  }\\n  .code-literal {\\n    color: #0184bb;\\n  }\\n  .code-string,\\n  .code-regexp,\\n  .code-addition,\\n  .code-attribute,\\n  .code-meta-string {\\n    color: #50a14f;\\n  }\\n  .code-built_in,\\n  .code-class .code-title {\\n    color: #c18401;\\n  }\\n  .code-attr,\\n  .code-variable,\\n  .code-template-variable,\\n  .code-type,\\n  .code-selector-class,\\n  .code-selector-attr,\\n  .code-selector-pseudo,\\n  .code-number {\\n    color: #986801;\\n  }\\n  .code-symbol,\\n  .code-bullet,\\n  .code-meta,\\n  .code-selector-id,\\n  .code-title {\\n    color: #4078f2;\\n  }\\n  .code-emphasis {\\n    font-style: italic;\\n  }\\n  .code-strong {\\n    font-weight: bold;\\n  }\\n\"]);\nha=function(){return a};return a}function ia(){var a=P([\"\\n  html {\\n    box-sizing: border-box;\\n  }\\n  *,\\n  *:before,\\n  *:after {\\n    box-sizing: inherit;\\n  }\\n\\n  html,\\n  body,\\n  #root {\\n    height: 100%;\\n    margin: 0;\\n  }\\n\\n  body {\\n    \",\"\\n    font-size: 16px;\\n    line-height: 1.5;\\n    overflow-wrap: break-word;\\n    background: white;\\n    color: black;\\n  }\\n\\n  code {\\n    \",\"\\n  }\\n\\n  th,\\n  td {\\n    padding: 0;\\n  }\\n\\n  select {\\n    font-size: inherit;\\n  }\\n\\n  #root {\\n    display: flex;\\n    flex-direction: column;\\n  }\\n\"]);\nia=function(){return a};return a}function ja(a){var b=a.css;a=O(a,[\"css\"]);return c.jsx(\"a\",w({},a,{css:w({color:\"#0076ff\",textDecoration:\"none\",\":hover\":{textDecoration:\"underline\"}},b)}))}function Ga(a){return c.jsx(\"header\",{css:{marginTop:\"2rem\"}},c.jsx(\"h1\",{css:{textAlign:\"center\",fontSize:\"3rem\",letterSpacing:\"0.05em\"}},c.jsx(\"a\",{href:a.baseUrl+\"/\",css:{color:\"#000\",textDecoration:\"none\"}},\"UNPKG\")))}function Ha(a){var b=a.baseUrl,e=a.packageName,g=a.packageVersion,d=a.availableVersions;a=\na.filename;var h=[];if(\"/\"===a)h.push(e);else{var n=b+\"/browse/\"+e+\"@\"+g;h.push(c.jsx(ja,{href:n+\"/\"},e));b=a.replace(/^\\/+/,\"\").replace(/\\/+$/,\"\").split(\"/\");e=b.pop();b.forEach(function(a){n+=\"/\"+a;h.push(c.jsx(ja,{href:n+\"/\"},a))});h.push(e)}return c.jsx(\"header\",{css:{display:\"flex\",flexDirection:\"row\",alignItems:\"center\",\"@media (max-width: 700px)\":{flexDirection:\"column-reverse\",alignItems:\"flex-start\"}}},c.jsx(\"h1\",{css:{fontSize:\"1.5rem\",fontWeight:\"normal\",flex:1,wordBreak:\"break-all\"}},\nc.jsx(\"nav\",null,h.map(function(a,b,e){return c.jsx(v.Fragment,{key:b},0!==b&&c.jsx(\"span\",{css:{paddingLeft:5,paddingRight:5}},\"/\"),b===e.length-1?c.jsx(\"strong\",null,a):a)}))),c.jsx(Ia,{packageVersion:g,availableVersions:d,onChange:function(a){window.location.href=window.location.href.replace(\"@\"+g,\"@\"+a)}}))}function Ia(a){var b=a.onChange;return c.jsx(\"p\",{css:{marginLeft:20,\"@media (max-width: 700px)\":{marginLeft:0,marginBottom:0}}},c.jsx(\"label\",null,\"Version:\",\" \",c.jsx(\"select\",{name:\"version\",\ndefaultValue:a.packageVersion,onChange:function(a){b&&b(a.target.value)},css:{appearance:\"none\",cursor:\"pointer\",padding:\"4px 24px 4px 8px\",fontWeight:600,fontSize:\"0.9em\",color:\"#24292e\",border:\"1px solid rgba(27,31,35,.2)\",borderRadius:3,backgroundColor:\"#eff3f6\",backgroundImage:\"url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAYAAAC9vt6cAAAAAXNSR0IArs4c6QAAARFJREFUKBVjZAACNS39RhBNKrh17WI9o4quoT3Dn78HSNUMUs/CzOTI/O7Vi4dCYpJ3/jP+92BkYGAlyiBGhm8MjIxJt65e3MQM0vDu9YvLYmISILYZELOBxHABRkaGr0yMzF23r12YDFIDNgDEePv65SEhEXENBkYGFSAXuyGMjF8Z/jOsvX3tYiFIDwgwQSgIaaijnvj/P8M5IO8HsjiY/f//D4b//88A1SQhywG9jQr09PS4v/1mPAeUUPzP8B8cJowMjL+Bqu6xMQmaXL164AuyDgwDQJLa2qYSP//9vARkCoMVMzK8YeVkNbh+9uxzMB+JwGoASF5Vx0jz/98/18BqmZi171w9D2EjaaYKEwAEK00XQLdJuwAAAABJRU5ErkJggg==)\",\nbackgroundPosition:\"right 8px center\",backgroundRepeat:\"no-repeat\",backgroundSize:\"auto 25%\",\":hover\":{backgroundColor:\"#e6ebf1\",borderColor:\"rgba(27,31,35,.35)\"},\":active\":{backgroundColor:\"#e9ecef\",borderColor:\"rgba(27,31,35,.35)\",boxShadow:\"inset 0 0.15em 0.3em rgba(27,31,35,.15)\"}}},a.availableVersions.map(function(a){return c.jsx(\"option\",{key:a,value:a},a)}))))}function Ja(a){var b=a.baseUrl,e=a.packageName,g=a.packageVersion;a=a.target;return\"directory\"===a.type?c.jsx(ca,{path:a.path,details:a.details}):\n\"file\"===a.type?c.jsx(fa,{baseUrl:b,packageName:e,packageVersion:g,path:a.path,details:a.details}):null}function ka(a){var b=a.baseUrl,e=a.packageName,g=a.packageVersion,d=a.availableVersions;d=void 0===d?[]:d;var h=a.filename;a=a.target;return c.jsx(v.Fragment,null,c.jsx(c.Global,{styles:Ka}),c.jsx(c.Global,{styles:La}),c.jsx(\"div\",{css:{flex:\"1 0 auto\"}},c.jsx(\"div\",{css:{maxWidth:940,padding:\"0 20px\",margin:\"0 auto\"}},c.jsx(Ga,{baseUrl:b})),c.jsx(\"div\",{css:{maxWidth:940,padding:\"0 20px\",margin:\"0 auto\"}},\nc.jsx(Ha,{baseUrl:b,packageName:e,packageVersion:g,availableVersions:d,filename:h})),c.jsx(\"div\",{css:{maxWidth:940,padding:\"0 20px\",margin:\"0 auto\",\"@media (max-width: 700px)\":{padding:0,margin:0}}},c.jsx(Ja,{baseUrl:b,packageName:e,packageVersion:g,target:a}))),c.jsx(\"footer\",{css:{marginTop:\"5rem\",background:\"black\",color:\"#aaa\"}},c.jsx(\"div\",{css:{maxWidth:940,padding:\"10px 20px\",margin:\"0 auto\",display:\"flex\",flexDirection:\"row\",alignItems:\"center\",justifyContent:\"space-between\"}},c.jsx(\"p\",\nnull,c.jsx(\"span\",null,\"Build: \",\"6ec4aa4\")),c.jsx(\"p\",null,c.jsx(\"span\",null,\"\\u00a9 \",(new Date).getFullYear(),\" UNPKG\")),c.jsx(\"p\",{css:{fontSize:\"1.5rem\"}},c.jsx(\"a\",{href:\"https://twitter.com/unpkg\",css:{color:\"#aaa\",display:\"inline-block\",\":hover\":{color:\"white\"}}},c.jsx(Aa,null)),c.jsx(\"a\",{href:\"https://github.com/mjackson/unpkg\",css:{color:\"#aaa\",display:\"inline-block\",\":hover\":{color:\"white\"},marginLeft:\"1rem\"}},c.jsx(Ba,null))))))}var la=\"default\"in v?v[\"default\"]:v;A=A&&A.hasOwnProperty(\"default\")?\nA[\"default\"]:A;var Ma=\"undefined\"!==typeof globalThis?globalThis:\"undefined\"!==typeof window?window:\"undefined\"!==typeof global?global:\"undefined\"!==typeof self?self:{},k=C(function(a,b){function c(a){if(\"object\"===typeof a&&null!==a){var b=a.$$typeof;switch(b){case d:switch(a=a.type,a){case m:case f:case n:case k:case l:case r:return a;default:switch(a=a&&a.$$typeof,a){case q:case p:case t:return a;default:return b}}case x:case u:case h:return b}}}function g(a){return c(a)===f}Object.defineProperty(b,\n\"__esModule\",{value:!0});var d=(a=\"function\"===typeof Symbol&&Symbol.for)?Symbol.for(\"react.element\"):60103,h=a?Symbol.for(\"react.portal\"):60106,n=a?Symbol.for(\"react.fragment\"):60107,l=a?Symbol.for(\"react.strict_mode\"):60108,k=a?Symbol.for(\"react.profiler\"):60114,t=a?Symbol.for(\"react.provider\"):60109,q=a?Symbol.for(\"react.context\"):60110,m=a?Symbol.for(\"react.async_mode\"):60111,f=a?Symbol.for(\"react.concurrent_mode\"):60111,p=a?Symbol.for(\"react.forward_ref\"):60112,r=a?Symbol.for(\"react.suspense\"):\n60113,u=a?Symbol.for(\"react.memo\"):60115,x=a?Symbol.for(\"react.lazy\"):60116;b.typeOf=c;b.AsyncMode=m;b.ConcurrentMode=f;b.ContextConsumer=q;b.ContextProvider=t;b.Element=d;b.ForwardRef=p;b.Fragment=n;b.Lazy=x;b.Memo=u;b.Portal=h;b.Profiler=k;b.StrictMode=l;b.Suspense=r;b.isValidElementType=function(a){return\"string\"===typeof a||\"function\"===typeof a||a===n||a===f||a===k||a===l||a===r||\"object\"===typeof a&&null!==a&&(a.$$typeof===x||a.$$typeof===u||a.$$typeof===t||a.$$typeof===q||a.$$typeof===p)};\nb.isAsyncMode=function(a){return g(a)||c(a)===m};b.isConcurrentMode=g;b.isContextConsumer=function(a){return c(a)===q};b.isContextProvider=function(a){return c(a)===t};b.isElement=function(a){return\"object\"===typeof a&&null!==a&&a.$$typeof===d};b.isForwardRef=function(a){return c(a)===p};b.isFragment=function(a){return c(a)===n};b.isLazy=function(a){return c(a)===x};b.isMemo=function(a){return c(a)===u};b.isPortal=function(a){return c(a)===h};b.isProfiler=function(a){return c(a)===k};b.isStrictMode=\nfunction(a){return c(a)===l};b.isSuspense=function(a){return c(a)===r}});Q(k);var na=C(function(a,b){(function(){function a(a){if(\"object\"===typeof a&&null!==a){var b=a.$$typeof;switch(b){case h:switch(a=a.type,a){case f:case p:case l:case t:case k:case u:return a;default:switch(a=a&&a.$$typeof,a){case m:case r:case q:return a;default:return b}}case H:case x:case n:return b}}}function c(b){return a(b)===p}Object.defineProperty(b,\"__esModule\",{value:!0});var d=\"function\"===typeof Symbol&&Symbol.for,\nh=d?Symbol.for(\"react.element\"):60103,n=d?Symbol.for(\"react.portal\"):60106,l=d?Symbol.for(\"react.fragment\"):60107,k=d?Symbol.for(\"react.strict_mode\"):60108,t=d?Symbol.for(\"react.profiler\"):60114,q=d?Symbol.for(\"react.provider\"):60109,m=d?Symbol.for(\"react.context\"):60110,f=d?Symbol.for(\"react.async_mode\"):60111,p=d?Symbol.for(\"react.concurrent_mode\"):60111,r=d?Symbol.for(\"react.forward_ref\"):60112,u=d?Symbol.for(\"react.suspense\"):60113,x=d?Symbol.for(\"react.memo\"):60115,H=d?Symbol.for(\"react.lazy\"):\n60116;d=function(){};var Na=function(a){for(var b=arguments.length,f=Array(1<b?b-1:0),c=1;c<b;c++)f[c-1]=arguments[c];var p=0;b=\"Warning: \"+a.replace(/%s/g,function(){return f[p++]});\"undefined\"!==typeof console&&console.warn(b);try{throw Error(b);}catch(Ya){}},Oa=d=function(a,b){if(void 0===b)throw Error(\"`lowPriorityWarning(condition, format, ...args)` requires a warning message argument\");if(!a){for(var f=arguments.length,c=Array(2<f?f-2:0),p=2;p<f;p++)c[p-2]=arguments[p];Na.apply(void 0,[b].concat(c))}},\nma=!1;b.typeOf=a;b.AsyncMode=f;b.ConcurrentMode=p;b.ContextConsumer=m;b.ContextProvider=q;b.Element=h;b.ForwardRef=r;b.Fragment=l;b.Lazy=H;b.Memo=x;b.Portal=n;b.Profiler=t;b.StrictMode=k;b.Suspense=u;b.isValidElementType=function(a){return\"string\"===typeof a||\"function\"===typeof a||a===l||a===p||a===t||a===k||a===u||\"object\"===typeof a&&null!==a&&(a.$$typeof===H||a.$$typeof===x||a.$$typeof===q||a.$$typeof===m||a.$$typeof===r)};b.isAsyncMode=function(b){ma||(ma=!0,Oa(!1,\"The ReactIs.isAsyncMode() alias has been deprecated, and will be removed in React 17+. Update your code to use ReactIs.isConcurrentMode() instead. It has the exact same API.\"));\nreturn c(b)||a(b)===f};b.isConcurrentMode=c;b.isContextConsumer=function(b){return a(b)===m};b.isContextProvider=function(b){return a(b)===q};b.isElement=function(a){return\"object\"===typeof a&&null!==a&&a.$$typeof===h};b.isForwardRef=function(b){return a(b)===r};b.isFragment=function(b){return a(b)===l};b.isLazy=function(b){return a(b)===H};b.isMemo=function(b){return a(b)===x};b.isPortal=function(b){return a(b)===n};b.isProfiler=function(b){return a(b)===t};b.isStrictMode=function(b){return a(b)===\nk};b.isSuspense=function(b){return a(b)===u}})()});Q(na);var oa=C(function(a){a.exports=na}),pa=Object.getOwnPropertySymbols,Pa=Object.prototype.hasOwnProperty,Qa=Object.prototype.propertyIsEnumerable,Ra=function(){try{if(!Object.assign)return!1;var a=new String(\"abc\");a[5]=\"de\";if(\"5\"===Object.getOwnPropertyNames(a)[0])return!1;var b={};for(a=0;10>a;a++)b[\"_\"+String.fromCharCode(a)]=a;if(\"0123456789\"!==Object.getOwnPropertyNames(b).map(function(a){return b[a]}).join(\"\"))return!1;var c={};\"abcdefghijklmnopqrst\".split(\"\").forEach(function(a){c[a]=\na});return\"abcdefghijklmnopqrst\"!==Object.keys(Object.assign({},c)).join(\"\")?!1:!0}catch(g){return!1}}()?Object.assign:function(a,b){if(null===a||void 0===a)throw new TypeError(\"Object.assign cannot be called with null or undefined\");var c=Object(a);for(var g,d=1;d<arguments.length;d++){var h=Object(arguments[d]);for(var n in h)Pa.call(h,n)&&(c[n]=h[n]);if(pa){g=pa(h);for(var l=0;l<g.length;l++)Qa.call(h,g[l])&&(c[g[l]]=h[g[l]])}}return c},J=function(){},K={},ua=Function.call.bind(Object.prototype.hasOwnProperty);\nJ=function(a){a=\"Warning: \"+a;\"undefined\"!==typeof console&&console.error(a);try{throw Error(a);}catch(b){}};I.resetWarningCache=function(){K={}};var Sa=Function.call.bind(Object.prototype.hasOwnProperty),B=function(){};B=function(a){a=\"Warning: \"+a;\"undefined\"!==typeof console&&console.error(a);try{throw Error(a);}catch(b){}};var Ta=function(a,b){function c(a,b){return a===b?0!==a||1/a===1/b:a!==a&&b!==b}function g(a){this.message=a;this.stack=\"\"}function d(a){function f(f,p,d,r,m,h,u){r=r||\"<<anonymous>>\";\nh=h||d;if(\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"!==u){if(b)throw f=Error(\"Calling PropTypes validators directly is not supported by the `prop-types` package. Use `PropTypes.checkPropTypes()` to call them. Read more at http://fb.me/use-check-prop-types\"),f.name=\"Invariant Violation\",f;\"undefined\"!==typeof console&&(u=r+\":\"+d,!c[u]&&3>e&&(B(\"You are manually calling a React.PropTypes validation function for the `\"+h+\"` prop on `\"+r+\"`. This is deprecated and will throw in the standalone `prop-types` package. You may be seeing this warning due to a third-party PropTypes library. See https://fb.me/react-warning-dont-call-proptypes for details.\"),\nc[u]=!0,e++))}return null==p[d]?f?null===p[d]?new g(\"The \"+m+\" `\"+h+\"` is marked as required \"+(\"in `\"+r+\"`, but its value is `null`.\")):new g(\"The \"+m+\" `\"+h+\"` is marked as required in \"+(\"`\"+r+\"`, but its value is `undefined`.\")):null:a(p,d,r,m,h)}var c={},e=0,d=f.bind(null,!1);d.isRequired=f.bind(null,!0);return d}function h(a){return d(function(b,f,c,d,e,m){b=b[f];return l(b)!==a?(b=k(b),new g(\"Invalid \"+d+\" `\"+e+\"` of type \"+(\"`\"+b+\"` supplied to `\"+c+\"`, expected \")+(\"`\"+a+\"`.\"))):null})}function n(b){switch(typeof b){case \"number\":case \"string\":case \"undefined\":return!0;\ncase \"boolean\":return!b;case \"object\":if(Array.isArray(b))return b.every(n);if(null===b||a(b))return!0;var c=b&&(q&&b[q]||b[\"@@iterator\"]);var f=\"function\"===typeof c?c:void 0;if(f)if(c=f.call(b),f!==b.entries)for(;!(b=c.next()).done;){if(!n(b.value))return!1}else for(;!(b=c.next()).done;){if((b=b.value)&&!n(b[1]))return!1}else return!1;return!0;default:return!1}}function l(a){var b=typeof a;return Array.isArray(a)?\"array\":a instanceof RegExp?\"object\":\"symbol\"===b||a&&(\"Symbol\"===a[\"@@toStringTag\"]||\n\"function\"===typeof Symbol&&a instanceof Symbol)?\"symbol\":b}function k(a){if(\"undefined\"===typeof a||null===a)return\"\"+a;var b=l(a);if(\"object\"===b){if(a instanceof Date)return\"date\";if(a instanceof RegExp)return\"regexp\"}return b}function t(a){a=k(a);switch(a){case \"array\":case \"object\":return\"an \"+a;case \"boolean\":case \"date\":case \"regexp\":return\"a \"+a;default:return a}}var q=\"function\"===typeof Symbol&&Symbol.iterator,m={array:h(\"array\"),bool:h(\"boolean\"),func:h(\"function\"),number:h(\"number\"),object:h(\"object\"),\nstring:h(\"string\"),symbol:h(\"symbol\"),any:d(F),arrayOf:function(a){return d(function(b,c,f,d,e){if(\"function\"!==typeof a)return new g(\"Property `\"+e+\"` of component `\"+f+\"` has invalid PropType notation inside arrayOf.\");b=b[c];if(!Array.isArray(b))return b=l(b),new g(\"Invalid \"+d+\" `\"+e+\"` of type \"+(\"`\"+b+\"` supplied to `\"+f+\"`, expected an array.\"));for(c=0;c<b.length;c++){var p=a(b,c,f,d,e+\"[\"+c+\"]\",\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\");if(p instanceof Error)return p}return null})},\nelement:function(){return d(function(b,c,d,e,m){b=b[c];return a(b)?null:(b=l(b),new g(\"Invalid \"+e+\" `\"+m+\"` of type \"+(\"`\"+b+\"` supplied to `\"+d+\"`, expected a single ReactElement.\")))})}(),elementType:function(){return d(function(a,b,c,d,e){a=a[b];return oa.isValidElementType(a)?null:(a=l(a),new g(\"Invalid \"+d+\" `\"+e+\"` of type \"+(\"`\"+a+\"` supplied to `\"+c+\"`, expected a single ReactElement type.\")))})}(),instanceOf:function(a){return d(function(b,c,f,d,e){if(!(b[c]instanceof a)){var p=a.name||\n\"<<anonymous>>\";b=b[c];b=b.constructor&&b.constructor.name?b.constructor.name:\"<<anonymous>>\";return new g(\"Invalid \"+d+\" `\"+e+\"` of type \"+(\"`\"+b+\"` supplied to `\"+f+\"`, expected \")+(\"instance of `\"+p+\"`.\"))}return null})},node:function(){return d(function(a,b,c,d,e){return n(a[b])?null:new g(\"Invalid \"+d+\" `\"+e+\"` supplied to \"+(\"`\"+c+\"`, expected a ReactNode.\"))})}(),objectOf:function(a){return d(function(b,c,f,d,e){if(\"function\"!==typeof a)return new g(\"Property `\"+e+\"` of component `\"+f+\"` has invalid PropType notation inside objectOf.\");\nb=b[c];c=l(b);if(\"object\"!==c)return new g(\"Invalid \"+d+\" `\"+e+\"` of type \"+(\"`\"+c+\"` supplied to `\"+f+\"`, expected an object.\"));for(var m in b)if(Sa(b,m)&&(c=a(b,m,f,d,e+\".\"+m,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"),c instanceof Error))return c;return null})},oneOf:function(a){return Array.isArray(a)?d(function(b,f,d,e,m){b=b[f];for(f=0;f<a.length;f++)if(c(b,a[f]))return null;f=JSON.stringify(a,function(a,b){return\"symbol\"===k(b)?String(b):b});return new g(\"Invalid \"+e+\" `\"+m+\"` of value `\"+\nString(b)+\"` \"+(\"supplied to `\"+d+\"`, expected one of \"+f+\".\"))}):(1<arguments.length?B(\"Invalid arguments supplied to oneOf, expected an array, got \"+arguments.length+\" arguments. A common mistake is to write oneOf(x, y, z) instead of oneOf([x, y, z]).\"):B(\"Invalid argument supplied to oneOf, expected an array.\"),F)},oneOfType:function(a){if(!Array.isArray(a))return B(\"Invalid argument supplied to oneOfType, expected an instance of array.\"),F;for(var b=0;b<a.length;b++){var c=a[b];if(\"function\"!==\ntypeof c)return B(\"Invalid argument supplied to oneOfType. Expected an array of check functions, but received \"+t(c)+\" at index \"+b+\".\"),F}return d(function(b,c,f,d,e){for(var m=0;m<a.length;m++)if(null==(0,a[m])(b,c,f,d,e,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"))return null;return new g(\"Invalid \"+d+\" `\"+e+\"` supplied to \"+(\"`\"+f+\"`.\"))})},shape:function(a){return d(function(b,c,d,f,e){b=b[c];c=l(b);if(\"object\"!==c)return new g(\"Invalid \"+f+\" `\"+e+\"` of type `\"+c+\"` \"+(\"supplied to `\"+d+\"`, expected `object`.\"));\nfor(var m in a)if(c=a[m])if(c=c(b,m,d,f,e+\".\"+m,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"))return c;return null})},exact:function(a){return d(function(b,c,d,e,f){var m=b[c],p=l(m);if(\"object\"!==p)return new g(\"Invalid \"+e+\" `\"+f+\"` of type `\"+p+\"` \"+(\"supplied to `\"+d+\"`, expected `object`.\"));p=Ra({},b[c],a);for(var h in p){p=a[h];if(!p)return new g(\"Invalid \"+e+\" `\"+f+\"` key `\"+h+\"` supplied to `\"+d+\"`.\\nBad object: \"+JSON.stringify(b[c],null,\"  \")+\"\\nValid keys: \"+JSON.stringify(Object.keys(a),\nnull,\"  \"));if(p=p(m,h,d,e,f+\".\"+h,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"))return p}return null})}};g.prototype=Error.prototype;m.checkPropTypes=I;m.resetWarningCache=I.resetWarningCache;return m.PropTypes=m};k=C(function(a){a.exports=Ta(oa.isElement,!0)});var Ua=Object.assign||function(a){for(var b=1;b<arguments.length;b++){var c=arguments[b],g;for(g in c)Object.prototype.hasOwnProperty.call(c,g)&&(a[g]=c[g])}return a},Va={border:0,clip:\"rect(0 0 0 0)\",height:\"1px\",width:\"1px\",margin:\"-1px\",\npadding:0,overflow:\"hidden\",position:\"absolute\"},G=function(a){return la.createElement(\"div\",Ua({style:Va},a))},qa=C(function(a){(function(b,c){a.exports=c()})(Ma,function(){function a(a){if(!a)return!0;if(!d(a)||0!==a.length)for(var b in a)if(t.call(a,b))return!1;return!0}function c(a){return\"number\"===typeof a||\"[object Number]\"===k.call(a)}function g(a){return\"string\"===typeof a||\"[object String]\"===k.call(a)}function d(a){return\"object\"===typeof a&&\"number\"===typeof a.length&&\"[object Array]\"===\nk.call(a)}function h(a){var b=parseInt(a);return b.toString()===a?b:a}function n(b,d,e,k){c(d)&&(d=[d]);if(a(d))return b;if(g(d))return n(b,d.split(\".\"),e,k);var f=h(d[0]);if(1===d.length)return d=b[f],void 0!==d&&k||(b[f]=e),d;void 0===b[f]&&(c(f)?b[f]=[]:b[f]={});return n(b[f],d.slice(1),e,k)}function l(b,e){c(e)&&(e=[e]);if(!a(b)){if(a(e))return b;if(g(e))return l(b,e.split(\".\"));var f=h(e[0]),m=b[f];if(1===e.length)void 0!==m&&(d(b)?b.splice(f,1):delete b[f]);else if(void 0!==b[f])return l(b[f],\ne.slice(1));return b}}var k=Object.prototype.toString,t=Object.prototype.hasOwnProperty,q={ensureExists:function(a,b,c){return n(a,b,c,!0)},set:function(a,b,c,d){return n(a,b,c,d)},insert:function(a,b,c,e){var f=q.get(a,b);e=~~e;d(f)||(f=[],q.set(a,b,f));f.splice(e,0,c)},empty:function(b,e){if(a(e))return b;if(!a(b)){var f,h;if(!(f=q.get(b,e)))return b;if(g(f))return q.set(b,e,\"\");if(\"boolean\"===typeof f||\"[object Boolean]\"===k.call(f))return q.set(b,e,!1);if(c(f))return q.set(b,e,0);if(d(f))f.length=\n0;else if(\"object\"===typeof f&&\"[object Object]\"===k.call(f))for(h in f)t.call(f,h)&&delete f[h];else return q.set(b,e,null)}},push:function(a,b){var c=q.get(a,b);d(c)||(c=[],q.set(a,b,c));c.push.apply(c,Array.prototype.slice.call(arguments,2))},coalesce:function(a,b,c){for(var d,e=0,f=b.length;e<f;e++)if(void 0!==(d=q.get(a,b[e])))return d;return c},get:function(b,d,e){c(d)&&(d=[d]);if(a(d))return b;if(a(b))return e;if(g(d))return q.get(b,d.split(\".\"),e);var f=h(d[0]);return 1===d.length?void 0===\nb[f]?e:b[f]:q.get(b[f],d.slice(1),e)},del:function(a,b){return l(a,b)}};return q})});var ra=function(a){return function(b){return typeof b===a}};var Wa=function(a,b){var c=1,g=b||function(a,b){return b};\"-\"===a[0]&&(c=-1,a=a.substr(1));return function(b,e){var d;b=g(a,qa.get(b,a));e=g(a,qa.get(e,a));b<e&&(d=-1);b>e&&(d=1);b===e&&(d=0);return d*c}};var da=function(){var a=Array.prototype.slice.call(arguments),b=a.filter(ra(\"string\")),c=a.filter(ra(\"function\"))[0];return function(a,d){for(var e=b.length,\ng=0,k=0;0===g&&k<e;)g=Wa(b[k],c)(a,d),k++;return g}};let sa=\"B kB MB GB TB PB EB ZB YB\".split(\" \"),ta=(a,b)=>{let c=a;\"string\"===typeof b?c=a.toLocaleString(b):!0===b&&(c=a.toLocaleString());return c};var ea=(a,b)=>{if(!Number.isFinite(a))throw new TypeError(`Expected a finite number, got ${typeof a}: ${a}`);b=Object.assign({},b);if(b.signed&&0===a)return\" 0 B\";var c=0>a;let g=c?\"-\":b.signed?\"+\":\"\";c&&(a=-a);if(1>a)return a=ta(a,b.locale),g+a+\" B\";c=Math.min(Math.floor(Math.log10(a)/3),sa.length-\n1);a=Number((a/Math.pow(1E3,c)).toPrecision(3));a=ta(a,b.locale);return g+a+\" \"+sa[c]},W={color:void 0,size:void 0,className:void 0,style:void 0,attr:void 0},V=v.createContext&&v.createContext(W),z=window&&window.__assign||function(){z=Object.assign||function(a){for(var b,c=1,g=arguments.length;c<g;c++){b=arguments[c];for(var d in b)Object.prototype.hasOwnProperty.call(b,d)&&(a[d]=b[d])}return a};return z.apply(this,arguments)},wa=window&&window.__rest||function(a,b){var c={},g;for(g in a)Object.prototype.hasOwnProperty.call(a,\ng)&&0>b.indexOf(g)&&(c[g]=a[g]);if(null!=a&&\"function\"===typeof Object.getOwnPropertySymbols){var d=0;for(g=Object.getOwnPropertySymbols(a);d<g.length;d++)0>b.indexOf(g[d])&&(c[g[d]]=a[g[d]])}return c},Y=function(a){return D({tag:\"svg\",attr:{viewBox:\"0 0 12 16\"},child:[{tag:\"path\",attr:{fillRule:\"evenodd\",d:\"M8.5 1H1c-.55 0-1 .45-1 1v12c0 .55.45 1 1 1h10c.55 0 1-.45 1-1V4.5L8.5 1zM11 14H1V2h7l3 3v9zM5 6.98L3.5 8.5 5 10l-.5 1L2 8.5 4.5 6l.5.98zM7.5 6L10 8.5 7.5 11l-.5-.98L8.5 8.5 7 7l.5-1z\"}}]})(a)};\nY.displayName=\"GoFileCode\";var Z=function(a){return D({tag:\"svg\",attr:{viewBox:\"0 0 14 16\"},child:[{tag:\"path\",attr:{fillRule:\"evenodd\",d:\"M13 4H7V3c0-.66-.31-1-1-1H1c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zM6 4H1V3h5v1z\"}}]})(a)};Z.displayName=\"GoFileDirectory\";var X=function(a){return D({tag:\"svg\",attr:{viewBox:\"0 0 12 16\"},child:[{tag:\"path\",attr:{fillRule:\"evenodd\",d:\"M6 5H2V4h4v1zM2 8h7V7H2v1zm0 2h7V9H2v1zm0 2h7v-1H2v1zm10-7.5V14c0 .55-.45 1-1 1H1c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1h7.5L12 4.5zM11 5L8 2H1v12h10V5z\"}}]})(a)};\nX.displayName=\"GoFile\";var ba=function(a){return D({tag:\"svg\",attr:{viewBox:\"0 0 496 512\"},child:[{tag:\"path\",attr:{d:\"M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z\"}}]})(a)};\nba.displayName=\"FaGithub\";var aa=function(a){return D({tag:\"svg\",attr:{viewBox:\"0 0 512 512\"},child:[{tag:\"path\",attr:{d:\"M459.37 151.716c.325 4.548.325 9.097.325 13.645 0 138.72-105.583 298.558-298.558 298.558-59.452 0-114.68-17.219-161.137-47.106 8.447.974 16.568 1.299 25.34 1.299 49.055 0 94.213-16.568 130.274-44.832-46.132-.975-84.792-31.188-98.112-72.772 6.498.974 12.995 1.624 19.818 1.624 9.421 0 18.843-1.3 27.614-3.573-48.081-9.747-84.143-51.98-84.143-102.985v-1.299c13.969 7.797 30.214 12.67 47.431 13.319-28.264-18.843-46.781-51.005-46.781-87.391 0-19.492 5.197-37.36 14.294-52.954 51.655 63.675 129.3 105.258 216.365 109.807-1.624-7.797-2.599-15.918-2.599-24.04 0-57.828 46.782-104.934 104.934-104.934 30.213 0 57.502 12.67 76.67 33.137 23.715-4.548 46.456-13.32 66.599-25.34-7.798 24.366-24.366 44.833-46.132 57.827 21.117-2.273 41.584-8.122 60.426-16.243-14.292 20.791-32.161 39.308-52.628 54.253z\"}}]})(a)};\naa.displayName=\"FaTwitter\";var M={color:\"#0076ff\",textDecoration:\"none\",\":hover\":{textDecoration:\"underline\"}},y={paddingTop:6,paddingRight:3,paddingBottom:6,paddingLeft:3,borderTop:\"1px solid #eaecef\"},L=w({},y,{color:\"#424242\",width:17,paddingRight:2,paddingLeft:10,\"@media (max-width: 700px)\":{paddingLeft:20}}),N=w({},y,{textAlign:\"right\",paddingRight:10,\"@media (max-width: 700px)\":{paddingRight:20}});ca.propTypes={path:k.string.isRequired,details:k.objectOf(k.shape({path:k.string.isRequired,type:k.oneOf([\"directory\",\n\"file\"]).isRequired,contentType:k.string,integrity:k.string,size:k.number})).isRequired};fa.propTypes={path:k.string.isRequired,details:k.shape({contentType:k.string.isRequired,highlights:k.arrayOf(k.string),uri:k.string,integrity:k.string.isRequired,language:k.string.isRequired,size:k.number.isRequired}).isRequired};var Ka=c.css(ia(),'\\nfont-family: -apple-system,\\n  BlinkMacSystemFont,\\n  \"Segoe UI\",\\n  \"Roboto\",\\n  \"Oxygen\",\\n  \"Ubuntu\",\\n  \"Cantarell\",\\n  \"Fira Sans\",\\n  \"Droid Sans\",\\n  \"Helvetica Neue\",\\n  sans-serif;\\n',\n\"\\nfont-family: Menlo,\\n  Monaco,\\n  Lucida Console,\\n  Liberation Mono,\\n  DejaVu Sans Mono,\\n  Bitstream Vera Sans Mono,\\n  Courier New,\\n  monospace;\\n\"),La=c.css(ha()),Xa=k.shape({path:k.string.isRequired,type:k.oneOf([\"directory\",\"file\"]).isRequired,details:k.object.isRequired});ka.propTypes={packageName:k.string.isRequired,packageVersion:k.string.isRequired,availableVersions:k.arrayOf(k.string),filename:k.string.isRequired,target:Xa.isRequired};A.hydrate(la.createElement(ka,window.__DATA__||\n{}),document.getElementById(\"root\"))})(React,ReactDOM,emotionCore);\n"}]},{"main":[{"format":"iife","globalImports":["react","react-dom","@emotion/core"],"url":"/_client/main-e199f934.js","code":"'use strict';(function(p,A,c){function C(){C=Object.assign||function(a){for(var b=1;b<arguments.length;b++){var d=arguments[b],e;for(e in d)Object.prototype.hasOwnProperty.call(d,e)&&(a[e]=d[e])}return a};return C.apply(this,arguments)}function ka(a,b){b||(b=a.slice(0));a.raw=b;return a}function O(a){return a&&a.__esModule&&Object.prototype.hasOwnProperty.call(a,\"default\")?a[\"default\"]:a}function D(a,b){return b={exports:{}},a(b,b.exports),b.exports}function I(a,b,d,e,c){for(var f in a)if(la(a,f)){try{if(\"function\"!==\ntypeof a[f]){var g=Error((e||\"React class\")+\": \"+d+\" type `\"+f+\"` is invalid; it must be a function, usually from the `prop-types` package, but received `\"+typeof a[f]+\"`.\");g.name=\"Invariant Violation\";throw g;}var h=a[f](b,f,e,d,null,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\")}catch(n){h=n}!h||h instanceof Error||J((e||\"React class\")+\": type specification of \"+d+\" `\"+f+\"` is invalid; the type checker function must return `null` or an `Error` but returned a \"+typeof h+\". You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).\");\nif(h instanceof Error&&!(h.message in K)){K[h.message]=!0;var y=c?c():\"\";J(\"Failed \"+d+\" type: \"+h.message+(null!=y?y:\"\"))}}}function E(){return null}function ma(a,b){if(null===b)return null;var d;if(0===a.length)return a=new Date(0),a.setUTCFullYear(b),a;if(d=na.exec(a)){a=new Date(0);var e=parseInt(d[1],10)-1;a.setUTCFullYear(b,e);return a}return(d=oa.exec(a))?(a=new Date(0),d=parseInt(d[1],10),a.setUTCFullYear(b,0,d),a):(d=pa.exec(a))?(a=new Date(0),e=parseInt(d[1],10)-1,d=parseInt(d[2],10),a.setUTCFullYear(b,\ne,d),a):(d=qa.exec(a))?(a=parseInt(d[1],10)-1,P(b,a)):(d=ra.exec(a))?(a=parseInt(d[1],10)-1,d=parseInt(d[2],10)-1,P(b,a,d)):null}function sa(a){var b;if(b=ta.exec(a))return a=parseFloat(b[1].replace(\",\",\".\")),a%24*36E5;if(b=ua.exec(a)){a=parseInt(b[1],10);var d=parseFloat(b[2].replace(\",\",\".\"));return a%24*36E5+6E4*d}return(b=va.exec(a))?(a=parseInt(b[1],10),d=parseInt(b[2],10),b=parseFloat(b[3].replace(\",\",\".\")),a%24*36E5+6E4*d+1E3*b):null}function wa(a){var b;return(b=xa.exec(a))?0:(b=ya.exec(a))?\n(a=60*parseInt(b[2],10),\"+\"===b[1]?-a:a):(b=za.exec(a))?(a=60*parseInt(b[2],10)+parseInt(b[3],10),\"+\"===b[1]?-a:a):0}function P(a,b,d){b=b||0;d=d||0;var e=new Date(0);e.setUTCFullYear(a,0,4);a=e.getUTCDay()||7;b=7*b+d+1-a;e.setUTCDate(e.getUTCDate()+b);return e}function Aa(a){var b=a%100;if(20<b||10>b)switch(b%10){case 1:return a+\"st\";case 2:return a+\"nd\";case 3:return a+\"rd\"}return a+\"th\"}function Ba(a,b,d){var e=a.match(d),c=e.length;for(a=0;a<c;a++)d=b[e[a]]||L[e[a]],e[a]=d?d:Ca(e[a]);return function(a){for(var b=\n\"\",d=0;d<c;d++)b=e[d]instanceof Function?b+e[d](a,L):b+e[d];return b}}function Ca(a){return a.match(/\\[[\\s\\S]/)?a.replace(/^\\[|]$/g,\"\"):a.replace(/\\\\/g,\"\")}function Q(a,b){b=b||\"\";var d=Math.abs(a),e=d%60;return(0<a?\"-\":\"+\")+r(Math.floor(d/60),2)+b+r(e,2)}function r(a,b){for(a=Math.abs(a).toString();a.length<b;)a=\"0\"+a;return a}function R(a){a=String(a).split(\"\");for(var b=[];a.length;)b.unshift(a.splice(-3).join(\"\"));return b.join(\",\")}function Da(a,b){void 0===b&&(b=1);return(100*a).toPrecision(b+\n2)}function S(a){return a&&a.map(function(a,d){return p.createElement(a.tag,z({key:d},a.attr),S(a.child))})}function Ea(a){return function(b){return p.createElement(Fa,z({attr:z({},a.attr)},b),S(a.child))}}function Fa(a){var b=function(b){var d=a.size||b.size||\"1em\";if(b.className)var c=b.className;a.className&&(c=(c?c+\" \":\"\")+a.className);var k=a.attr,g=a.title,h=Ga(a,[\"attr\",\"title\"]);return p.createElement(\"svg\",z({stroke:\"currentColor\",fill:\"currentColor\",strokeWidth:\"0\"},b.attr,k,h,{className:c,\nstyle:z({color:a.color||b.color},b.style,a.style),height:d,width:d,xmlns:\"http://www.w3.org/2000/svg\"}),g&&p.createElement(\"title\",null,g),a.children)};return void 0!==T?p.createElement(T.Consumer,null,function(a){return b(a)}):b(U)}function Ha(a){var b=V,d=a.css;var e=[\"css\"];if(null==a)a={};else{var f={},k=Object.keys(a),g;for(g=0;g<k.length;g++){var h=k[g];0<=e.indexOf(h)||(f[h]=a[h])}a=f}return c.jsx(b,C({css:C({},d,{verticalAlign:\"text-bottom\"})},a))}function W(){var a=ka([\"\\n  html {\\n    box-sizing: border-box;\\n  }\\n  *,\\n  *:before,\\n  *:after {\\n    box-sizing: inherit;\\n  }\\n\\n  html,\\n  body,\\n  #root {\\n    height: 100%;\\n    margin: 0;\\n  }\\n\\n  body {\\n    \",\n\"\\n    font-size: 16px;\\n    line-height: 1.5;\\n    overflow-wrap: break-word;\\n    background: white;\\n    color: black;\\n  }\\n\\n  code {\\n    \",\"\\n    font-size: 1rem;\\n    padding: 0 3px;\\n    background-color: #eee;\\n  }\\n\\n  dd,\\n  ul {\\n    margin-left: 0;\\n    padding-left: 25px;\\n  }\\n\"]);W=function(){return a};return a}function l(a){return c.jsx(\"a\",C({},a,{css:{color:\"#0076ff\",textDecoration:\"none\",\":hover\":{textDecoration:\"underline\"}}}))}function Ia(a){a=a.data.totals;var b=v(a.since),\nd=v(a.until);return c.jsx(\"p\",null,\"From \",c.jsx(\"strong\",null,X(b,\"MMM D\")),\" to\",\" \",c.jsx(\"strong\",null,X(d,\"MMM D\")),\" unpkg served\",\" \",c.jsx(\"strong\",null,R(a.requests.all)),\" requests and a total of \",c.jsx(\"strong\",null,Ja(a.bandwidth.all)),\" of data to\",\" \",c.jsx(\"strong\",null,R(a.uniques.all)),\" unique visitors,\",\" \",c.jsx(\"strong\",null,Da(a.requests.cached/a.requests.all,2),\"%\"),\" \",\"of which were served from the cache.\")}function Y(){var a=p.useState(\"object\"===typeof window&&window.localStorage&&\nwindow.localStorage.savedStats?JSON.parse(window.localStorage.savedStats):null),b=a[0],d=a[1];a=!(!b||b.error);var e=JSON.stringify(b);p.useEffect(function(){window.localStorage.savedStats=e},[e]);p.useEffect(function(){fetch(\"/api/stats?period=last-month\").then(function(a){return a.json()}).then(d)},[]);return c.jsx(p.Fragment,null,c.jsx(c.Global,{styles:Ka}),c.jsx(\"div\",{css:{maxWidth:740,margin:\"0 auto\"}},c.jsx(\"div\",{css:{padding:\"0 20px\"}},c.jsx(\"header\",null,c.jsx(\"h1\",{css:{textAlign:\"center\",\nfontSize:\"4.5em\",letterSpacing:\"0.05em\",\"@media (min-width: 700px)\":{marginTop:\"1.5em\"}}},\"UNPKG\"),c.jsx(\"p\",null,\"unpkg is a fast, global content delivery network for everything on\",\" \",c.jsx(l,{href:\"https://www.npmjs.com/\"},\"npm\"),\". Use it to quickly and easily load any file from any package using a URL like:\"),c.jsx(\"div\",{css:{textAlign:\"center\",backgroundColor:\"#eee\",margin:\"2em 0\",padding:\"5px 0\"}},\"/unpkg/:package@:version/:file\"),a&&c.jsx(Ia,{data:b})),c.jsx(\"h3\",{css:{fontSize:\"1.6em\"},\nid:\"examples\"},\"Examples\"),c.jsx(\"p\",null,\"Using a fixed version:\"),c.jsx(\"ul\",null,c.jsx(\"li\",null,c.jsx(l,{href:\"/unpkg/react@16.7.0/umd/react.production.min.js\"},\"/unpkg/react@16.7.0/umd/react.production.min.js\")),c.jsx(\"li\",null,c.jsx(l,{href:\"/unpkg/react-dom@16.7.0/umd/react-dom.production.min.js\"},\"/unpkg/react-dom@16.7.0/umd/react-dom.production.min.js\"))),c.jsx(\"p\",null,\"You may also use a\",\" \",c.jsx(l,{href:\"https://docs.npmjs.com/about-semantic-versioning\"},\"semver range\"),\" \",\"or a \",\nc.jsx(l,{href:\"https://docs.npmjs.com/cli/dist-tag\"},\"tag\"),\" \",\"instead of a fixed version number, or omit the version/tag entirely to use the \",c.jsx(\"code\",null,\"latest\"),\" tag.\"),c.jsx(\"ul\",null,c.jsx(\"li\",null,c.jsx(l,{href:\"/unpkg/react@^16/umd/react.production.min.js\"},\"/unpkg/react@^16/umd/react.production.min.js\")),c.jsx(\"li\",null,c.jsx(l,{href:\"/unpkg/react/umd/react.production.min.js\"},\"/unpkg/react/umd/react.production.min.js\"))),c.jsx(\"p\",null,\"If you omit the file path (i.e. use a \\u201cbare\\u201d URL), unpkg will serve the file specified by the \",\nc.jsx(\"code\",null,\"unpkg\"),\" field in\",\" \",c.jsx(\"code\",null,\"package.json\"),\", or fall back to \",c.jsx(\"code\",null,\"main\"),\".\"),c.jsx(\"ul\",null,c.jsx(\"li\",null,c.jsx(l,{href:\"/unpkg/jquery\"},\"/unpkg/jquery\")),c.jsx(\"li\",null,c.jsx(l,{href:\"/unpkg/three\"},\"/unpkg/three\"))),c.jsx(\"p\",null,\"Append a \",c.jsx(\"code\",null,\"/\"),\" at the end of a URL to view a listing of all the files in a package.\"),c.jsx(\"ul\",null,c.jsx(\"li\",null,c.jsx(l,{href:\"/unpkg/react/\"},\"/unpkg/react/\")),c.jsx(\"li\",null,c.jsx(l,\n{href:\"/unpkg/react-router/\"},\"/unpkg/react-router/\"))),c.jsx(\"h3\",{css:{fontSize:\"1.6em\"},id:\"query-params\"},\"Query Parameters\"),c.jsx(\"dl\",null,c.jsx(\"dt\",null,c.jsx(\"code\",null,\"?meta\")),c.jsx(\"dd\",null,\"Return metadata about any file in a package as JSON (e.g.\",c.jsx(\"code\",null,\"/any/file?meta\"),\")\"),c.jsx(\"dt\",null,c.jsx(\"code\",null,\"?module\")),c.jsx(\"dd\",null,\"Expands all\",\" \",c.jsx(l,{href:\"https://html.spec.whatwg.org/multipage/webappapis.html#resolve-a-module-specifier\"},\"\\u201cbare\\u201d \",\nc.jsx(\"code\",null,\"import\"),\" specifiers\"),\" \",\"in JavaScript modules to unpkg URLs. This feature is\",\" \",c.jsx(\"em\",null,\"very experimental\"))),c.jsx(\"h3\",{css:{fontSize:\"1.6em\"},id:\"cache-behavior\"},\"Cache Behavior\"),c.jsx(\"p\",null,\"The CDN caches files based on their permanent URL, which includes the npm package version. This works because npm does not allow package authors to overwrite a package that has already been published with a different one at the same version number.\"),c.jsx(\"p\",null,\n\"Browsers are instructed (via the \",c.jsx(\"code\",null,\"Cache-Control\"),\" header) to cache assets indefinitely (1 year).\"),c.jsx(\"p\",null,\"URLs that do not specify a package version number redirect to one that does. This is the \",c.jsx(\"code\",null,\"latest\"),\" version when no version is specified, or the \",c.jsx(\"code\",null,\"maxSatisfying\"),\" version when a\",\" \",c.jsx(l,{href:\"https://github.com/npm/node-semver\"},\"semver version\"),\" \",\"is given. Redirects are cached for 10 minutes at the CDN, 1 minute in browsers.\"),\nc.jsx(\"p\",null,\"If you want users to be able to use the latest version when you cut a new release, the best policy is to put the version number in the URL directly in your installation instructions. This will also load more quickly because we won't have to resolve the latest version and redirect them.\"),c.jsx(\"h3\",{css:{fontSize:\"1.6em\"},id:\"workflow\"},\"Workflow\"),c.jsx(\"p\",null,\"For npm package authors, unpkg relieves the burden of publishing your code to a CDN in addition to the npm registry. All you need to do is include your\",\n\" \",c.jsx(l,{href:\"https://github.com/umdjs/umd\"},\"UMD\"),\" build in your npm package (not your repo, that's different!).\"),c.jsx(\"p\",null,\"You can do this easily using the following setup:\"),c.jsx(\"ul\",null,c.jsx(\"li\",null,\"Add the \",c.jsx(\"code\",null,\"umd\"),\" (or \",c.jsx(\"code\",null,\"dist\"),\") directory to your\",\" \",c.jsx(\"code\",null,\".gitignore\"),\" file\"),c.jsx(\"li\",null,\"Add the \",c.jsx(\"code\",null,\"umd\"),\" directory to your\",\" \",c.jsx(l,{href:\"https://docs.npmjs.com/files/package.json#files\"},\n\"files array\"),\" \",\"in \",c.jsx(\"code\",null,\"package.json\")),c.jsx(\"li\",null,\"Use a build script to generate your UMD build in the\",\" \",c.jsx(\"code\",null,\"umd\"),\" directory when you publish\")),c.jsx(\"p\",null,\"That's it! Now when you \",c.jsx(\"code\",null,\"npm publish\"),\" you'll have a version available on unpkg as well.\"))),c.jsx(\"footer\",{css:{marginTop:\"5rem\",background:\"black\",color:\"#aaa\"}},c.jsx(\"div\",{css:{maxWidth:740,padding:\"10px 20px\",margin:\"0 auto\",display:\"flex\",flexDirection:\"row\",alignItems:\"center\",\njustifyContent:\"space-between\"}},c.jsx(\"p\",null,c.jsx(\"span\",null,\"Build: \",\"6ec4aa4\")),c.jsx(\"p\",null,c.jsx(\"span\",null,\"\\u00a9 \",(new Date).getFullYear(),\" Steedos UNPKG\")),c.jsx(\"p\",{css:{fontSize:\"1.5rem\"}},c.jsx(\"a\",{href:\"https://github.com/steedos/steedos-unpkg\",css:{color:\"#aaa\",display:\"inline-block\",marginLeft:\"1rem\",\":hover\":{color:\"white\"}}},c.jsx(Ha,null))))))}var La=\"default\"in p?p[\"default\"]:p;A=A&&A.hasOwnProperty(\"default\")?A[\"default\"]:A;var G=D(function(a,b){function d(a){if(\"object\"===\ntypeof a&&null!==a){var b=a.$$typeof;switch(b){case c:switch(a=a.type,a){case t:case q:case g:case y:case h:case m:return a;default:switch(a=a&&a.$$typeof,a){case l:case u:case n:return a;default:return b}}case w:case x:case k:return b}}}function e(a){return d(a)===q}Object.defineProperty(b,\"__esModule\",{value:!0});var c=(a=\"function\"===typeof Symbol&&Symbol.for)?Symbol.for(\"react.element\"):60103,k=a?Symbol.for(\"react.portal\"):60106,g=a?Symbol.for(\"react.fragment\"):60107,h=a?Symbol.for(\"react.strict_mode\"):\n60108,y=a?Symbol.for(\"react.profiler\"):60114,n=a?Symbol.for(\"react.provider\"):60109,l=a?Symbol.for(\"react.context\"):60110,t=a?Symbol.for(\"react.async_mode\"):60111,q=a?Symbol.for(\"react.concurrent_mode\"):60111,u=a?Symbol.for(\"react.forward_ref\"):60112,m=a?Symbol.for(\"react.suspense\"):60113,x=a?Symbol.for(\"react.memo\"):60115,w=a?Symbol.for(\"react.lazy\"):60116;b.typeOf=d;b.AsyncMode=t;b.ConcurrentMode=q;b.ContextConsumer=l;b.ContextProvider=n;b.Element=c;b.ForwardRef=u;b.Fragment=g;b.Lazy=w;b.Memo=x;\nb.Portal=k;b.Profiler=y;b.StrictMode=h;b.Suspense=m;b.isValidElementType=function(a){return\"string\"===typeof a||\"function\"===typeof a||a===g||a===q||a===y||a===h||a===m||\"object\"===typeof a&&null!==a&&(a.$$typeof===w||a.$$typeof===x||a.$$typeof===n||a.$$typeof===l||a.$$typeof===u)};b.isAsyncMode=function(a){return e(a)||d(a)===t};b.isConcurrentMode=e;b.isContextConsumer=function(a){return d(a)===l};b.isContextProvider=function(a){return d(a)===n};b.isElement=function(a){return\"object\"===typeof a&&\nnull!==a&&a.$$typeof===c};b.isForwardRef=function(a){return d(a)===u};b.isFragment=function(a){return d(a)===g};b.isLazy=function(a){return d(a)===w};b.isMemo=function(a){return d(a)===x};b.isPortal=function(a){return d(a)===k};b.isProfiler=function(a){return d(a)===y};b.isStrictMode=function(a){return d(a)===h};b.isSuspense=function(a){return d(a)===m}});O(G);var aa=D(function(a,b){(function(){function a(a){if(\"object\"===typeof a&&null!==a){var b=a.$$typeof;switch(b){case k:switch(a=a.type,a){case q:case u:case h:case n:case l:case x:return a;\ndefault:switch(a=a&&a.$$typeof,a){case t:case m:case p:return a;default:return b}}case F:case w:case g:return b}}}function e(b){return a(b)===u}Object.defineProperty(b,\"__esModule\",{value:!0});var c=\"function\"===typeof Symbol&&Symbol.for,k=c?Symbol.for(\"react.element\"):60103,g=c?Symbol.for(\"react.portal\"):60106,h=c?Symbol.for(\"react.fragment\"):60107,l=c?Symbol.for(\"react.strict_mode\"):60108,n=c?Symbol.for(\"react.profiler\"):60114,p=c?Symbol.for(\"react.provider\"):60109,t=c?Symbol.for(\"react.context\"):\n60110,q=c?Symbol.for(\"react.async_mode\"):60111,u=c?Symbol.for(\"react.concurrent_mode\"):60111,m=c?Symbol.for(\"react.forward_ref\"):60112,x=c?Symbol.for(\"react.suspense\"):60113,w=c?Symbol.for(\"react.memo\"):60115,F=c?Symbol.for(\"react.lazy\"):60116;c=function(){};var Ma=function(a){for(var b=arguments.length,d=Array(1<b?b-1:0),c=1;c<b;c++)d[c-1]=arguments[c];var e=0;b=\"Warning: \"+a.replace(/%s/g,function(){return d[e++]});\"undefined\"!==typeof console&&console.warn(b);try{throw Error(b);}catch(bb){}},Na=\nc=function(a,b){if(void 0===b)throw Error(\"`lowPriorityWarning(condition, format, ...args)` requires a warning message argument\");if(!a){for(var d=arguments.length,c=Array(2<d?d-2:0),e=2;e<d;e++)c[e-2]=arguments[e];Ma.apply(void 0,[b].concat(c))}},Z=!1;b.typeOf=a;b.AsyncMode=q;b.ConcurrentMode=u;b.ContextConsumer=t;b.ContextProvider=p;b.Element=k;b.ForwardRef=m;b.Fragment=h;b.Lazy=F;b.Memo=w;b.Portal=g;b.Profiler=n;b.StrictMode=l;b.Suspense=x;b.isValidElementType=function(a){return\"string\"===typeof a||\n\"function\"===typeof a||a===h||a===u||a===n||a===l||a===x||\"object\"===typeof a&&null!==a&&(a.$$typeof===F||a.$$typeof===w||a.$$typeof===p||a.$$typeof===t||a.$$typeof===m)};b.isAsyncMode=function(b){Z||(Z=!0,Na(!1,\"The ReactIs.isAsyncMode() alias has been deprecated, and will be removed in React 17+. Update your code to use ReactIs.isConcurrentMode() instead. It has the exact same API.\"));return e(b)||a(b)===q};b.isConcurrentMode=e;b.isContextConsumer=function(b){return a(b)===t};b.isContextProvider=\nfunction(b){return a(b)===p};b.isElement=function(a){return\"object\"===typeof a&&null!==a&&a.$$typeof===k};b.isForwardRef=function(b){return a(b)===m};b.isFragment=function(b){return a(b)===h};b.isLazy=function(b){return a(b)===F};b.isMemo=function(b){return a(b)===w};b.isPortal=function(b){return a(b)===g};b.isProfiler=function(b){return a(b)===n};b.isStrictMode=function(b){return a(b)===l};b.isSuspense=function(b){return a(b)===x}})()});O(aa);var ba=D(function(a){a.exports=aa}),ca=Object.getOwnPropertySymbols,\nOa=Object.prototype.hasOwnProperty,Pa=Object.prototype.propertyIsEnumerable,Qa=function(){try{if(!Object.assign)return!1;var a=new String(\"abc\");a[5]=\"de\";if(\"5\"===Object.getOwnPropertyNames(a)[0])return!1;var b={};for(a=0;10>a;a++)b[\"_\"+String.fromCharCode(a)]=a;if(\"0123456789\"!==Object.getOwnPropertyNames(b).map(function(a){return b[a]}).join(\"\"))return!1;var d={};\"abcdefghijklmnopqrst\".split(\"\").forEach(function(a){d[a]=a});return\"abcdefghijklmnopqrst\"!==Object.keys(Object.assign({},d)).join(\"\")?\n!1:!0}catch(e){return!1}}()?Object.assign:function(a,b){if(null===a||void 0===a)throw new TypeError(\"Object.assign cannot be called with null or undefined\");var d=Object(a);for(var c,f=1;f<arguments.length;f++){var k=Object(arguments[f]);for(var g in k)Oa.call(k,g)&&(d[g]=k[g]);if(ca){c=ca(k);for(var h=0;h<c.length;h++)Pa.call(k,c[h])&&(d[c[h]]=k[c[h]])}}return d},J=function(){},K={},la=Function.call.bind(Object.prototype.hasOwnProperty);J=function(a){a=\"Warning: \"+a;\"undefined\"!==typeof console&&\nconsole.error(a);try{throw Error(a);}catch(b){}};I.resetWarningCache=function(){K={}};var Ra=Function.call.bind(Object.prototype.hasOwnProperty),B=function(){};B=function(a){a=\"Warning: \"+a;\"undefined\"!==typeof console&&console.error(a);try{throw Error(a);}catch(b){}};var Sa=function(a,b){function d(a,b){return a===b?0!==a||1/a===1/b:a!==a&&b!==b}function c(a){this.message=a;this.stack=\"\"}function f(a){function d(d,u,m,f,h,g,k){f=f||\"<<anonymous>>\";g=g||m;if(\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"!==\nk){if(b)throw d=Error(\"Calling PropTypes validators directly is not supported by the `prop-types` package. Use `PropTypes.checkPropTypes()` to call them. Read more at http://fb.me/use-check-prop-types\"),d.name=\"Invariant Violation\",d;\"undefined\"!==typeof console&&(k=f+\":\"+m,!e[k]&&3>q&&(B(\"You are manually calling a React.PropTypes validation function for the `\"+g+\"` prop on `\"+f+\"`. This is deprecated and will throw in the standalone `prop-types` package. You may be seeing this warning due to a third-party PropTypes library. See https://fb.me/react-warning-dont-call-proptypes for details.\"),\ne[k]=!0,q++))}return null==u[m]?d?null===u[m]?new c(\"The \"+h+\" `\"+g+\"` is marked as required \"+(\"in `\"+f+\"`, but its value is `null`.\")):new c(\"The \"+h+\" `\"+g+\"` is marked as required in \"+(\"`\"+f+\"`, but its value is `undefined`.\")):null:a(u,m,f,h,g)}var e={},q=0,f=d.bind(null,!1);f.isRequired=d.bind(null,!0);return f}function k(a){return f(function(b,d,e,q,f,g){b=b[d];return h(b)!==a?(b=l(b),new c(\"Invalid \"+q+\" `\"+f+\"` of type \"+(\"`\"+b+\"` supplied to `\"+e+\"`, expected \")+(\"`\"+a+\"`.\"))):null})}function g(b){switch(typeof b){case \"number\":case \"string\":case \"undefined\":return!0;\ncase \"boolean\":return!b;case \"object\":if(Array.isArray(b))return b.every(g);if(null===b||a(b))return!0;var d=b&&(p&&b[p]||b[\"@@iterator\"]);var c=\"function\"===typeof d?d:void 0;if(c)if(d=c.call(b),c!==b.entries)for(;!(b=d.next()).done;){if(!g(b.value))return!1}else for(;!(b=d.next()).done;){if((b=b.value)&&!g(b[1]))return!1}else return!1;return!0;default:return!1}}function h(a){var b=typeof a;return Array.isArray(a)?\"array\":a instanceof RegExp?\"object\":\"symbol\"===b||a&&(\"Symbol\"===a[\"@@toStringTag\"]||\n\"function\"===typeof Symbol&&a instanceof Symbol)?\"symbol\":b}function l(a){if(\"undefined\"===typeof a||null===a)return\"\"+a;var b=h(a);if(\"object\"===b){if(a instanceof Date)return\"date\";if(a instanceof RegExp)return\"regexp\"}return b}function n(a){a=l(a);switch(a){case \"array\":case \"object\":return\"an \"+a;case \"boolean\":case \"date\":case \"regexp\":return\"a \"+a;default:return a}}var p=\"function\"===typeof Symbol&&Symbol.iterator,t={array:k(\"array\"),bool:k(\"boolean\"),func:k(\"function\"),number:k(\"number\"),object:k(\"object\"),\nstring:k(\"string\"),symbol:k(\"symbol\"),any:f(E),arrayOf:function(a){return f(function(b,d,e,f,q){if(\"function\"!==typeof a)return new c(\"Property `\"+q+\"` of component `\"+e+\"` has invalid PropType notation inside arrayOf.\");b=b[d];if(!Array.isArray(b))return b=h(b),new c(\"Invalid \"+f+\" `\"+q+\"` of type \"+(\"`\"+b+\"` supplied to `\"+e+\"`, expected an array.\"));for(d=0;d<b.length;d++){var m=a(b,d,e,f,q+\"[\"+d+\"]\",\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\");if(m instanceof Error)return m}return null})},\nelement:function(){return f(function(b,d,e,f,g){b=b[d];return a(b)?null:(b=h(b),new c(\"Invalid \"+f+\" `\"+g+\"` of type \"+(\"`\"+b+\"` supplied to `\"+e+\"`, expected a single ReactElement.\")))})}(),elementType:function(){return f(function(a,b,d,e,f){a=a[b];return ba.isValidElementType(a)?null:(a=h(a),new c(\"Invalid \"+e+\" `\"+f+\"` of type \"+(\"`\"+a+\"` supplied to `\"+d+\"`, expected a single ReactElement type.\")))})}(),instanceOf:function(a){return f(function(b,d,e,f,g){if(!(b[d]instanceof a)){var m=a.name||\n\"<<anonymous>>\";b=b[d];b=b.constructor&&b.constructor.name?b.constructor.name:\"<<anonymous>>\";return new c(\"Invalid \"+f+\" `\"+g+\"` of type \"+(\"`\"+b+\"` supplied to `\"+e+\"`, expected \")+(\"instance of `\"+m+\"`.\"))}return null})},node:function(){return f(function(a,b,d,e,f){return g(a[b])?null:new c(\"Invalid \"+e+\" `\"+f+\"` supplied to \"+(\"`\"+d+\"`, expected a ReactNode.\"))})}(),objectOf:function(a){return f(function(b,d,e,f,g){if(\"function\"!==typeof a)return new c(\"Property `\"+g+\"` of component `\"+e+\"` has invalid PropType notation inside objectOf.\");\nb=b[d];d=h(b);if(\"object\"!==d)return new c(\"Invalid \"+f+\" `\"+g+\"` of type \"+(\"`\"+d+\"` supplied to `\"+e+\"`, expected an object.\"));for(var m in b)if(Ra(b,m)&&(d=a(b,m,e,f,g+\".\"+m,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"),d instanceof Error))return d;return null})},oneOf:function(a){return Array.isArray(a)?f(function(b,e,f,g,h){b=b[e];for(e=0;e<a.length;e++)if(d(b,a[e]))return null;e=JSON.stringify(a,function(a,b){return\"symbol\"===l(b)?String(b):b});return new c(\"Invalid \"+g+\" `\"+h+\"` of value `\"+\nString(b)+\"` \"+(\"supplied to `\"+f+\"`, expected one of \"+e+\".\"))}):(1<arguments.length?B(\"Invalid arguments supplied to oneOf, expected an array, got \"+arguments.length+\" arguments. A common mistake is to write oneOf(x, y, z) instead of oneOf([x, y, z]).\"):B(\"Invalid argument supplied to oneOf, expected an array.\"),E)},oneOfType:function(a){if(!Array.isArray(a))return B(\"Invalid argument supplied to oneOfType, expected an instance of array.\"),E;for(var b=0;b<a.length;b++){var d=a[b];if(\"function\"!==\ntypeof d)return B(\"Invalid argument supplied to oneOfType. Expected an array of check functions, but received \"+n(d)+\" at index \"+b+\".\"),E}return f(function(b,d,e,f,g){for(var h=0;h<a.length;h++)if(null==(0,a[h])(b,d,e,f,g,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"))return null;return new c(\"Invalid \"+f+\" `\"+g+\"` supplied to \"+(\"`\"+e+\"`.\"))})},shape:function(a){return f(function(b,d,e,f,g){b=b[d];d=h(b);if(\"object\"!==d)return new c(\"Invalid \"+f+\" `\"+g+\"` of type `\"+d+\"` \"+(\"supplied to `\"+e+\"`, expected `object`.\"));\nfor(var k in a)if(d=a[k])if(d=d(b,k,e,f,g+\".\"+k,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"))return d;return null})},exact:function(a){return f(function(b,d,e,f,g){var k=b[d],n=h(k);if(\"object\"!==n)return new c(\"Invalid \"+f+\" `\"+g+\"` of type `\"+n+\"` \"+(\"supplied to `\"+e+\"`, expected `object`.\"));n=Qa({},b[d],a);for(var l in n){n=a[l];if(!n)return new c(\"Invalid \"+f+\" `\"+g+\"` key `\"+l+\"` supplied to `\"+e+\"`.\\nBad object: \"+JSON.stringify(b[d],null,\"  \")+\"\\nValid keys: \"+JSON.stringify(Object.keys(a),\nnull,\"  \"));if(n=n(k,l,e,f,g+\".\"+l,\"SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED\"))return n}return null})}};c.prototype=Error.prototype;t.checkPropTypes=I;t.resetWarningCache=I.resetWarningCache;return t.PropTypes=t};G=D(function(a){a.exports=Sa(ba.isElement,!0)});let da=\"B kB MB GB TB PB EB ZB YB\".split(\" \"),ea=(a,b)=>{let d=a;\"string\"===typeof b?d=a.toLocaleString(b):!0===b&&(d=a.toLocaleString());return d};var Ja=(a,b)=>{if(!Number.isFinite(a))throw new TypeError(`Expected a finite number, got ${typeof a}: ${a}`);\nb=Object.assign({},b);if(b.signed&&0===a)return\" 0 B\";var d=0>a;let c=d?\"-\":b.signed?\"+\":\"\";d&&(a=-a);if(1>a)return a=ea(a,b.locale),c+a+\" B\";d=Math.min(Math.floor(Math.log10(a)/3),da.length-1);a=Number((a/Math.pow(1E3,d)).toPrecision(3));a=ea(a,b.locale);return c+a+\" \"+da[d]},M=function(a){var b=new Date(a.getTime());a=b.getTimezoneOffset();b.setSeconds(0,0);b=b.getTime()%6E4;return 6E4*a+b},Ta=/[T ]/,Ua=/:/,Va=/^(\\d{2})$/,Wa=[/^([+-]\\d{2})$/,/^([+-]\\d{3})$/,/^([+-]\\d{4})$/],Xa=/^(\\d{4})/,Ya=[/^([+-]\\d{4})/,\n/^([+-]\\d{5})/,/^([+-]\\d{6})/],na=/^-(\\d{2})$/,oa=/^-?(\\d{3})$/,pa=/^-?(\\d{2})-?(\\d{2})$/,qa=/^-?W(\\d{2})$/,ra=/^-?W(\\d{2})-?(\\d{1})$/,ta=/^(\\d{2}([.,]\\d*)?)$/,ua=/^(\\d{2}):?(\\d{2}([.,]\\d*)?)$/,va=/^(\\d{2}):?(\\d{2}):?(\\d{2}([.,]\\d*)?)$/,Za=/([Z+-].*)$/,xa=/^(Z)$/,ya=/^([+-])(\\d{2})$/,za=/^([+-])(\\d{2}):?(\\d{2})$/,v=function(a,b){if(a instanceof Date)return new Date(a.getTime());if(\"string\"!==typeof a)return new Date(a);var d=(b||{}).additionalDigits;d=null==d?2:Number(d);var c=a.split(Ta);Ua.test(c[0])?\n(b=null,c=c[0]):(b=c[0],c=c[1]);if(c){var f=Za.exec(c);if(f){var k=c.replace(f[1],\"\");var g=f[1]}else k=c}c=Wa[d];d=Ya[d];(d=Xa.exec(b)||d.exec(b))?(c=d[1],d=parseInt(c,10),b=b.slice(c.length)):(d=Va.exec(b)||c.exec(b))?(c=d[1],d=100*parseInt(c,10),b=b.slice(c.length)):(d=null,b=void 0);return(b=ma(b,d))?(a=b.getTime(),b=0,k&&(b=sa(k)),g?k=6E4*wa(g):(d=a+b,g=new Date(d),k=M(g),d=new Date(d),d.setDate(g.getDate()+1),g=M(d)-M(g),0<g&&(k+=g)),new Date(a+b+k)):new Date(a)},fa=function(a){a=v(a);a.setHours(0,\n0,0,0);return a},ha=function(a){var b=v(a),d=v(b);a=new Date(0);a.setFullYear(d.getFullYear(),0,1);a.setHours(0,0,0,0);b=fa(b);a=fa(a);b=b.getTime()-6E4*b.getTimezoneOffset();a=a.getTime()-6E4*a.getTimezoneOffset();return Math.round((b-a)/864E5)+1},H=function(a){var b={weekStartsOn:1};b=b?Number(b.weekStartsOn)||0:0;a=v(a);var d=a.getDay();b=(d<b?7:0)+d-b;a.setDate(a.getDate()-b);a.setHours(0,0,0,0);return a},N=function(a){a=v(a);var b=a.getFullYear(),d=new Date(0);d.setFullYear(b+1,0,4);d.setHours(0,\n0,0,0);d=H(d);var c=new Date(0);c.setFullYear(b,0,4);c.setHours(0,0,0,0);c=H(c);return a.getTime()>=d.getTime()?b+1:a.getTime()>=c.getTime()?b:b-1},ia=function(a){var b=v(a);a=H(b).getTime();b=N(b);var d=new Date(0);d.setFullYear(b,0,4);d.setHours(0,0,0,0);b=H(d);a-=b.getTime();return Math.round(a/6048E5)+1},$a=\"M MM Q D DD DDD DDDD d E W WW YY YYYY GG GGGG H HH h hh m mm s ss S SS SSS Z ZZ X x\".split(\" \"),ab=function(a){var b=[],d;for(d in a)a.hasOwnProperty(d)&&b.push(d);a=$a.concat(b).sort().reverse();\nreturn new RegExp(\"(\\\\[[^\\\\[]*\\\\])|(\\\\\\\\)?(\"+a.join(\"|\")+\"|.)\",\"g\")};(function(){var a={lessThanXSeconds:{one:\"less than a second\",other:\"less than {{count}} seconds\"},xSeconds:{one:\"1 second\",other:\"{{count}} seconds\"},halfAMinute:\"half a minute\",lessThanXMinutes:{one:\"less than a minute\",other:\"less than {{count}} minutes\"},xMinutes:{one:\"1 minute\",other:\"{{count}} minutes\"},aboutXHours:{one:\"about 1 hour\",other:\"about {{count}} hours\"},xHours:{one:\"1 hour\",other:\"{{count}} hours\"},xDays:{one:\"1 day\",\nother:\"{{count}} days\"},aboutXMonths:{one:\"about 1 month\",other:\"about {{count}} months\"},xMonths:{one:\"1 month\",other:\"{{count}} months\"},aboutXYears:{one:\"about 1 year\",other:\"about {{count}} years\"},xYears:{one:\"1 year\",other:\"{{count}} years\"},overXYears:{one:\"over 1 year\",other:\"over {{count}} years\"},almostXYears:{one:\"almost 1 year\",other:\"almost {{count}} years\"}};return{localize:function(b,d,c){c=c||{};b=\"string\"===typeof a[b]?a[b]:1===d?a[b].one:a[b].other.replace(\"{{count}}\",d);return c.addSuffix?\n0<c.comparison?\"in \"+b:b+\" ago\":b}}})();var ja=function(){var a=\"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec\".split(\" \"),b=\"January February March April May June July August September October November December\".split(\" \"),d=\"Su Mo Tu We Th Fr Sa\".split(\" \"),c=\"Sun Mon Tue Wed Thu Fri Sat\".split(\" \"),f=\"Sunday Monday Tuesday Wednesday Thursday Friday Saturday\".split(\" \"),k=[\"AM\",\"PM\"],g=[\"am\",\"pm\"],h=[\"a.m.\",\"p.m.\"],l={MMM:function(b){return a[b.getMonth()]},MMMM:function(a){return b[a.getMonth()]},\ndd:function(a){return d[a.getDay()]},ddd:function(a){return c[a.getDay()]},dddd:function(a){return f[a.getDay()]},A:function(a){return 1<=a.getHours()/12?k[1]:k[0]},a:function(a){return 1<=a.getHours()/12?g[1]:g[0]},aa:function(a){return 1<=a.getHours()/12?h[1]:h[0]}};\"M D DDD d Q W\".split(\" \").forEach(function(a){l[a+\"o\"]=function(b,d){return Aa(d[a](b))}});return{formatters:l,formattingTokensRegExp:ab(l)}}(),L={M:function(a){return a.getMonth()+1},MM:function(a){return r(a.getMonth()+1,2)},Q:function(a){return Math.ceil((a.getMonth()+\n1)/3)},D:function(a){return a.getDate()},DD:function(a){return r(a.getDate(),2)},DDD:function(a){return ha(a)},DDDD:function(a){return r(ha(a),3)},d:function(a){return a.getDay()},E:function(a){return a.getDay()||7},W:function(a){return ia(a)},WW:function(a){return r(ia(a),2)},YY:function(a){return r(a.getFullYear(),4).substr(2)},YYYY:function(a){return r(a.getFullYear(),4)},GG:function(a){return String(N(a)).substr(2)},GGGG:function(a){return N(a)},H:function(a){return a.getHours()},HH:function(a){return r(a.getHours(),\n2)},h:function(a){a=a.getHours();return 0===a?12:12<a?a%12:a},hh:function(a){return r(L.h(a),2)},m:function(a){return a.getMinutes()},mm:function(a){return r(a.getMinutes(),2)},s:function(a){return a.getSeconds()},ss:function(a){return r(a.getSeconds(),2)},S:function(a){return Math.floor(a.getMilliseconds()/100)},SS:function(a){return r(Math.floor(a.getMilliseconds()/10),2)},SSS:function(a){return r(a.getMilliseconds(),3)},Z:function(a){return Q(a.getTimezoneOffset(),\":\")},ZZ:function(a){return Q(a.getTimezoneOffset())},\nX:function(a){return Math.floor(a.getTime()/1E3)},x:function(a){return a.getTime()}},X=function(a,b,d){b=b?String(b):\"YYYY-MM-DDTHH:mm:ss.SSSZ\";var c=(d||{}).locale;d=ja.formatters;var f=ja.formattingTokensRegExp;c&&c.format&&c.format.formatters&&(d=c.format.formatters,c.format.formattingTokensRegExp&&(f=c.format.formattingTokensRegExp));a=v(a);if(a instanceof Date)c=!isNaN(a);else throw new TypeError(toString.call(a)+\" is not an instance of Date\");return c?Ba(b,d,f)(a):\"Invalid Date\"},U={color:void 0,\nsize:void 0,className:void 0,style:void 0,attr:void 0},T=p.createContext&&p.createContext(U),z=window&&window.__assign||function(){z=Object.assign||function(a){for(var b,d=1,c=arguments.length;d<c;d++){b=arguments[d];for(var f in b)Object.prototype.hasOwnProperty.call(b,f)&&(a[f]=b[f])}return a};return z.apply(this,arguments)},Ga=window&&window.__rest||function(a,b){var d={},c;for(c in a)Object.prototype.hasOwnProperty.call(a,c)&&0>b.indexOf(c)&&(d[c]=a[c]);if(null!=a&&\"function\"===typeof Object.getOwnPropertySymbols){var f=\n0;for(c=Object.getOwnPropertySymbols(a);f<c.length;f++)0>b.indexOf(c[f])&&(d[c[f]]=a[c[f]])}return d},V=function(a){return Ea({tag:\"svg\",attr:{viewBox:\"0 0 496 512\"},child:[{tag:\"path\",attr:{d:\"M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z\"}}]})(a)};\nV.displayName=\"FaGithub\";var Ka=c.css(W(),'\\nfont-family: -apple-system,\\n  BlinkMacSystemFont,\\n  \"Segoe UI\",\\n  \"Roboto\",\\n  \"Oxygen\",\\n  \"Ubuntu\",\\n  \"Cantarell\",\\n  \"Fira Sans\",\\n  \"Droid Sans\",\\n  \"Helvetica Neue\",\\n  sans-serif;\\n',\"\\nfont-family: Menlo,\\n  Monaco,\\n  Lucida Console,\\n  Liberation Mono,\\n  DejaVu Sans Mono,\\n  Bitstream Vera Sans Mono,\\n  Courier New,\\n  monospace;\\n\");Y.propTypes={location:G.object,children:G.node};A.render(La.createElement(Y,null),document.getElementById(\"root\"))})(React,\nReactDOM,emotionCore);\n"}]}];

// Virtual module id; see rollup.config.js

function getEntryPoint(name, format) {
  for (let manifest of entryManifest) {
    let bundles = manifest[name];

    if (bundles) {
      return bundles.find(b => b.format === format);
    }
  }

  return null;
}

function getGlobalScripts(entryPoint, globalURLs) {
  return entryPoint.globalImports.map(id => {
    if (process.env.NODE_ENV !== 'production') {
      if (!globalURLs[id]) {
        throw new Error('Missing global URL for id "%s"', id);
      }
    }

    return React.createElement('script', {
      src: getBaseUrl() + globalURLs[id]
    });
  });
}

function getScripts(entryName, format, globalURLs) {
  const entryPoint = getEntryPoint(entryName, format);
  if (!entryPoint) return [];
  return getGlobalScripts(entryPoint, globalURLs).concat( // Inline the code for this entry point into the page
  // itself instead of using another <script> tag
  createScript(entryPoint.code));
}

const doctype = '<!DOCTYPE html>';
const globalURLs = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging' ? {
  '@emotion/core': '/@emotion/core@10.0.6/dist/core.umd.min.js',
  react: '/react@16.8.6/umd/react.production.min.js',
  'react-dom': '/react-dom@16.8.6/umd/react-dom.production.min.js'
} : {
  '@emotion/core': '/@emotion/core@10.0.6/dist/core.umd.min.js',
  react: '/react@16.8.6/umd/react.development.js',
  'react-dom': '/react-dom@16.8.6/umd/react-dom.development.js'
};

function byVersion(a, b) {
  return semver.lt(a, b) ? -1 : semver.gt(a, b) ? 1 : 0;
}

async function getAvailableVersions(packageName, log) {
  const versionsAndTags = await getVersionsAndTags(packageName, log);
  return versionsAndTags ? versionsAndTags.versions.sort(byVersion) : [];
}

async function serveBrowsePage(req, res) {
  const availableVersions = await getAvailableVersions(req.packageName, req.log);
  const data = {
    baseUrl: getBaseUrl(),
    packageName: req.packageName,
    packageVersion: req.packageVersion,
    availableVersions: availableVersions,
    filename: req.filename,
    target: req.browseTarget
  };
  const content = createHTML$1(server.renderToString(React.createElement(App, data)));
  const elements = getScripts('browse', 'iife', globalURLs);
  const html = doctype + server.renderToStaticMarkup(React.createElement(MainTemplate, {
    title: `UNPKG - ${req.packageName}`,
    description: `The CDN for ${req.packageName}`,
    data,
    content,
    elements
  }));
  res.set({
    'Cache-Control': 'public, max-age=14400',
    // 4 hours
    'Cache-Tag': 'browse'
  }).send(html);
}

var serveBrowsePage$1 = asyncHandler(serveBrowsePage);

async function findMatchingEntries(stream, filename) {
  // filename = /some/dir/name
  return new Promise((accept, reject) => {
    const entries = {};
    stream.pipe(tar.extract()).on('error', reject).on('entry', async (header, stream, next) => {
      const entry = {
        // Most packages have header names that look like `package/index.js`
        // so we shorten that to just `/index.js` here. A few packages use a
        // prefix other than `package/`. e.g. the firebase package uses the
        // `firebase_npm/` prefix. So we just strip the first dir name.
        path: header.name.replace(/^[^/]+\/?/, '/'),
        type: header.type
      }; // Dynamically create "directory" entries for all subdirectories
      // in this entry's path. Some tarballs omit directory entries for
      // some reason, so this is the "brute force" method.

      let dir = path.dirname(entry.path);

      while (dir !== '/') {
        if (!entries[dir] && path.dirname(dir) === filename) {
          entries[dir] = {
            path: dir,
            type: 'directory'
          };
        }

        dir = path.dirname(dir);
      } // Ignore non-files and files that aren't in this directory.


      if (entry.type !== 'file' || path.dirname(entry.path) !== filename) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      try {
        const content = await bufferStream(stream);
        entry.contentType = getContentType(entry.path);
        entry.integrity = getIntegrity(content);
        entry.size = content.length;
        entries[entry.path] = entry;
        next();
      } catch (error) {
        next(error);
      }
    }).on('finish', () => {
      accept(entries);
    });
  });
}

async function serveDirectoryBrowser(req, res) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.log);
  const filename = req.filename.slice(0, -1) || '/';
  const entries = await findMatchingEntries(stream, filename);

  if (Object.keys(entries).length === 0) {
    return res.status(404).send(`Not found: ${req.packageSpec}${req.filename}`);
  }

  req.browseTarget = {
    path: filename,
    type: 'directory',
    details: entries
  };
  serveBrowsePage$1(req, res);
}

var serveDirectoryBrowser$1 = asyncHandler(serveDirectoryBrowser);

async function findMatchingEntries$1(stream, filename) {
  // filename = /some/dir/name
  return new Promise((accept, reject) => {
    const entries = {};
    entries[filename] = {
      path: filename,
      type: 'directory'
    };
    stream.pipe(tar.extract()).on('error', reject).on('entry', async (header, stream, next) => {
      const entry = {
        // Most packages have header names that look like `package/index.js`
        // so we shorten that to just `/index.js` here. A few packages use a
        // prefix other than `package/`. e.g. the firebase package uses the
        // `firebase_npm/` prefix. So we just strip the first dir name.
        path: header.name.replace(/^[^/]+\/?/, '/'),
        type: header.type
      }; // Dynamically create "directory" entries for all subdirectories
      // in this entry's path. Some tarballs omit directory entries for
      // some reason, so this is the "brute force" method.

      let dir = path.dirname(entry.path);

      while (dir !== '/') {
        if (!entries[dir] && dir.startsWith(filename)) {
          entries[dir] = {
            path: dir,
            type: 'directory'
          };
        }

        dir = path.dirname(dir);
      } // Ignore non-files and files that don't match the prefix.


      if (entry.type !== 'file' || !entry.path.startsWith(filename)) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      try {
        const content = await bufferStream(stream);
        entry.contentType = getContentType(entry.path);
        entry.integrity = getIntegrity(content);
        entry.lastModified = header.mtime.toUTCString();
        entry.size = content.length;
        entries[entry.path] = entry;
        next();
      } catch (error) {
        next(error);
      }
    }).on('finish', () => {
      accept(entries);
    });
  });
}

function getMatchingEntries(entry, entries) {
  return Object.keys(entries).filter(key => entry.path !== key && path.dirname(key) === entry.path).map(key => entries[key]);
}

function getMetadata(entry, entries) {
  const metadata = {
    path: entry.path,
    type: entry.type
  };

  if (entry.type === 'file') {
    metadata.contentType = entry.contentType;
    metadata.integrity = entry.integrity;
    metadata.lastModified = entry.lastModified;
    metadata.size = entry.size;
  } else if (entry.type === 'directory') {
    metadata.files = getMatchingEntries(entry, entries).map(e => getMetadata(e, entries));
  }

  return metadata;
}

async function serveDirectoryMetadata(req, res) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.log);
  const filename = req.filename.slice(0, -1) || '/';
  const entries = await findMatchingEntries$1(stream, filename);
  const metadata = getMetadata(entries[filename], entries);
  res.send(metadata);
}

var serveDirectoryMetadata$1 = asyncHandler(serveDirectoryMetadata);

function createDataURI(contentType, content) {
  return `data:${contentType};base64,${content.toString('base64')}`;
}

function escapeHTML(code) {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
} // These should probably be added to highlight.js auto-detection.


const extLanguages = {
  map: 'json',
  mjs: 'javascript',
  tsbuildinfo: 'json',
  tsx: 'typescript',
  txt: 'text',
  vue: 'html'
};

function getLanguage(file) {
  // Try to guess the language based on the file extension.
  const ext = path.extname(file).substr(1);

  if (ext) {
    return extLanguages[ext] || ext;
  }

  const contentType = getContentType(file);

  if (contentType === 'text/plain') {
    return 'text';
  }

  return null;
}

function getLines(code) {
  return code.split('\n').map((line, index, array) => index === array.length - 1 ? line : line + '\n');
}
/**
 * Returns an array of HTML strings that highlight the given source code.
 */


function getHighlights(code, file) {
  const language = getLanguage(file);

  if (!language) {
    return null;
  }

  if (language === 'text') {
    return getLines(code).map(escapeHTML);
  }

  try {
    let continuation = false;
    const hi = getLines(code).map(line => {
      const result = hljs.highlight(language, line, false, continuation);
      continuation = result.top;
      return result;
    });
    return hi.map(result => result.value.replace(/<span class="hljs-(\w+)">/g, '<span class="code-$1">'));
  } catch (error) {
    // Probably an "unknown language" error.
    // console.error(error);
    return null;
  }
}

const contentTypeNames = {
  'application/javascript': 'JavaScript',
  'application/json': 'JSON',
  'application/octet-stream': 'Binary',
  'application/vnd.ms-fontobject': 'Embedded OpenType',
  'application/xml': 'XML',
  'image/svg+xml': 'SVG',
  'font/ttf': 'TrueType Font',
  'font/woff': 'WOFF',
  'font/woff2': 'WOFF2',
  'text/css': 'CSS',
  'text/html': 'HTML',
  'text/jsx': 'JSX',
  'text/markdown': 'Markdown',
  'text/plain': 'Plain Text',
  'text/x-scss': 'SCSS',
  'text/yaml': 'YAML'
};
/**
 * Gets a human-friendly name for whatever is in the given file.
 */

function getLanguageName(file) {
  // Content-Type is text/plain, but we can be more descriptive.
  if (/\.flow$/.test(file)) return 'Flow';
  if (/\.(d\.ts|tsx)$/.test(file)) return 'TypeScript'; // Content-Type is application/json, but we can be more descriptive.

  if (/\.map$/.test(file)) return 'Source Map (JSON)';
  const contentType = getContentType(file);
  return contentTypeNames[contentType] || contentType;
}

async function findEntry(stream, filename) {
  // filename = /some/file/name.js
  return new Promise((accept, reject) => {
    let foundEntry = null;
    stream.pipe(tar.extract()).on('error', reject).on('entry', async (header, stream, next) => {
      const entry = {
        // Most packages have header names that look like `package/index.js`
        // so we shorten that to just `/index.js` here. A few packages use a
        // prefix other than `package/`. e.g. the firebase package uses the
        // `firebase_npm/` prefix. So we just strip the first dir name.
        path: header.name.replace(/^[^/]+\/?/, '/'),
        type: header.type
      }; // Ignore non-files and files that don't match the name.

      if (entry.type !== 'file' || entry.path !== filename) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      try {
        entry.content = await bufferStream(stream);
        foundEntry = entry;
        next();
      } catch (error) {
        next(error);
      }
    }).on('finish', () => {
      accept(foundEntry);
    });
  });
}

async function serveFileBrowser(req, res) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.log);
  const entry = await findEntry(stream, req.filename);

  if (!entry) {
    return res.status(404).send(`Not found: ${req.packageSpec}${req.filename}`);
  }

  const details = {
    contentType: getContentType(entry.path),
    integrity: getIntegrity(entry.content),
    language: getLanguageName(entry.path),
    size: entry.content.length
  };

  if (/^image\//.test(details.contentType)) {
    details.uri = createDataURI(details.contentType, entry.content);
    details.highlights = null;
  } else {
    details.uri = null;
    details.highlights = getHighlights(entry.content.toString('utf8'), entry.path);
  }

  req.browseTarget = {
    path: req.filename,
    type: 'file',
    details
  };
  serveBrowsePage$1(req, res);
}

var serveFileBrowser$1 = asyncHandler(serveFileBrowser);

async function findEntry$1(stream, filename) {
  // filename = /some/file/name.js
  return new Promise((accept, reject) => {
    let foundEntry = null;
    stream.pipe(tar.extract()).on('error', reject).on('entry', async (header, stream, next) => {
      const entry = {
        // Most packages have header names that look like `package/index.js`
        // so we shorten that to just `/index.js` here. A few packages use a
        // prefix other than `package/`. e.g. the firebase package uses the
        // `firebase_npm/` prefix. So we just strip the first dir name.
        path: header.name.replace(/^[^/]+\/?/, '/'),
        type: header.type
      }; // Ignore non-files and files that don't match the name.

      if (entry.type !== 'file' || entry.path !== filename) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      try {
        const content = await bufferStream(stream);
        entry.contentType = getContentType(entry.path);
        entry.integrity = getIntegrity(content);
        entry.lastModified = header.mtime.toUTCString();
        entry.size = content.length;
        foundEntry = entry;
        next();
      } catch (error) {
        next(error);
      }
    }).on('finish', () => {
      accept(foundEntry);
    });
  });
}

async function serveFileMetadata(req, res) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.log);
  const entry = await findEntry$1(stream, req.filename);

  res.send(entry);
}

var serveFileMetadata$1 = asyncHandler(serveFileMetadata);

function getContentTypeHeader(type) {
  return type === 'application/javascript' ? type + '; charset=utf-8' : type;
}

function serveFile(req, res) {
  const tags = ['file'];
  const ext = path.extname(req.entry.path).substr(1);

  if (ext) {
    tags.push(`${ext}-file`);
  }

  res.set({
    'Content-Type': getContentTypeHeader(req.entry.contentType),
    'Content-Length': req.entry.size,
    'Cache-Control': 'public, max-age=31536000',
    // 1 year
    'Last-Modified': req.entry.lastModified,
    ETag: etag(req.entry.content),
    'Cache-Tag': tags.join(', ')
  }).send(req.entry.content);
}

var MILLISECONDS_IN_MINUTE = 60000;

/**
 * Google Chrome as of 67.0.3396.87 introduced timezones with offset that includes seconds.
 * They usually appear for dates that denote time before the timezones were introduced
 * (e.g. for 'Europe/Prague' timezone the offset is GMT+00:57:44 before 1 October 1891
 * and GMT+01:00:00 after that date)
 *
 * Date#getTimezoneOffset returns the offset in minutes and would return 57 for the example above,
 * which would lead to incorrect calculations.
 *
 * This function returns the timezone offset in milliseconds that takes seconds in account.
 */
var getTimezoneOffsetInMilliseconds = function getTimezoneOffsetInMilliseconds (dirtyDate) {
  var date = new Date(dirtyDate.getTime());
  var baseTimezoneOffset = date.getTimezoneOffset();
  date.setSeconds(0, 0);
  var millisecondsPartOfTimezoneOffset = date.getTime() % MILLISECONDS_IN_MINUTE;

  return baseTimezoneOffset * MILLISECONDS_IN_MINUTE + millisecondsPartOfTimezoneOffset
};

/**
 * @category Common Helpers
 * @summary Is the given argument an instance of Date?
 *
 * @description
 * Is the given argument an instance of Date?
 *
 * @param {*} argument - the argument to check
 * @returns {Boolean} the given argument is an instance of Date
 *
 * @example
 * // Is 'mayonnaise' a Date?
 * var result = isDate('mayonnaise')
 * //=> false
 */
function isDate (argument) {
  return argument instanceof Date
}

var is_date = isDate;

var MILLISECONDS_IN_HOUR = 3600000;
var MILLISECONDS_IN_MINUTE$1 = 60000;
var DEFAULT_ADDITIONAL_DIGITS = 2;

var parseTokenDateTimeDelimeter = /[T ]/;
var parseTokenPlainTime = /:/;

// year tokens
var parseTokenYY = /^(\d{2})$/;
var parseTokensYYY = [
  /^([+-]\d{2})$/, // 0 additional digits
  /^([+-]\d{3})$/, // 1 additional digit
  /^([+-]\d{4})$/ // 2 additional digits
];

var parseTokenYYYY = /^(\d{4})/;
var parseTokensYYYYY = [
  /^([+-]\d{4})/, // 0 additional digits
  /^([+-]\d{5})/, // 1 additional digit
  /^([+-]\d{6})/ // 2 additional digits
];

// date tokens
var parseTokenMM = /^-(\d{2})$/;
var parseTokenDDD = /^-?(\d{3})$/;
var parseTokenMMDD = /^-?(\d{2})-?(\d{2})$/;
var parseTokenWww = /^-?W(\d{2})$/;
var parseTokenWwwD = /^-?W(\d{2})-?(\d{1})$/;

// time tokens
var parseTokenHH = /^(\d{2}([.,]\d*)?)$/;
var parseTokenHHMM = /^(\d{2}):?(\d{2}([.,]\d*)?)$/;
var parseTokenHHMMSS = /^(\d{2}):?(\d{2}):?(\d{2}([.,]\d*)?)$/;

// timezone tokens
var parseTokenTimezone = /([Z+-].*)$/;
var parseTokenTimezoneZ = /^(Z)$/;
var parseTokenTimezoneHH = /^([+-])(\d{2})$/;
var parseTokenTimezoneHHMM = /^([+-])(\d{2}):?(\d{2})$/;

/**
 * @category Common Helpers
 * @summary Convert the given argument to an instance of Date.
 *
 * @description
 * Convert the given argument to an instance of Date.
 *
 * If the argument is an instance of Date, the function returns its clone.
 *
 * If the argument is a number, it is treated as a timestamp.
 *
 * If an argument is a string, the function tries to parse it.
 * Function accepts complete ISO 8601 formats as well as partial implementations.
 * ISO 8601: http://en.wikipedia.org/wiki/ISO_8601
 *
 * If all above fails, the function passes the given argument to Date constructor.
 *
 * @param {Date|String|Number} argument - the value to convert
 * @param {Object} [options] - the object with options
 * @param {0 | 1 | 2} [options.additionalDigits=2] - the additional number of digits in the extended year format
 * @returns {Date} the parsed date in the local time zone
 *
 * @example
 * // Convert string '2014-02-11T11:30:30' to date:
 * var result = parse('2014-02-11T11:30:30')
 * //=> Tue Feb 11 2014 11:30:30
 *
 * @example
 * // Parse string '+02014101',
 * // if the additional number of digits in the extended year format is 1:
 * var result = parse('+02014101', {additionalDigits: 1})
 * //=> Fri Apr 11 2014 00:00:00
 */
function parse (argument, dirtyOptions) {
  if (is_date(argument)) {
    // Prevent the date to lose the milliseconds when passed to new Date() in IE10
    return new Date(argument.getTime())
  } else if (typeof argument !== 'string') {
    return new Date(argument)
  }

  var options = dirtyOptions || {};
  var additionalDigits = options.additionalDigits;
  if (additionalDigits == null) {
    additionalDigits = DEFAULT_ADDITIONAL_DIGITS;
  } else {
    additionalDigits = Number(additionalDigits);
  }

  var dateStrings = splitDateString(argument);

  var parseYearResult = parseYear(dateStrings.date, additionalDigits);
  var year = parseYearResult.year;
  var restDateString = parseYearResult.restDateString;

  var date = parseDate(restDateString, year);

  if (date) {
    var timestamp = date.getTime();
    var time = 0;
    var offset;

    if (dateStrings.time) {
      time = parseTime(dateStrings.time);
    }

    if (dateStrings.timezone) {
      offset = parseTimezone(dateStrings.timezone) * MILLISECONDS_IN_MINUTE$1;
    } else {
      var fullTime = timestamp + time;
      var fullTimeDate = new Date(fullTime);

      offset = getTimezoneOffsetInMilliseconds(fullTimeDate);

      // Adjust time when it's coming from DST
      var fullTimeDateNextDay = new Date(fullTime);
      fullTimeDateNextDay.setDate(fullTimeDate.getDate() + 1);
      var offsetDiff =
        getTimezoneOffsetInMilliseconds(fullTimeDateNextDay) -
        getTimezoneOffsetInMilliseconds(fullTimeDate);
      if (offsetDiff > 0) {
        offset += offsetDiff;
      }
    }

    return new Date(timestamp + time + offset)
  } else {
    return new Date(argument)
  }
}

function splitDateString (dateString) {
  var dateStrings = {};
  var array = dateString.split(parseTokenDateTimeDelimeter);
  var timeString;

  if (parseTokenPlainTime.test(array[0])) {
    dateStrings.date = null;
    timeString = array[0];
  } else {
    dateStrings.date = array[0];
    timeString = array[1];
  }

  if (timeString) {
    var token = parseTokenTimezone.exec(timeString);
    if (token) {
      dateStrings.time = timeString.replace(token[1], '');
      dateStrings.timezone = token[1];
    } else {
      dateStrings.time = timeString;
    }
  }

  return dateStrings
}

function parseYear (dateString, additionalDigits) {
  var parseTokenYYY = parseTokensYYY[additionalDigits];
  var parseTokenYYYYY = parseTokensYYYYY[additionalDigits];

  var token;

  // YYYY or ±YYYYY
  token = parseTokenYYYY.exec(dateString) || parseTokenYYYYY.exec(dateString);
  if (token) {
    var yearString = token[1];
    return {
      year: parseInt(yearString, 10),
      restDateString: dateString.slice(yearString.length)
    }
  }

  // YY or ±YYY
  token = parseTokenYY.exec(dateString) || parseTokenYYY.exec(dateString);
  if (token) {
    var centuryString = token[1];
    return {
      year: parseInt(centuryString, 10) * 100,
      restDateString: dateString.slice(centuryString.length)
    }
  }

  // Invalid ISO-formatted year
  return {
    year: null
  }
}

function parseDate (dateString, year) {
  // Invalid ISO-formatted year
  if (year === null) {
    return null
  }

  var token;
  var date;
  var month;
  var week;

  // YYYY
  if (dateString.length === 0) {
    date = new Date(0);
    date.setUTCFullYear(year);
    return date
  }

  // YYYY-MM
  token = parseTokenMM.exec(dateString);
  if (token) {
    date = new Date(0);
    month = parseInt(token[1], 10) - 1;
    date.setUTCFullYear(year, month);
    return date
  }

  // YYYY-DDD or YYYYDDD
  token = parseTokenDDD.exec(dateString);
  if (token) {
    date = new Date(0);
    var dayOfYear = parseInt(token[1], 10);
    date.setUTCFullYear(year, 0, dayOfYear);
    return date
  }

  // YYYY-MM-DD or YYYYMMDD
  token = parseTokenMMDD.exec(dateString);
  if (token) {
    date = new Date(0);
    month = parseInt(token[1], 10) - 1;
    var day = parseInt(token[2], 10);
    date.setUTCFullYear(year, month, day);
    return date
  }

  // YYYY-Www or YYYYWww
  token = parseTokenWww.exec(dateString);
  if (token) {
    week = parseInt(token[1], 10) - 1;
    return dayOfISOYear(year, week)
  }

  // YYYY-Www-D or YYYYWwwD
  token = parseTokenWwwD.exec(dateString);
  if (token) {
    week = parseInt(token[1], 10) - 1;
    var dayOfWeek = parseInt(token[2], 10) - 1;
    return dayOfISOYear(year, week, dayOfWeek)
  }

  // Invalid ISO-formatted date
  return null
}

function parseTime (timeString) {
  var token;
  var hours;
  var minutes;

  // hh
  token = parseTokenHH.exec(timeString);
  if (token) {
    hours = parseFloat(token[1].replace(',', '.'));
    return (hours % 24) * MILLISECONDS_IN_HOUR
  }

  // hh:mm or hhmm
  token = parseTokenHHMM.exec(timeString);
  if (token) {
    hours = parseInt(token[1], 10);
    minutes = parseFloat(token[2].replace(',', '.'));
    return (hours % 24) * MILLISECONDS_IN_HOUR +
      minutes * MILLISECONDS_IN_MINUTE$1
  }

  // hh:mm:ss or hhmmss
  token = parseTokenHHMMSS.exec(timeString);
  if (token) {
    hours = parseInt(token[1], 10);
    minutes = parseInt(token[2], 10);
    var seconds = parseFloat(token[3].replace(',', '.'));
    return (hours % 24) * MILLISECONDS_IN_HOUR +
      minutes * MILLISECONDS_IN_MINUTE$1 +
      seconds * 1000
  }

  // Invalid ISO-formatted time
  return null
}

function parseTimezone (timezoneString) {
  var token;
  var absoluteOffset;

  // Z
  token = parseTokenTimezoneZ.exec(timezoneString);
  if (token) {
    return 0
  }

  // ±hh
  token = parseTokenTimezoneHH.exec(timezoneString);
  if (token) {
    absoluteOffset = parseInt(token[2], 10) * 60;
    return (token[1] === '+') ? -absoluteOffset : absoluteOffset
  }

  // ±hh:mm or ±hhmm
  token = parseTokenTimezoneHHMM.exec(timezoneString);
  if (token) {
    absoluteOffset = parseInt(token[2], 10) * 60 + parseInt(token[3], 10);
    return (token[1] === '+') ? -absoluteOffset : absoluteOffset
  }

  return 0
}

function dayOfISOYear (isoYear, week, day) {
  week = week || 0;
  day = day || 0;
  var date = new Date(0);
  date.setUTCFullYear(isoYear, 0, 4);
  var fourthOfJanuaryDay = date.getUTCDay() || 7;
  var diff = week * 7 + day + 1 - fourthOfJanuaryDay;
  date.setUTCDate(date.getUTCDate() + diff);
  return date
}

var parse_1 = parse;

/**
 * @category Year Helpers
 * @summary Return the start of a year for the given date.
 *
 * @description
 * Return the start of a year for the given date.
 * The result will be in the local timezone.
 *
 * @param {Date|String|Number} date - the original date
 * @returns {Date} the start of a year
 *
 * @example
 * // The start of a year for 2 September 2014 11:55:00:
 * var result = startOfYear(new Date(2014, 8, 2, 11, 55, 00))
 * //=> Wed Jan 01 2014 00:00:00
 */
function startOfYear (dirtyDate) {
  var cleanDate = parse_1(dirtyDate);
  var date = new Date(0);
  date.setFullYear(cleanDate.getFullYear(), 0, 1);
  date.setHours(0, 0, 0, 0);
  return date
}

var start_of_year = startOfYear;

/**
 * @category Day Helpers
 * @summary Return the start of a day for the given date.
 *
 * @description
 * Return the start of a day for the given date.
 * The result will be in the local timezone.
 *
 * @param {Date|String|Number} date - the original date
 * @returns {Date} the start of a day
 *
 * @example
 * // The start of a day for 2 September 2014 11:55:00:
 * var result = startOfDay(new Date(2014, 8, 2, 11, 55, 0))
 * //=> Tue Sep 02 2014 00:00:00
 */
function startOfDay (dirtyDate) {
  var date = parse_1(dirtyDate);
  date.setHours(0, 0, 0, 0);
  return date
}

var start_of_day = startOfDay;

var MILLISECONDS_IN_MINUTE$2 = 60000;
var MILLISECONDS_IN_DAY = 86400000;

/**
 * @category Day Helpers
 * @summary Get the number of calendar days between the given dates.
 *
 * @description
 * Get the number of calendar days between the given dates.
 *
 * @param {Date|String|Number} dateLeft - the later date
 * @param {Date|String|Number} dateRight - the earlier date
 * @returns {Number} the number of calendar days
 *
 * @example
 * // How many calendar days are between
 * // 2 July 2011 23:00:00 and 2 July 2012 00:00:00?
 * var result = differenceInCalendarDays(
 *   new Date(2012, 6, 2, 0, 0),
 *   new Date(2011, 6, 2, 23, 0)
 * )
 * //=> 366
 */
function differenceInCalendarDays (dirtyDateLeft, dirtyDateRight) {
  var startOfDayLeft = start_of_day(dirtyDateLeft);
  var startOfDayRight = start_of_day(dirtyDateRight);

  var timestampLeft = startOfDayLeft.getTime() -
    startOfDayLeft.getTimezoneOffset() * MILLISECONDS_IN_MINUTE$2;
  var timestampRight = startOfDayRight.getTime() -
    startOfDayRight.getTimezoneOffset() * MILLISECONDS_IN_MINUTE$2;

  // Round the number of days to the nearest integer
  // because the number of milliseconds in a day is not constant
  // (e.g. it's different in the day of the daylight saving time clock shift)
  return Math.round((timestampLeft - timestampRight) / MILLISECONDS_IN_DAY)
}

var difference_in_calendar_days = differenceInCalendarDays;

/**
 * @category Day Helpers
 * @summary Get the day of the year of the given date.
 *
 * @description
 * Get the day of the year of the given date.
 *
 * @param {Date|String|Number} date - the given date
 * @returns {Number} the day of year
 *
 * @example
 * // Which day of the year is 2 July 2014?
 * var result = getDayOfYear(new Date(2014, 6, 2))
 * //=> 183
 */
function getDayOfYear (dirtyDate) {
  var date = parse_1(dirtyDate);
  var diff = difference_in_calendar_days(date, start_of_year(date));
  var dayOfYear = diff + 1;
  return dayOfYear
}

var get_day_of_year = getDayOfYear;

/**
 * @category Week Helpers
 * @summary Return the start of a week for the given date.
 *
 * @description
 * Return the start of a week for the given date.
 * The result will be in the local timezone.
 *
 * @param {Date|String|Number} date - the original date
 * @param {Object} [options] - the object with options
 * @param {Number} [options.weekStartsOn=0] - the index of the first day of the week (0 - Sunday)
 * @returns {Date} the start of a week
 *
 * @example
 * // The start of a week for 2 September 2014 11:55:00:
 * var result = startOfWeek(new Date(2014, 8, 2, 11, 55, 0))
 * //=> Sun Aug 31 2014 00:00:00
 *
 * @example
 * // If the week starts on Monday, the start of the week for 2 September 2014 11:55:00:
 * var result = startOfWeek(new Date(2014, 8, 2, 11, 55, 0), {weekStartsOn: 1})
 * //=> Mon Sep 01 2014 00:00:00
 */
function startOfWeek (dirtyDate, dirtyOptions) {
  var weekStartsOn = dirtyOptions ? (Number(dirtyOptions.weekStartsOn) || 0) : 0;

  var date = parse_1(dirtyDate);
  var day = date.getDay();
  var diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;

  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date
}

var start_of_week = startOfWeek;

/**
 * @category ISO Week Helpers
 * @summary Return the start of an ISO week for the given date.
 *
 * @description
 * Return the start of an ISO week for the given date.
 * The result will be in the local timezone.
 *
 * ISO week-numbering year: http://en.wikipedia.org/wiki/ISO_week_date
 *
 * @param {Date|String|Number} date - the original date
 * @returns {Date} the start of an ISO week
 *
 * @example
 * // The start of an ISO week for 2 September 2014 11:55:00:
 * var result = startOfISOWeek(new Date(2014, 8, 2, 11, 55, 0))
 * //=> Mon Sep 01 2014 00:00:00
 */
function startOfISOWeek (dirtyDate) {
  return start_of_week(dirtyDate, {weekStartsOn: 1})
}

var start_of_iso_week = startOfISOWeek;

/**
 * @category ISO Week-Numbering Year Helpers
 * @summary Get the ISO week-numbering year of the given date.
 *
 * @description
 * Get the ISO week-numbering year of the given date,
 * which always starts 3 days before the year's first Thursday.
 *
 * ISO week-numbering year: http://en.wikipedia.org/wiki/ISO_week_date
 *
 * @param {Date|String|Number} date - the given date
 * @returns {Number} the ISO week-numbering year
 *
 * @example
 * // Which ISO-week numbering year is 2 January 2005?
 * var result = getISOYear(new Date(2005, 0, 2))
 * //=> 2004
 */
function getISOYear (dirtyDate) {
  var date = parse_1(dirtyDate);
  var year = date.getFullYear();

  var fourthOfJanuaryOfNextYear = new Date(0);
  fourthOfJanuaryOfNextYear.setFullYear(year + 1, 0, 4);
  fourthOfJanuaryOfNextYear.setHours(0, 0, 0, 0);
  var startOfNextYear = start_of_iso_week(fourthOfJanuaryOfNextYear);

  var fourthOfJanuaryOfThisYear = new Date(0);
  fourthOfJanuaryOfThisYear.setFullYear(year, 0, 4);
  fourthOfJanuaryOfThisYear.setHours(0, 0, 0, 0);
  var startOfThisYear = start_of_iso_week(fourthOfJanuaryOfThisYear);

  if (date.getTime() >= startOfNextYear.getTime()) {
    return year + 1
  } else if (date.getTime() >= startOfThisYear.getTime()) {
    return year
  } else {
    return year - 1
  }
}

var get_iso_year = getISOYear;

/**
 * @category ISO Week-Numbering Year Helpers
 * @summary Return the start of an ISO week-numbering year for the given date.
 *
 * @description
 * Return the start of an ISO week-numbering year,
 * which always starts 3 days before the year's first Thursday.
 * The result will be in the local timezone.
 *
 * ISO week-numbering year: http://en.wikipedia.org/wiki/ISO_week_date
 *
 * @param {Date|String|Number} date - the original date
 * @returns {Date} the start of an ISO year
 *
 * @example
 * // The start of an ISO week-numbering year for 2 July 2005:
 * var result = startOfISOYear(new Date(2005, 6, 2))
 * //=> Mon Jan 03 2005 00:00:00
 */
function startOfISOYear (dirtyDate) {
  var year = get_iso_year(dirtyDate);
  var fourthOfJanuary = new Date(0);
  fourthOfJanuary.setFullYear(year, 0, 4);
  fourthOfJanuary.setHours(0, 0, 0, 0);
  var date = start_of_iso_week(fourthOfJanuary);
  return date
}

var start_of_iso_year = startOfISOYear;

var MILLISECONDS_IN_WEEK = 604800000;

/**
 * @category ISO Week Helpers
 * @summary Get the ISO week of the given date.
 *
 * @description
 * Get the ISO week of the given date.
 *
 * ISO week-numbering year: http://en.wikipedia.org/wiki/ISO_week_date
 *
 * @param {Date|String|Number} date - the given date
 * @returns {Number} the ISO week
 *
 * @example
 * // Which week of the ISO-week numbering year is 2 January 2005?
 * var result = getISOWeek(new Date(2005, 0, 2))
 * //=> 53
 */
function getISOWeek (dirtyDate) {
  var date = parse_1(dirtyDate);
  var diff = start_of_iso_week(date).getTime() - start_of_iso_year(date).getTime();

  // Round the number of days to the nearest integer
  // because the number of milliseconds in a week is not constant
  // (e.g. it's different in the week of the daylight saving time clock shift)
  return Math.round(diff / MILLISECONDS_IN_WEEK) + 1
}

var get_iso_week = getISOWeek;

/**
 * @category Common Helpers
 * @summary Is the given date valid?
 *
 * @description
 * Returns false if argument is Invalid Date and true otherwise.
 * Invalid Date is a Date, whose time value is NaN.
 *
 * Time value of Date: http://es5.github.io/#x15.9.1.1
 *
 * @param {Date} date - the date to check
 * @returns {Boolean} the date is valid
 * @throws {TypeError} argument must be an instance of Date
 *
 * @example
 * // For the valid date:
 * var result = isValid(new Date(2014, 1, 31))
 * //=> true
 *
 * @example
 * // For the invalid date:
 * var result = isValid(new Date(''))
 * //=> false
 */
function isValid (dirtyDate) {
  if (is_date(dirtyDate)) {
    return !isNaN(dirtyDate)
  } else {
    throw new TypeError(toString.call(dirtyDate) + ' is not an instance of Date')
  }
}

var is_valid = isValid;

function buildDistanceInWordsLocale () {
  var distanceInWordsLocale = {
    lessThanXSeconds: {
      one: 'less than a second',
      other: 'less than {{count}} seconds'
    },

    xSeconds: {
      one: '1 second',
      other: '{{count}} seconds'
    },

    halfAMinute: 'half a minute',

    lessThanXMinutes: {
      one: 'less than a minute',
      other: 'less than {{count}} minutes'
    },

    xMinutes: {
      one: '1 minute',
      other: '{{count}} minutes'
    },

    aboutXHours: {
      one: 'about 1 hour',
      other: 'about {{count}} hours'
    },

    xHours: {
      one: '1 hour',
      other: '{{count}} hours'
    },

    xDays: {
      one: '1 day',
      other: '{{count}} days'
    },

    aboutXMonths: {
      one: 'about 1 month',
      other: 'about {{count}} months'
    },

    xMonths: {
      one: '1 month',
      other: '{{count}} months'
    },

    aboutXYears: {
      one: 'about 1 year',
      other: 'about {{count}} years'
    },

    xYears: {
      one: '1 year',
      other: '{{count}} years'
    },

    overXYears: {
      one: 'over 1 year',
      other: 'over {{count}} years'
    },

    almostXYears: {
      one: 'almost 1 year',
      other: 'almost {{count}} years'
    }
  };

  function localize (token, count, options) {
    options = options || {};

    var result;
    if (typeof distanceInWordsLocale[token] === 'string') {
      result = distanceInWordsLocale[token];
    } else if (count === 1) {
      result = distanceInWordsLocale[token].one;
    } else {
      result = distanceInWordsLocale[token].other.replace('{{count}}', count);
    }

    if (options.addSuffix) {
      if (options.comparison > 0) {
        return 'in ' + result
      } else {
        return result + ' ago'
      }
    }

    return result
  }

  return {
    localize: localize
  }
}

var build_distance_in_words_locale = buildDistanceInWordsLocale;

var commonFormatterKeys = [
  'M', 'MM', 'Q', 'D', 'DD', 'DDD', 'DDDD', 'd',
  'E', 'W', 'WW', 'YY', 'YYYY', 'GG', 'GGGG',
  'H', 'HH', 'h', 'hh', 'm', 'mm',
  's', 'ss', 'S', 'SS', 'SSS',
  'Z', 'ZZ', 'X', 'x'
];

function buildFormattingTokensRegExp (formatters) {
  var formatterKeys = [];
  for (var key in formatters) {
    if (formatters.hasOwnProperty(key)) {
      formatterKeys.push(key);
    }
  }

  var formattingTokens = commonFormatterKeys
    .concat(formatterKeys)
    .sort()
    .reverse();
  var formattingTokensRegExp = new RegExp(
    '(\\[[^\\[]*\\])|(\\\\)?' + '(' + formattingTokens.join('|') + '|.)', 'g'
  );

  return formattingTokensRegExp
}

var build_formatting_tokens_reg_exp = buildFormattingTokensRegExp;

function buildFormatLocale () {
  // Note: in English, the names of days of the week and months are capitalized.
  // If you are making a new locale based on this one, check if the same is true for the language you're working on.
  // Generally, formatted dates should look like they are in the middle of a sentence,
  // e.g. in Spanish language the weekdays and months should be in the lowercase.
  var months3char = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var monthsFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var weekdays2char = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var weekdays3char = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var weekdaysFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var meridiemUppercase = ['AM', 'PM'];
  var meridiemLowercase = ['am', 'pm'];
  var meridiemFull = ['a.m.', 'p.m.'];

  var formatters = {
    // Month: Jan, Feb, ..., Dec
    'MMM': function (date) {
      return months3char[date.getMonth()]
    },

    // Month: January, February, ..., December
    'MMMM': function (date) {
      return monthsFull[date.getMonth()]
    },

    // Day of week: Su, Mo, ..., Sa
    'dd': function (date) {
      return weekdays2char[date.getDay()]
    },

    // Day of week: Sun, Mon, ..., Sat
    'ddd': function (date) {
      return weekdays3char[date.getDay()]
    },

    // Day of week: Sunday, Monday, ..., Saturday
    'dddd': function (date) {
      return weekdaysFull[date.getDay()]
    },

    // AM, PM
    'A': function (date) {
      return (date.getHours() / 12) >= 1 ? meridiemUppercase[1] : meridiemUppercase[0]
    },

    // am, pm
    'a': function (date) {
      return (date.getHours() / 12) >= 1 ? meridiemLowercase[1] : meridiemLowercase[0]
    },

    // a.m., p.m.
    'aa': function (date) {
      return (date.getHours() / 12) >= 1 ? meridiemFull[1] : meridiemFull[0]
    }
  };

  // Generate ordinal version of formatters: M -> Mo, D -> Do, etc.
  var ordinalFormatters = ['M', 'D', 'DDD', 'd', 'Q', 'W'];
  ordinalFormatters.forEach(function (formatterToken) {
    formatters[formatterToken + 'o'] = function (date, formatters) {
      return ordinal(formatters[formatterToken](date))
    };
  });

  return {
    formatters: formatters,
    formattingTokensRegExp: build_formatting_tokens_reg_exp(formatters)
  }
}

function ordinal (number) {
  var rem100 = number % 100;
  if (rem100 > 20 || rem100 < 10) {
    switch (rem100 % 10) {
      case 1:
        return number + 'st'
      case 2:
        return number + 'nd'
      case 3:
        return number + 'rd'
    }
  }
  return number + 'th'
}

var build_format_locale = buildFormatLocale;

/**
 * @category Locales
 * @summary English locale.
 */
var en = {
  distanceInWords: build_distance_in_words_locale(),
  format: build_format_locale()
};

/**
 * @category Common Helpers
 * @summary Format the date.
 *
 * @description
 * Return the formatted date string in the given format.
 *
 * Accepted tokens:
 * | Unit                    | Token | Result examples                  |
 * |-------------------------|-------|----------------------------------|
 * | Month                   | M     | 1, 2, ..., 12                    |
 * |                         | Mo    | 1st, 2nd, ..., 12th              |
 * |                         | MM    | 01, 02, ..., 12                  |
 * |                         | MMM   | Jan, Feb, ..., Dec               |
 * |                         | MMMM  | January, February, ..., December |
 * | Quarter                 | Q     | 1, 2, 3, 4                       |
 * |                         | Qo    | 1st, 2nd, 3rd, 4th               |
 * | Day of month            | D     | 1, 2, ..., 31                    |
 * |                         | Do    | 1st, 2nd, ..., 31st              |
 * |                         | DD    | 01, 02, ..., 31                  |
 * | Day of year             | DDD   | 1, 2, ..., 366                   |
 * |                         | DDDo  | 1st, 2nd, ..., 366th             |
 * |                         | DDDD  | 001, 002, ..., 366               |
 * | Day of week             | d     | 0, 1, ..., 6                     |
 * |                         | do    | 0th, 1st, ..., 6th               |
 * |                         | dd    | Su, Mo, ..., Sa                  |
 * |                         | ddd   | Sun, Mon, ..., Sat               |
 * |                         | dddd  | Sunday, Monday, ..., Saturday    |
 * | Day of ISO week         | E     | 1, 2, ..., 7                     |
 * | ISO week                | W     | 1, 2, ..., 53                    |
 * |                         | Wo    | 1st, 2nd, ..., 53rd              |
 * |                         | WW    | 01, 02, ..., 53                  |
 * | Year                    | YY    | 00, 01, ..., 99                  |
 * |                         | YYYY  | 1900, 1901, ..., 2099            |
 * | ISO week-numbering year | GG    | 00, 01, ..., 99                  |
 * |                         | GGGG  | 1900, 1901, ..., 2099            |
 * | AM/PM                   | A     | AM, PM                           |
 * |                         | a     | am, pm                           |
 * |                         | aa    | a.m., p.m.                       |
 * | Hour                    | H     | 0, 1, ... 23                     |
 * |                         | HH    | 00, 01, ... 23                   |
 * |                         | h     | 1, 2, ..., 12                    |
 * |                         | hh    | 01, 02, ..., 12                  |
 * | Minute                  | m     | 0, 1, ..., 59                    |
 * |                         | mm    | 00, 01, ..., 59                  |
 * | Second                  | s     | 0, 1, ..., 59                    |
 * |                         | ss    | 00, 01, ..., 59                  |
 * | 1/10 of second          | S     | 0, 1, ..., 9                     |
 * | 1/100 of second         | SS    | 00, 01, ..., 99                  |
 * | Millisecond             | SSS   | 000, 001, ..., 999               |
 * | Timezone                | Z     | -01:00, +00:00, ... +12:00       |
 * |                         | ZZ    | -0100, +0000, ..., +1200         |
 * | Seconds timestamp       | X     | 512969520                        |
 * | Milliseconds timestamp  | x     | 512969520900                     |
 *
 * The characters wrapped in square brackets are escaped.
 *
 * The result may vary by locale.
 *
 * @param {Date|String|Number} date - the original date
 * @param {String} [format='YYYY-MM-DDTHH:mm:ss.SSSZ'] - the string of tokens
 * @param {Object} [options] - the object with options
 * @param {Object} [options.locale=enLocale] - the locale object
 * @returns {String} the formatted date string
 *
 * @example
 * // Represent 11 February 2014 in middle-endian format:
 * var result = format(
 *   new Date(2014, 1, 11),
 *   'MM/DD/YYYY'
 * )
 * //=> '02/11/2014'
 *
 * @example
 * // Represent 2 July 2014 in Esperanto:
 * var eoLocale = require('date-fns/locale/eo')
 * var result = format(
 *   new Date(2014, 6, 2),
 *   'Do [de] MMMM YYYY',
 *   {locale: eoLocale}
 * )
 * //=> '2-a de julio 2014'
 */
function format (dirtyDate, dirtyFormatStr, dirtyOptions) {
  var formatStr = dirtyFormatStr ? String(dirtyFormatStr) : 'YYYY-MM-DDTHH:mm:ss.SSSZ';
  var options = dirtyOptions || {};

  var locale = options.locale;
  var localeFormatters = en.format.formatters;
  var formattingTokensRegExp = en.format.formattingTokensRegExp;
  if (locale && locale.format && locale.format.formatters) {
    localeFormatters = locale.format.formatters;

    if (locale.format.formattingTokensRegExp) {
      formattingTokensRegExp = locale.format.formattingTokensRegExp;
    }
  }

  var date = parse_1(dirtyDate);

  if (!is_valid(date)) {
    return 'Invalid Date'
  }

  var formatFn = buildFormatFn(formatStr, localeFormatters, formattingTokensRegExp);

  return formatFn(date)
}

var formatters = {
  // Month: 1, 2, ..., 12
  'M': function (date) {
    return date.getMonth() + 1
  },

  // Month: 01, 02, ..., 12
  'MM': function (date) {
    return addLeadingZeros(date.getMonth() + 1, 2)
  },

  // Quarter: 1, 2, 3, 4
  'Q': function (date) {
    return Math.ceil((date.getMonth() + 1) / 3)
  },

  // Day of month: 1, 2, ..., 31
  'D': function (date) {
    return date.getDate()
  },

  // Day of month: 01, 02, ..., 31
  'DD': function (date) {
    return addLeadingZeros(date.getDate(), 2)
  },

  // Day of year: 1, 2, ..., 366
  'DDD': function (date) {
    return get_day_of_year(date)
  },

  // Day of year: 001, 002, ..., 366
  'DDDD': function (date) {
    return addLeadingZeros(get_day_of_year(date), 3)
  },

  // Day of week: 0, 1, ..., 6
  'd': function (date) {
    return date.getDay()
  },

  // Day of ISO week: 1, 2, ..., 7
  'E': function (date) {
    return date.getDay() || 7
  },

  // ISO week: 1, 2, ..., 53
  'W': function (date) {
    return get_iso_week(date)
  },

  // ISO week: 01, 02, ..., 53
  'WW': function (date) {
    return addLeadingZeros(get_iso_week(date), 2)
  },

  // Year: 00, 01, ..., 99
  'YY': function (date) {
    return addLeadingZeros(date.getFullYear(), 4).substr(2)
  },

  // Year: 1900, 1901, ..., 2099
  'YYYY': function (date) {
    return addLeadingZeros(date.getFullYear(), 4)
  },

  // ISO week-numbering year: 00, 01, ..., 99
  'GG': function (date) {
    return String(get_iso_year(date)).substr(2)
  },

  // ISO week-numbering year: 1900, 1901, ..., 2099
  'GGGG': function (date) {
    return get_iso_year(date)
  },

  // Hour: 0, 1, ... 23
  'H': function (date) {
    return date.getHours()
  },

  // Hour: 00, 01, ..., 23
  'HH': function (date) {
    return addLeadingZeros(date.getHours(), 2)
  },

  // Hour: 1, 2, ..., 12
  'h': function (date) {
    var hours = date.getHours();
    if (hours === 0) {
      return 12
    } else if (hours > 12) {
      return hours % 12
    } else {
      return hours
    }
  },

  // Hour: 01, 02, ..., 12
  'hh': function (date) {
    return addLeadingZeros(formatters['h'](date), 2)
  },

  // Minute: 0, 1, ..., 59
  'm': function (date) {
    return date.getMinutes()
  },

  // Minute: 00, 01, ..., 59
  'mm': function (date) {
    return addLeadingZeros(date.getMinutes(), 2)
  },

  // Second: 0, 1, ..., 59
  's': function (date) {
    return date.getSeconds()
  },

  // Second: 00, 01, ..., 59
  'ss': function (date) {
    return addLeadingZeros(date.getSeconds(), 2)
  },

  // 1/10 of second: 0, 1, ..., 9
  'S': function (date) {
    return Math.floor(date.getMilliseconds() / 100)
  },

  // 1/100 of second: 00, 01, ..., 99
  'SS': function (date) {
    return addLeadingZeros(Math.floor(date.getMilliseconds() / 10), 2)
  },

  // Millisecond: 000, 001, ..., 999
  'SSS': function (date) {
    return addLeadingZeros(date.getMilliseconds(), 3)
  },

  // Timezone: -01:00, +00:00, ... +12:00
  'Z': function (date) {
    return formatTimezone(date.getTimezoneOffset(), ':')
  },

  // Timezone: -0100, +0000, ... +1200
  'ZZ': function (date) {
    return formatTimezone(date.getTimezoneOffset())
  },

  // Seconds timestamp: 512969520
  'X': function (date) {
    return Math.floor(date.getTime() / 1000)
  },

  // Milliseconds timestamp: 512969520900
  'x': function (date) {
    return date.getTime()
  }
};

function buildFormatFn (formatStr, localeFormatters, formattingTokensRegExp) {
  var array = formatStr.match(formattingTokensRegExp);
  var length = array.length;

  var i;
  var formatter;
  for (i = 0; i < length; i++) {
    formatter = localeFormatters[array[i]] || formatters[array[i]];
    if (formatter) {
      array[i] = formatter;
    } else {
      array[i] = removeFormattingTokens(array[i]);
    }
  }

  return function (date) {
    var output = '';
    for (var i = 0; i < length; i++) {
      if (array[i] instanceof Function) {
        output += array[i](date, formatters);
      } else {
        output += array[i];
      }
    }
    return output
  }
}

function removeFormattingTokens (input) {
  if (input.match(/\[[\s\S]/)) {
    return input.replace(/^\[|]$/g, '')
  }
  return input.replace(/\\/g, '')
}

function formatTimezone (offset, delimeter) {
  delimeter = delimeter || '';
  var sign = offset > 0 ? '-' : '+';
  var absOffset = Math.abs(offset);
  var hours = Math.floor(absOffset / 60);
  var minutes = absOffset % 60;
  return sign + addLeadingZeros(hours, 2) + delimeter + addLeadingZeros(minutes, 2)
}

function addLeadingZeros (number, targetLength) {
  var output = Math.abs(number).toString();
  while (output.length < targetLength) {
    output = '0' + output;
  }
  return output
}

var format_1 = format;

function createIcon$1(Type, _ref) {
  var css = _ref.css,
      rest = _objectWithoutPropertiesLoose(_ref, ["css"]);

  return core.jsx(Type, _extends({
    css: _extends({}, css, {
      verticalAlign: 'text-bottom'
    })
  }, rest));
}
function GitHubIcon$1(props) {
  return createIcon$1(FaGithub, props);
}

function _templateObject$1() {
  var data = _taggedTemplateLiteralLoose(["\n  html {\n    box-sizing: border-box;\n  }\n  *,\n  *:before,\n  *:after {\n    box-sizing: inherit;\n  }\n\n  html,\n  body,\n  #root {\n    height: 100%;\n    margin: 0;\n  }\n\n  body {\n    ", "\n    font-size: 16px;\n    line-height: 1.5;\n    overflow-wrap: break-word;\n    background: white;\n    color: black;\n  }\n\n  code {\n    ", "\n    font-size: 1rem;\n    padding: 0 3px;\n    background-color: #eee;\n  }\n\n  dd,\n  ul {\n    margin-left: 0;\n    padding-left: 25px;\n  }\n"]);

  _templateObject$1 = function _templateObject() {
    return data;
  };

  return data;
}
var buildId$1 = "6ec4aa4";
var globalStyles$1 = core.css(_templateObject$1(), fontSans, fontMono);

function Link$1(props) {
  return (// eslint-disable-next-line jsx-a11y/anchor-has-content
    core.jsx("a", _extends({}, props, {
      css: {
        color: '#0076ff',
        textDecoration: 'none',
        ':hover': {
          textDecoration: 'underline'
        }
      }
    }))
  );
}

function Stats(_ref2) {
  var data = _ref2.data;
  var totals = data.totals;
  var since = parse_1(totals.since);
  var until = parse_1(totals.until);
  return core.jsx("p", null, "From ", core.jsx("strong", null, format_1(since, 'MMM D')), " to", ' ', core.jsx("strong", null, format_1(until, 'MMM D')), " unpkg served", ' ', core.jsx("strong", null, formatNumber(totals.requests.all)), " requests and a total of ", core.jsx("strong", null, formatBytes(totals.bandwidth.all)), " of data to", ' ', core.jsx("strong", null, formatNumber(totals.uniques.all)), " unique visitors,", ' ', core.jsx("strong", null, formatPercent(totals.requests.cached / totals.requests.all, 2), "%"), ' ', "of which were served from the cache.");
}

function App$1() {
  var _useState = React.useState(typeof window === 'object' && window.localStorage && window.localStorage.savedStats ? JSON.parse(window.localStorage.savedStats) : null),
      stats = _useState[0],
      setStats = _useState[1];

  var hasStats = !!(stats && !stats.error);
  var stringStats = JSON.stringify(stats);
  React.useEffect(function () {
    window.localStorage.savedStats = stringStats;
  }, [stringStats]);
  React.useEffect(function () {
    fetch('/api/stats?period=last-month').then(function (res) {
      return res.json();
    }).then(setStats);
  }, []);
  return core.jsx(React.Fragment, null, core.jsx(core.Global, {
    styles: globalStyles$1
  }), core.jsx("div", {
    css: {
      maxWidth: 740,
      margin: '0 auto'
    }
  }, core.jsx("div", {
    css: {
      padding: '0 20px'
    }
  }, core.jsx("header", null, core.jsx("h1", {
    css: {
      textAlign: 'center',
      fontSize: '4.5em',
      letterSpacing: '0.05em',
      '@media (min-width: 700px)': {
        marginTop: '1.5em'
      }
    }
  }, "UNPKG"), core.jsx("p", null, "unpkg is a fast, global content delivery network for everything on", ' ', core.jsx(Link$1, {
    href: "https://www.npmjs.com/"
  }, "npm"), ". Use it to quickly and easily load any file from any package using a URL like:"), core.jsx("div", {
    css: {
      textAlign: 'center',
      backgroundColor: '#eee',
      margin: '2em 0',
      padding: '5px 0'
    }
  }, "/unpkg/:package@:version/:file"), hasStats && core.jsx(Stats, {
    data: stats
  })), core.jsx("h3", {
    css: {
      fontSize: '1.6em'
    },
    id: "examples"
  }, "Examples"), core.jsx("p", null, "Using a fixed version:"), core.jsx("ul", null, core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/react@16.7.0/umd/react.production.min.js"
  }, "/unpkg/react@16.7.0/umd/react.production.min.js")), core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/react-dom@16.7.0/umd/react-dom.production.min.js"
  }, "/unpkg/react-dom@16.7.0/umd/react-dom.production.min.js"))), core.jsx("p", null, "You may also use a", ' ', core.jsx(Link$1, {
    href: "https://docs.npmjs.com/about-semantic-versioning"
  }, "semver range"), ' ', "or a ", core.jsx(Link$1, {
    href: "https://docs.npmjs.com/cli/dist-tag"
  }, "tag"), ' ', "instead of a fixed version number, or omit the version/tag entirely to use the ", core.jsx("code", null, "latest"), " tag."), core.jsx("ul", null, core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/react@^16/umd/react.production.min.js"
  }, "/unpkg/react@^16/umd/react.production.min.js")), core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/react/umd/react.production.min.js"
  }, "/unpkg/react/umd/react.production.min.js"))), core.jsx("p", null, "If you omit the file path (i.e. use a \u201Cbare\u201D URL), unpkg will serve the file specified by the ", core.jsx("code", null, "unpkg"), " field in", ' ', core.jsx("code", null, "package.json"), ", or fall back to ", core.jsx("code", null, "main"), "."), core.jsx("ul", null, core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/jquery"
  }, "/unpkg/jquery")), core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/three"
  }, "/unpkg/three"))), core.jsx("p", null, "Append a ", core.jsx("code", null, "/"), " at the end of a URL to view a listing of all the files in a package."), core.jsx("ul", null, core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/react/"
  }, "/unpkg/react/")), core.jsx("li", null, core.jsx(Link$1, {
    href: "/unpkg/react-router/"
  }, "/unpkg/react-router/"))), core.jsx("h3", {
    css: {
      fontSize: '1.6em'
    },
    id: "query-params"
  }, "Query Parameters"), core.jsx("dl", null, core.jsx("dt", null, core.jsx("code", null, "?meta")), core.jsx("dd", null, "Return metadata about any file in a package as JSON (e.g.", core.jsx("code", null, "/any/file?meta"), ")"), core.jsx("dt", null, core.jsx("code", null, "?module")), core.jsx("dd", null, "Expands all", ' ', core.jsx(Link$1, {
    href: "https://html.spec.whatwg.org/multipage/webappapis.html#resolve-a-module-specifier"
  }, "\u201Cbare\u201D ", core.jsx("code", null, "import"), " specifiers"), ' ', "in JavaScript modules to unpkg URLs. This feature is", ' ', core.jsx("em", null, "very experimental"))), core.jsx("h3", {
    css: {
      fontSize: '1.6em'
    },
    id: "cache-behavior"
  }, "Cache Behavior"), core.jsx("p", null, "The CDN caches files based on their permanent URL, which includes the npm package version. This works because npm does not allow package authors to overwrite a package that has already been published with a different one at the same version number."), core.jsx("p", null, "Browsers are instructed (via the ", core.jsx("code", null, "Cache-Control"), " header) to cache assets indefinitely (1 year)."), core.jsx("p", null, "URLs that do not specify a package version number redirect to one that does. This is the ", core.jsx("code", null, "latest"), " version when no version is specified, or the ", core.jsx("code", null, "maxSatisfying"), " version when a", ' ', core.jsx(Link$1, {
    href: "https://github.com/npm/node-semver"
  }, "semver version"), ' ', "is given. Redirects are cached for 10 minutes at the CDN, 1 minute in browsers."), core.jsx("p", null, "If you want users to be able to use the latest version when you cut a new release, the best policy is to put the version number in the URL directly in your installation instructions. This will also load more quickly because we won't have to resolve the latest version and redirect them."), core.jsx("h3", {
    css: {
      fontSize: '1.6em'
    },
    id: "workflow"
  }, "Workflow"), core.jsx("p", null, "For npm package authors, unpkg relieves the burden of publishing your code to a CDN in addition to the npm registry. All you need to do is include your", ' ', core.jsx(Link$1, {
    href: "https://github.com/umdjs/umd"
  }, "UMD"), " build in your npm package (not your repo, that's different!)."), core.jsx("p", null, "You can do this easily using the following setup:"), core.jsx("ul", null, core.jsx("li", null, "Add the ", core.jsx("code", null, "umd"), " (or ", core.jsx("code", null, "dist"), ") directory to your", ' ', core.jsx("code", null, ".gitignore"), " file"), core.jsx("li", null, "Add the ", core.jsx("code", null, "umd"), " directory to your", ' ', core.jsx(Link$1, {
    href: "https://docs.npmjs.com/files/package.json#files"
  }, "files array"), ' ', "in ", core.jsx("code", null, "package.json")), core.jsx("li", null, "Use a build script to generate your UMD build in the", ' ', core.jsx("code", null, "umd"), " directory when you publish")), core.jsx("p", null, "That's it! Now when you ", core.jsx("code", null, "npm publish"), " you'll have a version available on unpkg as well."))), core.jsx("footer", {
    css: {
      marginTop: '5rem',
      background: 'black',
      color: '#aaa'
    }
  }, core.jsx("div", {
    css: {
      maxWidth: 740,
      padding: '10px 20px',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, core.jsx("p", null, core.jsx("span", null, "Build: ", buildId$1)), core.jsx("p", null, core.jsx("span", null, "\xA9 ", new Date().getFullYear(), " Steedos UNPKG")), core.jsx("p", {
    css: {
      fontSize: '1.5rem'
    }
  }, core.jsx("a", {
    href: "https://github.com/steedos/steedos-unpkg",
    css: {
      color: '#aaa',
      display: 'inline-block',
      marginLeft: '1rem',
      ':hover': {
        color: 'white'
      }
    }
  }, core.jsx(GitHubIcon$1, null))))));
}

if (process.env.NODE_ENV !== 'production') {
  App$1.propTypes = {
    location: PropTypes.object,
    children: PropTypes.node
  };
}

const doctype$1 = '<!DOCTYPE html>';
const globalURLs$1 = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging' ? {
  '@emotion/core': '/@emotion/core@10.0.6/dist/core.umd.min.js',
  react: '/react@16.8.6/umd/react.production.min.js',
  'react-dom': '/react-dom@16.8.6/umd/react-dom.production.min.js'
} : {
  '@emotion/core': '/@emotion/core@10.0.6/dist/core.umd.min.js',
  react: '/react@16.8.6/umd/react.development.js',
  'react-dom': '/react-dom@16.8.6/umd/react-dom.development.js'
};
function serveMainPage(req, res) {
  const content = createHTML$1(server.renderToString(React.createElement(App$1)));
  const elements = getScripts('main', 'iife', globalURLs$1);
  const html = doctype$1 + server.renderToStaticMarkup(React.createElement(MainTemplate, {
    content,
    elements
  }));
  res.set({
    'Cache-Control': 'public, max-age=14400',
    // 4 hours
    'Cache-Tag': 'main'
  }).send(html);
}

const bareIdentifierFormat = /^((?:@[^/]+\/)?[^/]+)(\/.*)?$/;

function isValidURL(value) {
  return URL.parseURL(value) != null;
}

function isProbablyURLWithoutProtocol(value) {
  return value.substr(0, 2) === '//';
}

function isAbsoluteURL(value) {
  return isValidURL(value) || isProbablyURLWithoutProtocol(value);
}

function isBareIdentifier(value) {
  return value.charAt(0) !== '.' && value.charAt(0) !== '/';
}

function rewriteValue(
/* StringLiteral */
node, origin, dependencies) {
  if (isAbsoluteURL(node.value)) {
    return;
  }

  if (isBareIdentifier(node.value)) {
    // "bare" identifier
    const match = bareIdentifierFormat.exec(node.value);
    const packageName = match[1];
    const file = match[2] || '';
    warning(dependencies[packageName], 'Missing version info for package "%s" in dependencies; falling back to "latest"', packageName);
    const version = dependencies[packageName] || 'latest';
    node.value = `${origin}/${packageName}@${version}${file}?module`;
  } else {
    // local path
    node.value = `${node.value}?module`;
  }
}

function unpkgRewrite(origin, dependencies = {}) {
  return {
    manipulateOptions(opts, parserOpts) {
      parserOpts.plugins.push('dynamicImport', 'exportDefaultFrom', 'exportNamespaceFrom', 'importMeta');
    },

    visitor: {
      CallExpression(path) {
        if (path.node.callee.type !== 'Import') {
          // Some other function call, not import();
          return;
        }

        rewriteValue(path.node.arguments[0], origin, dependencies);
      },

      ExportAllDeclaration(path) {
        rewriteValue(path.node.source, origin, dependencies);
      },

      ExportNamedDeclaration(path) {
        if (!path.node.source) {
          // This export has no "source", so it's probably
          // a local variable or function, e.g.
          // export { varName }
          // export const constName = ...
          // export function funcName() {}
          return;
        }

        rewriteValue(path.node.source, origin, dependencies);
      },

      ImportDeclaration(path) {
        rewriteValue(path.node.source, origin, dependencies);
      }

    }
  };
}

const origin = process.env.ORIGIN || 'https://unpkg.com';
function rewriteBareModuleIdentifiers(code, packageConfig) {
  const dependencies = Object.assign({}, packageConfig.peerDependencies, packageConfig.dependencies);
  const options = {
    // Ignore .babelrc and package.json babel config
    // because we haven't installed dependencies so
    // we can't load plugins; see #84
    babelrc: false,
    // Make a reasonable attempt to preserve whitespace
    // from the original file. This ensures minified
    // .mjs stays minified; see #149
    retainLines: true,
    plugins: [unpkgRewrite(origin, dependencies), '@babel/plugin-proposal-optional-chaining', '@babel/plugin-proposal-nullish-coalescing-operator']
  };
  return babel.transform(code, options).code;
}

function serveHTMLModule(req, res) {
  try {
    const $ = cheerio.load(req.entry.content.toString('utf8'));
    $('script[type=module]').each((index, element) => {
      $(element).html(rewriteBareModuleIdentifiers($(element).html(), req.packageConfig));
    });
    const code = $.html();
    res.set({
      'Content-Length': Buffer.byteLength(code),
      'Content-Type': getContentTypeHeader(req.entry.contentType),
      'Cache-Control': 'public, max-age=31536000',
      // 1 year
      ETag: etag(code),
      'Cache-Tag': 'file, html-file, html-module'
    }).send(code);
  } catch (error) {
    console.error(error);
    const errorName = error.constructor.name;
    const errorMessage = error.message.replace(/^.*?\/unpkg-.+?\//, `/${req.packageSpec}/`);
    const codeFrame = error.codeFrame;
    const debugInfo = `${errorName}: ${errorMessage}\n\n${codeFrame}`;
    res.status(500).type('text').send(`Cannot generate module for ${req.packageSpec}${req.filename}\n\n${debugInfo}`);
  }
}

function serveJavaScriptModule(req, res) {
  try {
    const code = rewriteBareModuleIdentifiers(req.entry.content.toString('utf8'), req.packageConfig);
    res.set({
      'Content-Length': Buffer.byteLength(code),
      'Content-Type': getContentTypeHeader(req.entry.contentType),
      'Cache-Control': 'public, max-age=31536000',
      // 1 year
      ETag: etag(code),
      'Cache-Tag': 'file, js-file, js-module'
    }).send(code);
  } catch (error) {
    console.error(error);
    const errorName = error.constructor.name;
    const errorMessage = error.message.replace(/^.*?\/unpkg-.+?\//, `/${req.packageSpec}/`);
    const codeFrame = error.codeFrame;
    const debugInfo = `${errorName}: ${errorMessage}\n\n${codeFrame}`;
    res.status(500).type('text').send(`Cannot generate module for ${req.packageSpec}${req.filename}\n\n${debugInfo}`);
  }
}

function serveModule(req, res) {
  if (req.entry.contentType === 'application/javascript') {
    return serveJavaScriptModule(req, res);
  }

  if (req.entry.contentType === 'text/html') {
    return serveHTMLModule(req, res);
  }

  res.status(403).type('text').send('module mode is available only for JavaScript and HTML files');
}

function createSearch(query) {
  const keys = Object.keys(query).sort();
  const pairs = keys.reduce((memo, key) => memo.concat(query[key] == null || query[key] === '' ? key : `${key}=${encodeURIComponent(query[key])}`), []);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/**
 * Reject URLs with invalid query parameters to increase cache hit rates.
 */

function allowQuery(validKeys = []) {
  if (!Array.isArray(validKeys)) {
    validKeys = [validKeys];
  }

  return (req, res, next) => {
    const keys = Object.keys(req.query);

    if (!keys.every(key => validKeys.includes(key))) {
      const newQuery = keys.filter(key => validKeys.includes(key)).reduce((query, key) => {
        query[key] = req.query[key];
        return query;
      }, {});
      return res.redirect(302, req.baseUrl + req.path + createSearch(newQuery));
    }

    next();
  };
}

function createPackageURL(packageName, packageVersion, filename, query) {
  let url = `/${packageName}`;
  if (packageVersion) url += `@${packageVersion}`;
  if (filename) url += filename;
  if (query) url += createSearch(query);
  return url;
}

function fileRedirect(req, res, entry) {
  // Redirect to the file with the extension so it's
  // clear which file is being served.
  res.set({
    'Cache-Control': 'public, max-age=31536000',
    // 1 year
    'Cache-Tag': 'redirect, file-redirect'
  }).redirect(302, req.baseUrl + createPackageURL(req.packageName, req.packageVersion, entry.path, req.query));
}

function indexRedirect(req, res, entry) {
  // Redirect to the index file so relative imports
  // resolve correctly.
  res.set({
    'Cache-Control': 'public, max-age=31536000',
    // 1 year
    'Cache-Tag': 'redirect, index-redirect'
  }).redirect(302, req.baseUrl + createPackageURL(req.packageName, req.packageVersion, entry.path, req.query));
}
/**
 * Search the given tarball for entries that match the given name.
 * Follows node's resolution algorithm.
 * https://nodejs.org/api/modules.html#modules_all_together
 */


function searchEntries(stream, filename) {
  // filename = /some/file/name.js or /some/dir/name
  return new Promise((accept, reject) => {
    const jsEntryFilename = `${filename}.js`;
    const jsonEntryFilename = `${filename}.json`;
    const matchingEntries = {};
    let foundEntry;

    if (filename === '/') {
      foundEntry = matchingEntries['/'] = {
        name: '/',
        type: 'directory'
      };
    }

    stream.pipe(tar.extract()).on('error', reject).on('entry', async (header, stream, next) => {
      const entry = {
        // Most packages have header names that look like `package/index.js`
        // so we shorten that to just `index.js` here. A few packages use a
        // prefix other than `package/`. e.g. the firebase package uses the
        // `firebase_npm/` prefix. So we just strip the first dir name.
        path: header.name.replace(/^[^/]+/g, ''),
        type: header.type
      }; // Skip non-files and files that don't match the entryName.

      if (entry.type !== 'file' || !entry.path.startsWith(filename)) {
        stream.resume();
        stream.on('end', next);
        return;
      }

      matchingEntries[entry.path] = entry; // Dynamically create "directory" entries for all directories
      // that are in this file's path. Some tarballs omit these entries
      // for some reason, so this is the "brute force" method.

      let dir = path.dirname(entry.path);

      while (dir !== '/') {
        if (!matchingEntries[dir]) {
          matchingEntries[dir] = {
            name: dir,
            type: 'directory'
          };
        }

        dir = path.dirname(dir);
      }

      if (entry.path === filename || // Allow accessing e.g. `/index.js` or `/index.json`
      // using `/index` for compatibility with npm
      entry.path === jsEntryFilename || entry.path === jsonEntryFilename) {
        if (foundEntry) {
          if (foundEntry.path !== filename && (entry.path === filename || entry.path === jsEntryFilename && foundEntry.path === jsonEntryFilename)) {
            // This entry is higher priority than the one
            // we already found. Replace it.
            delete foundEntry.content;
            foundEntry = entry;
          }
        } else {
          foundEntry = entry;
        }
      }

      try {
        const content = await bufferStream(stream);
        entry.contentType = getContentType(entry.path);
        entry.integrity = getIntegrity(content);
        entry.lastModified = header.mtime.toUTCString();
        entry.size = content.length; // Set the content only for the foundEntry and
        // discard the buffer for all others.

        if (entry === foundEntry) {
          entry.content = content;
        }

        next();
      } catch (error) {
        next(error);
      }
    }).on('finish', () => {
      accept({
        // If we didn't find a matching file entry,
        // try a directory entry with the same name.
        foundEntry: foundEntry || matchingEntries[filename] || null,
        matchingEntries: matchingEntries
      });
    });
  });
}
/**
 * Fetch and search the archive to try and find the requested file.
 * Redirect to the "index" file if a directory was requested.
 */


async function findEntry$2(req, res, next) {
  const stream = await getPackage(req.packageName, req.packageVersion, req.log);
  const {
    foundEntry: entry,
    matchingEntries: entries
  } = await searchEntries(stream, req.filename);

  if (!entry) {
    return res.status(404).set({
      'Cache-Control': 'public, max-age=31536000',
      // 1 year
      'Cache-Tag': 'missing, missing-entry'
    }).type('text').send(`Cannot find "${req.filename}" in ${req.packageSpec}`);
  }

  if (entry.type === 'file' && entry.path !== req.filename) {
    return fileRedirect(req, res, entry);
  }

  if (entry.type === 'directory') {
    // We need to redirect to some "index" file inside the directory so
    // our URLs work in a similar way to require("lib") in node where it
    // uses `lib/index.js` when `lib` is a directory.
    const indexEntry = entries[`${req.filename}/index.js`] || entries[`${req.filename}/index.json`];

    if (indexEntry && indexEntry.type === 'file') {
      return indexRedirect(req, res, indexEntry);
    }

    return res.status(404).set({
      'Cache-Control': 'public, max-age=31536000',
      // 1 year
      'Cache-Tag': 'missing, missing-index'
    }).type('text').send(`Cannot find an index in "${req.filename}" in ${req.packageSpec}`);
  }

  req.entry = entry;
  next();
}

var findEntry$3 = asyncHandler(findEntry$2);

/**
 * Strips all query params from the URL to increase cache hit rates.
 */
function noQuery() {
  return (req, res, next) => {
    const keys = Object.keys(req.query);

    if (keys.length) {
      return res.redirect(302, req.baseUrl + req.path);
    }

    next();
  };
}

/**
 * Redirect old URLs that we no longer support.
 */

function redirectLegacyURLs(req, res, next) {
  // Permanently redirect /_meta/path to /path?meta
  if (req.path.match(/^\/_meta\//)) {
    req.query.meta = '';
    return res.redirect(301, req.path.substr(6) + createSearch(req.query));
  } // Permanently redirect /path?json => /path?meta


  if (req.query.json != null) {
    delete req.query.json;
    req.query.meta = '';
    return res.redirect(301, req.path + createSearch(req.query));
  }

  next();
}

const enableDebugging = process.env.DEBUG != null;

function noop() {}

function createLog(req) {
  return {
    debug: enableDebugging ? (format, ...args) => {
      console.log(util.format(format, ...args));
    } : noop,
    info: (format, ...args) => {
      console.log(util.format(format, ...args));
    },
    error: (format, ...args) => {
      console.error(util.format(format, ...args));
    }
  };
}

function requestLog(req, res, next) {
  req.log = createLog(req);
  next();
}

function filenameRedirect(req, res) {
  let filename;

  if (req.query.module != null) {
    // See https://github.com/rollup/rollup/wiki/pkg.module
    filename = req.packageConfig.module || req.packageConfig['jsnext:main'];

    if (!filename) {
      // https://nodejs.org/api/esm.html#esm_code_package_json_code_code_type_code_field
      if (req.packageConfig.type === 'module') {
        // Use whatever is in pkg.main or index.js
        filename = req.packageConfig.main || '/index.js';
      } else if (req.packageConfig.main && /\.mjs$/.test(req.packageConfig.main)) {
        // Use .mjs file in pkg.main
        filename = req.packageConfig.main;
      }
    }

    if (!filename) {
      return res.status(404).type('text').send(`Package ${req.packageSpec} does not contain an ES module`);
    }
  } else if (req.query.main && req.packageConfig[req.query.main] && typeof req.packageConfig[req.query.main] === 'string') {
    // Deprecated, see #63
    filename = req.packageConfig[req.query.main];
  } else if (req.packageConfig.unpkg && typeof req.packageConfig.unpkg === 'string') {
    filename = req.packageConfig.unpkg;
  } else if (req.packageConfig.browser && typeof req.packageConfig.browser === 'string') {
    // Deprecated, see #63
    filename = req.packageConfig.browser;
  } else {
    filename = req.packageConfig.main || '/index.js';
  } // Redirect to the exact filename so relative imports
  // and URLs resolve correctly.


  res.set({
    'Cache-Control': 'public, max-age=31536000',
    // 1 year
    'Cache-Tag': 'redirect, filename-redirect'
  }).redirect(302, req.baseUrl + createPackageURL(req.packageName, req.packageVersion, filename.replace(/^[./]*/, '/'), req.query));
}
/**
 * Redirect to the exact filename if the request omits one.
 */


async function validateFilename(req, res, next) {
  if (!req.filename) {
    return filenameRedirect(req, res);
  }

  next();
}

const packagePathnameFormat = /^\/((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/;
function parsePackagePathname(pathname) {
  try {
    pathname = decodeURIComponent(pathname);
  } catch (error) {
    return null;
  }

  const match = packagePathnameFormat.exec(pathname); // Disallow invalid pathnames.

  if (match == null) return null;
  const packageName = match[1];
  const packageVersion = match[2] || 'latest';
  const filename = (match[3] || '').replace(/\/\/+/g, '/');
  return {
    // If the pathname is /@scope/name@version/file.js:
    packageName,
    // @scope/name
    packageVersion,
    // version
    packageSpec: `${packageName}@${packageVersion}`,
    // @scope/name@version
    filename // /file.js

  };
}

/**
 * Parse the pathname in the URL. Reject invalid URLs.
 */

function validatePackagePathname(req, res, next) {
  const parsed = parsePackagePathname(req.path);

  if (parsed == null) {
    return res.status(403).send({
      error: `Invalid URL: ${req.path}`
    });
  }

  req.packageName = parsed.packageName;
  req.packageVersion = parsed.packageVersion;
  req.packageSpec = parsed.packageSpec;
  req.filename = parsed.filename;
  next();
}

const hexValue = /^[a-f0-9]+$/i;

function isHash(value) {
  return value.length === 32 && hexValue.test(value);
}
/**
 * Reject requests for invalid npm package names.
 */


function validatePackageName(req, res, next) {
  if (isHash(req.packageName)) {
    return res.status(403).type('text').send(`Invalid package name "${req.packageName}" (cannot be a hash)`);
  }

  const errors = validateNpmPackageName(req.packageName).errors || [];

  if (process.env.UNPKG_WHITE_LIST) {
    const whiteList = process.env.UNPKG_WHITE_LIST.split(",");
    let matchWhiteList = false;
    whiteList.forEach(white => {
      if (req.packageName.indexOf(white) >= 0) matchWhiteList = true;
    });
    if (!matchWhiteList) errors.push('forbidden');
  }

  if (errors && errors.length) {
    const reason = errors.join(', ');
    return res.status(403).type('text').send(`Invalid package name "${req.packageName}" (${reason})`);
  }

  next();
}

function semverRedirect(req, res, newVersion) {
  res.set({
    'Cache-Control': 'public, s-maxage=600, max-age=60',
    // 10 mins on CDN, 1 min on clients
    'Cache-Tag': 'redirect, semver-redirect'
  }).redirect(302, req.baseUrl + createPackageURL(req.packageName, newVersion, req.filename, req.query));
}

async function resolveVersion(packageName, range, log) {
  const versionsAndTags = await getVersionsAndTags(packageName, log);

  if (versionsAndTags) {
    const {
      versions,
      tags
    } = versionsAndTags;

    if (range in tags) {
      range = tags[range];
    }

    return versions.includes(range) ? range : semver.maxSatisfying(versions, range);
  }

  return null;
}
/**
 * Check the package version/tag in the URL and make sure it's good. Also
 * fetch the package config and add it to req.packageConfig. Redirect to
 * the resolved version number if necessary.
 */


async function validateVersion(req, res, next) {
  const version = await resolveVersion(req.packageName, req.packageVersion, req.log);

  if (!version) {
    // if cache package info is enabled, remove cache file
    removePackageInfoCache(req.packageName, req.log);
    return res.status(404).type('text').send(`Cannot find package ${req.packageSpec}`);
  }

  if (version !== req.packageVersion) {
    return semverRedirect(req, res, version);
  }

  req.packageConfig = await getPackageConfig(req.packageName, req.packageVersion, req.log);

  if (!req.packageConfig) {
    return res.status(500).type('text').send(`Cannot get config for package ${req.packageSpec}`);
  }

  next();
}

var validatePackageVersion = asyncHandler(validateVersion);

function createApp(callback) {
  const app = express();
  callback(app);
  return app;
}

function createServer() {
  const app = createApp(app => {
    app.disable('x-powered-by');
    app.enable('trust proxy');
    app.enable('strict routing');

    if (process.env.NODE_ENV === 'development') {
      app.use(morgan('dev'));
    }

    app.use(cors());
    app.use(express.static('public', {
      maxAge: '1y'
    }));
    app.use(compression());
    app.use(requestLog);
    app.get('/', serveMainPage); // app.get('/api/stats', serveStats);

    app.use(redirectLegacyURLs);
    app.use('/browse', createApp(app => {
      app.enable('strict routing');
      app.get('*/', noQuery(), validatePackagePathname, validatePackageName, validatePackageVersion, serveDirectoryBrowser$1);
      app.get('*', noQuery(), validatePackagePathname, validatePackageName, validatePackageVersion, serveFileBrowser$1);
    })); // We need to route in this weird way because Express
    // doesn't have a way to route based on query params.

    const metadataApp = createApp(app => {
      app.enable('strict routing');
      app.get('*/', allowQuery('meta'), validatePackagePathname, validatePackageName, validatePackageVersion, validateFilename, serveDirectoryMetadata$1);
      app.get('*', allowQuery('meta'), validatePackagePathname, validatePackageName, validatePackageVersion, validateFilename, serveFileMetadata$1);
    });
    app.use((req, res, next) => {
      if (req.query.meta != null) {
        metadataApp(req, res);
      } else {
        next();
      }
    }); // We need to route in this weird way because Express
    // doesn't have a way to route based on query params.

    const moduleApp = createApp(app => {
      app.enable('strict routing');
      app.get('*', allowQuery('module'), validatePackagePathname, validatePackageName, validatePackageVersion, validateFilename, findEntry$3, serveModule);
    });
    app.use((req, res, next) => {
      if (req.query.module != null) {
        moduleApp(req, res);
      } else {
        next();
      }
    }); // Send old */ requests to the new /browse UI.

    app.get('*/', (req, res) => {
      res.redirect(302, req.baseUrl + '/browse' + req.url);
    });
    app.get('*', noQuery(), validatePackagePathname, validatePackageName, validatePackageVersion, validateFilename, findEntry$3, serveFile);
  });
  const serverWithBaseUrl = express();
  serverWithBaseUrl.use(getBaseUrl(), app);
  return serverWithBaseUrl;
}

module.exports = createServer;
