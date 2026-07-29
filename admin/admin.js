/* ============================================================
   admin.js — static, in-browser content editor for GitHub Pages
   ------------------------------------------------------------
   - No server. Edits data/content.json and uploads images by
     committing to your GitHub repo through the GitHub REST API.
   - The GitHub token is encrypted (AES-GCM, key derived from your
     password with PBKDF2) and stored only in this browser.
   ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'cms_admin_v1';
  var CONTENT_PATH = 'data/content.json';
  var UPLOAD_DIR = 'assets/uploads';

  var PBKDF2_ITERS = 600000;   // OWASP 2023+ for PBKDF2-SHA256; older stores are upgraded on login
  var LEGACY_ITERS = 210000;   // what stores created before this version used
  var IDLE_LOCK_MS = 15 * 60 * 1000;
  var MAX_FAILS = 5;           // wrong passwords before the login is throttled
  var LOCKOUT_MS = 30 * 1000;  // doubles for every extra failure, capped
  var MAX_LOCKOUT_MS = 15 * 60 * 1000;
  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  var LIVE_POLL_MS = 6000;
  var LIVE_POLL_TRIES = 30;    // ~3 minutes of waiting for Pages to rebuild

  // ---------------------------------------------------------
  // Schema: describes every editable field. Field types:
  //   text, textarea, html, number, url, image, bool,
  //   select{options}, group{fields}, list{itemType, fields|...}
  // ---------------------------------------------------------
  var SCHEMA = [
    { key: 'site', label: 'Site / SEO', fields: [
      { key: 'title', label: 'Browser title', type: 'text' },
      { key: 'metaDescription', label: 'Meta description', type: 'textarea' },
      { key: 'logo', label: 'Logo image', type: 'image' },
      { key: 'favicon', label: 'Favicon', type: 'image' }
    ]},
    { key: 'profile', label: 'Profile / Sidebar', fields: [
      { key: 'name', label: 'Full name', type: 'text' },
      { key: 'mobileBrand', label: 'Mobile header text', type: 'text' },
      { key: 'photo', label: 'Profile photo', type: 'image' },
      { key: 'cvFile', label: 'CV / résumé (PDF)', type: 'file',
        accept: 'application/pdf', extensions: ['.pdf'], maxBytes: 10 * 1024 * 1024 },
      { key: 'residence', label: 'Residence', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'age', label: 'Age', type: 'text' },
      { key: 'roles', label: 'Rotating roles', type: 'list', itemType: 'string', itemLabel: 'Role' },
      { key: 'sidebarSkills', label: 'Sidebar skill circles', type: 'list', itemLabel: 'Skill', fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'percent', label: 'Percent (0-100)', type: 'number' },
        { key: 'label', label: 'Displayed label', type: 'text' }
      ]}
    ]},
    { key: 'social', label: 'Social links', fields: [
      { key: 'linkedin', label: 'LinkedIn URL', type: 'url' },
      { key: 'github', label: 'GitHub URL', type: 'url' }
    ]},
    { key: 'hero', label: 'Hero / Intro', fields: [
      { key: 'badge', label: 'Badge text', type: 'text' },
      { key: 'titleLine1', label: 'Title (line 1)', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'intro', label: 'Intro paragraph (HTML allowed)', type: 'html' }
    ]},
    { key: 'about', label: 'About', fields: [
      { key: 'badge', label: 'Badge text', type: 'text' },
      { key: 'titleNormal', label: 'Title', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'bio', label: 'Bio (HTML allowed)', type: 'html' },
      { key: 'details', label: 'Detail rows', type: 'list', itemLabel: 'Row', fields: [
        { key: 'label', label: 'Label', type: 'text' },
        { key: 'value', label: 'Value', type: 'text' }
      ]},
      { key: 'counters', label: 'Stat counters', type: 'list', itemLabel: 'Counter', fields: [
        { key: 'number', label: 'Number', type: 'text' },
        { key: 'suffix', label: 'Suffix (e.g. +)', type: 'text' },
        { key: 'label', label: 'Label', type: 'text' }
      ]}
    ]},
    { key: 'services', label: 'Services', fields: [
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'titleNormal', label: 'Title', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { key: 'items', label: 'Service cards', type: 'list', itemLabel: 'Service', fields: [
        { key: 'number', label: 'Number badge (e.g. 01)', type: 'text' },
        { key: 'icon', label: 'Icon', type: 'select', options: ['web','shield','gear','strategy'] },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'desc', label: 'Description', type: 'textarea' }
      ]}
    ]},
    { key: 'skills', label: 'Skills slider', fields: [
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'titleNormal', label: 'Title', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { key: 'items', label: 'Skills', type: 'list', itemLabel: 'Skill', fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'img', label: 'Icon image', type: 'image' },
        { key: 'percent', label: 'Percent (0-100)', type: 'number' }
      ]}
    ]},
    { key: 'resume', label: 'Resume', fields: [
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'experience', label: 'Work experience', type: 'group', fields: [
        { key: 'titleNormal', label: 'Title', type: 'text' },
        { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
        { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
        { key: 'items', label: 'Jobs', type: 'list', itemLabel: 'Job', fields: [
          { key: 'company', label: 'Company', type: 'text' },
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'role', label: 'Role', type: 'text' },
          { key: 'desc', label: 'Description (use new lines)', type: 'textarea' }
        ]}
      ]},
      { key: 'education', label: 'Education', type: 'group', fields: [
        { key: 'titleNormal', label: 'Title', type: 'text' },
        { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
        { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
        { key: 'items', label: 'Entries', type: 'list', itemLabel: 'Entry', fields: [
          { key: 'school', label: 'School', type: 'text' },
          { key: 'period', label: 'Period', type: 'text' },
          { key: 'degree', label: 'Degree', type: 'text' },
          { key: 'desc', label: 'Description', type: 'textarea' }
        ]}
      ]}
    ]},
    { key: 'portfolio', label: 'Portfolio', fields: [
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'titleNormal', label: 'Title', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { key: 'moreButton', label: 'Bottom button', type: 'group', fields: [
        { key: 'text', label: 'Button text', type: 'text' },
        { key: 'href', label: 'Button link', type: 'text' }
      ]},
      { key: 'items', label: 'Projects', type: 'list', itemLabel: 'Project', fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'subtitle', label: 'Subtitle', type: 'text' },
        { key: 'tag', label: 'Tag chip', type: 'text' },
        { key: 'image', label: 'Image', type: 'image' },
        { key: 'href', label: 'Link', type: 'text' },
        { key: 'wide', label: 'Full width', type: 'bool' }
      ]}
    ]},
    { key: 'certificates', label: 'Certificates', fields: [
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'titleNormal', label: 'Title', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { key: 'moreButton', label: 'Bottom button', type: 'group', fields: [
        { key: 'text', label: 'Button text', type: 'text' },
        { key: 'href', label: 'Button link', type: 'text' }
      ]},
      { key: 'items', label: 'Certificates', type: 'list', itemLabel: 'Certificate', fields: [
        { key: 'image', label: 'Image', type: 'image' },
        { key: 'skills', label: 'Skills line', type: 'textarea' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'href', label: 'Link', type: 'text' }
      ]}
    ]},
    { key: 'ctf', label: 'CTF', fields: [
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'titleNormal', label: 'Title', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { key: 'items', label: 'CTF cards', type: 'list', itemLabel: 'Card', fields: [
        { key: 'image', label: 'Image', type: 'image' },
        { key: 'href', label: 'Link', type: 'text' },
        { key: 'label', label: 'Overlay label', type: 'text' }
      ]}
    ]},
    { key: 'contact', label: 'Contact', fields: [
      { key: 'badge', label: 'Badge', type: 'text' },
      { key: 'titleNormal', label: 'Title', type: 'text' },
      { key: 'titleHighlight', label: 'Title (highlighted)', type: 'text' },
      { key: 'subtitle', label: 'Subtitle', type: 'textarea' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'formEndpoint', label: 'Contact form endpoint (Formspree/Web3Forms URL — leave blank for mailto)', type: 'text' }
    ]},
    { key: 'footer', label: 'Footer', fields: [
      { key: 'prefix', label: 'Prefix text', type: 'text' },
      { key: 'name', label: 'Name / copyright', type: 'text' }
    ]}
  ];

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  var state = {
    cfg: null,        // {owner, repo, branch}
    token: null,      // decrypted GitHub token (memory only, never persisted in the clear)
    content: null,    // working copy being edited
    original: null,   // pristine copy as loaded, for diffing
    sha: null,        // blob sha of content.json we based our edits on
    uploads: {},      // field path -> { repoPath, base64, contentType }
    activeSection: SCHEMA[0].key,
    idleTimer: null,
    publishing: false
  };

  var $ = function (id) { return document.getElementById(id); };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = 'toast'; }, isError ? 6000 : 3500);
  }

  function show(view) {
    ['setup', 'login'].forEach(function (v) { $(v).style.display = 'none'; });
    $('app').style.display = 'none';
    if (view === 'app') $('app').style.display = 'grid';
    else $(view).style.display = 'flex';
  }

  function modal(id, on) { $(id).className = 'modal-bg' + (on ? ' on' : ''); }

  // Publish-status pill: kind is 'busy' | 'live' | 'fail' | null (hidden)
  function status(kind, text) {
    var p = $('pill');
    if (!kind) { p.className = 'pill'; return; }
    p.className = 'pill on ' + kind;
    $('pillText').textContent = text;
  }

  function isDirty() {
    if (!state.original) return false;
    if (Object.keys(state.uploads).length) return true;
    return JSON.stringify(state.content) !== JSON.stringify(state.original);
  }
  function refreshDirty() {
    $('dirtyDot').className = 'dirty-dot' + (isDirty() ? ' on' : '');
  }

  // ---------------------------------------------------------
  // Crypto helpers (Web Crypto API)
  // ---------------------------------------------------------
  var enc = new TextEncoder();
  var dec = new TextDecoder();

  function b64(bytes) {
    var bin = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }
  function unb64(str) {
    var bin = atob(str);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function utf8ToB64(str) { return b64(enc.encode(str)); }

  function deriveKey(password, salt, iters) {
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iters || PBKDF2_ITERS, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function encryptStr(key, plaintext) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext))
      .then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }
  function decryptStr(key, blob) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct))
      .then(function (pt) { return dec.decode(pt); });
  }

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; }
  }
  function saveStore(obj) { localStorage.setItem(LS_KEY, JSON.stringify(obj)); }

  // ---------------------------------------------------------
  // GitHub API
  // ---------------------------------------------------------
  function gh(path, opts) {
    opts = opts || {};
    var url = 'https://api.github.com/repos/' + state.cfg.owner + '/' + state.cfg.repo + '/' + path;
    return fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + state.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  }

  // Same as gh(), but rejects with GitHub's own error message on failure.
  function ghJSON(path, opts) {
    return gh(path, opts).then(function (r) {
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        var msg = (j && j.message) || ('HTTP ' + r.status);
        if (r.status === 401) msg = 'Token rejected (401) — it may have expired. Use "Reset / change token".';
        if (r.status === 403) msg = 'Token lacks permission (403). It needs Contents: Read and write on this repo.';
        var e = new Error(msg); e.status = r.status; throw e;
      });
    });
  }

  // Confirms, before we store anything, that the token really can write here.
  function validateAccess(cfg, token) {
    var base = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo;
    var headers = {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    return fetch(base, { headers: headers }).then(function (r) {
      if (r.status === 401) throw new Error('GitHub rejected the token. Check you pasted it whole and it has not expired.');
      if (r.status === 404) throw new Error('Repo ' + cfg.owner + '/' + cfg.repo + ' not found, or the token has no access to it.');
      if (!r.ok) throw new Error('GitHub error ' + r.status + ' while checking the repository.');
      return r.json();
    }).then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) {
        throw new Error('This token can read the repo but not write to it. Give it Contents: Read and write.');
      }
      return fetch(base + '/branches/' + encodeURIComponent(cfg.branch), { headers: headers });
    }).then(function (r) {
      if (r.status === 404) throw new Error('Branch "' + cfg.branch + '" does not exist in that repository.');
      if (!r.ok) throw new Error('GitHub error ' + r.status + ' while checking the branch.');
    });
  }

  function getContentFile() {
    return gh('contents/' + CONTENT_PATH + '?ref=' + encodeURIComponent(state.cfg.branch))
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('GitHub GET failed (' + r.status + ')');
        return r.json();
      });
  }

  // ---- Atomic publish via the Git Data API -------------------------------
  // Images and content.json land in ONE commit, so the live site can never be
  // caught half-updated (content pointing at an image that isn't pushed yet).
  function publishCommit(files, message) {
    var ref = 'heads/' + state.cfg.branch;
    var baseCommitSha, baseTreeSha;

    return ghJSON('git/ref/' + ref).then(function (r) {
      baseCommitSha = r.object.sha;
      return ghJSON('git/commits/' + baseCommitSha);
    }).then(function (c) {
      baseTreeSha = c.tree.sha;
      // Upload every file as a blob first; blobs are inert until referenced.
      return files.reduce(function (chain, f) {
        return chain.then(function (acc) {
          return ghJSON('git/blobs', { method: 'POST', body: { content: f.base64, encoding: 'base64' } })
            .then(function (b) { acc.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha }); return acc; });
        });
      }, Promise.resolve([]));
    }).then(function (tree) {
      return ghJSON('git/trees', { method: 'POST', body: { base_tree: baseTreeSha, tree: tree } });
    }).then(function (t) {
      return ghJSON('git/commits', { method: 'POST', body: { message: message, tree: t.sha, parents: [baseCommitSha] } });
    }).then(function (commit) {
      // force:false — if someone else pushed meanwhile, this fails instead of
      // silently discarding their commit.
      return ghJSON('git/refs/' + ref, { method: 'PATCH', body: { sha: commit.sha, force: false } })
        .then(function () { return commit; })
        .catch(function (e) {
          throw new Error('Could not update the branch — the repo changed while you were editing. ' +
            'Reload the editor and redo your edits. (' + e.message + ')');
        });
    });
  }

  function listVersions() {
    return ghJSON('commits?path=' + encodeURIComponent(CONTENT_PATH) +
      '&sha=' + encodeURIComponent(state.cfg.branch) + '&per_page=15');
  }

  function getContentAt(commitSha) {
    return ghJSON('contents/' + CONTENT_PATH + '?ref=' + encodeURIComponent(commitSha))
      .then(function (f) { return JSON.parse(dec.decode(unb64(f.content.replace(/\n/g, '')))); });
  }

  // ---------------------------------------------------------
  // Path helpers on the working content object
  // ---------------------------------------------------------
  function getAt(path) {
    return path.split('.').reduce(function (acc, k) { return acc == null ? undefined : acc[k]; }, state.content);
  }
  function setAt(path, value) {
    var parts = path.split('.');
    var last = parts.pop();
    var obj = parts.reduce(function (acc, k) {
      if (acc[k] == null || typeof acc[k] !== 'object') acc[k] = {};
      return acc[k];
    }, state.content);
    obj[last] = value;
    refreshDirty();
  }

  // ---------------------------------------------------------
  // Form rendering
  // ---------------------------------------------------------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function renderField(field, path) {
    var value = getAt(path);

    if (field.type === 'group') {
      var box = el('div', { class: 'section-card' }, [ el('h3', {}, [field.label]) ]);
      field.fields.forEach(function (f) { box.appendChild(renderField(f, path + '.' + f.key)); });
      return box;
    }

    if (field.type === 'list') return renderList(field, path);

    if (field.type === 'image') return renderImage(field, path, value);

    if (field.type === 'file') return renderFile(field, path, value);

    // Simple fields
    var wrap = el('label', { class: 'field' }, [ el('span', { class: 'lbl' }, [field.label]) ]);
    var input;
    if (field.type === 'textarea' || field.type === 'html') {
      input = el('textarea', {});
      input.value = value == null ? '' : value;
      if (field.type === 'html') input.style.minHeight = '120px';
    } else if (field.type === 'bool') {
      wrap = el('label', { class: 'field switch' });
      input = el('input', { type: 'checkbox' });
      input.checked = !!value;
      wrap.appendChild(input);
      wrap.appendChild(el('span', { class: 'lbl', style: 'margin:0' }, [field.label]));
      input.addEventListener('change', function () { setAt(path, input.checked); });
      return wrap;
    } else if (field.type === 'select') {
      input = el('select', {});
      (field.options || []).forEach(function (opt) {
        var o = el('option', { value: opt }, [opt]);
        if (opt === value) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = el('input', { type: field.type === 'number' ? 'number' : (field.type === 'url' ? 'url' : 'text') });
      input.value = value == null ? '' : value;
    }
    input.addEventListener('input', function () {
      var v = input.value;
      if (field.type === 'number') v = v === '' ? '' : Number(v);
      setAt(path, v);
    });
    input.addEventListener('change', function () {
      var v = input.value;
      if (field.type === 'number') v = v === '' ? '' : Number(v);
      setAt(path, v);
    });
    wrap.appendChild(input);
    if (field.type === 'html') wrap.appendChild(el('div', { class: 'hint' }, ['Basic HTML is allowed here (e.g. <span>, <strong>).']));
    return wrap;
  }

  function renderImage(field, path, value) {
    var wrap = el('label', { class: 'field' }, [ el('span', { class: 'lbl' }, [field.label]) ]);
    var row = el('div', { class: 'img-field' });
    var img = el('img', { class: 'preview', alt: '' });
    setPreview(img, value);

    var controls = el('div', { class: 'img-controls' });
    var pathInput = el('input', { type: 'text', placeholder: 'assets/img/...' });
    pathInput.value = value == null ? '' : value;
    pathInput.addEventListener('input', function () {
      setAt(path, pathInput.value);
      setPreview(img, pathInput.value);
      delete state.uploads[path]; // typing a path cancels a queued upload for this field
    });

    var file = el('input', { type: 'file', accept: 'image/*' });
    file.style.marginTop = '.5rem';
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) {
        toast('That is not an image file.', true); file.value = ''; return;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        toast('Image is ' + (f.size / 1048576).toFixed(1) + ' MB — the limit is 5 MB. Resize it first.', true);
        file.value = ''; return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        var comma = dataUrl.indexOf(',');
        var base64 = dataUrl.slice(comma + 1);
        var safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        var repoPath = UPLOAD_DIR + '/' + Date.now() + '-' + safe;
        state.uploads[path] = { repoPath: repoPath, base64: base64, contentType: f.type };
        setAt(path, repoPath);
        pathInput.value = repoPath;
        img.src = dataUrl;
        toast('Image queued — it will be committed when you Save.');
      };
      reader.readAsDataURL(f);
    });

    controls.appendChild(pathInput);
    controls.appendChild(el('div', { class: 'hint' }, ['Type an existing path, or upload a new image (added to ' + UPLOAD_DIR + '/ on save).']));
    controls.appendChild(file);
    row.appendChild(img);
    row.appendChild(controls);
    wrap.appendChild(row);
    return wrap;
  }

  // Documents (the CV) ride the same pipeline as images: queued in
  // state.uploads, then committed atomically with content.json on publish.
  // Kept separate from renderImage because there is nothing to preview and
  // the accepted types differ.
  function renderFile(field, path, value) {
    var wrap = el('label', { class: 'field' }, [ el('span', { class: 'lbl' }, [field.label]) ]);
    var row = el('div', { class: 'file-field' });
    var maxBytes = field.maxBytes || MAX_UPLOAD_BYTES;
    var exts = field.extensions || [];

    var current = el('div', { class: 'file-current' });

    function showCurrent(v, pending) {
      current.innerHTML = '';
      if (!v) {
        current.appendChild(el('span', { class: 'muted' }, ['No file set']));
        return;
      }
      var name = String(v).split('/').pop();
      if (pending) {
        // Not on the site yet, so a link would 404 until they publish.
        current.appendChild(el('span', { class: 'file-name' }, [name]));
        current.appendChild(el('span', { class: 'pending' }, ['queued — publish to go live']));
        return;
      }
      var href = /^https?:|^data:/.test(v) ? v : '../' + v;
      current.appendChild(el('a', {
        class: 'file-name', href: href, target: '_blank', rel: 'noopener noreferrer'
      }, [name]));
      current.appendChild(el('span', { class: 'muted' }, ['currently live']));
    }
    showCurrent(value, false);

    var controls = el('div', { class: 'img-controls' });
    var pathInput = el('input', { type: 'text', placeholder: 'mycv.pdf' });
    pathInput.value = value == null ? '' : value;
    pathInput.addEventListener('input', function () {
      setAt(path, pathInput.value);
      delete state.uploads[path]; // typing a path cancels a queued upload
      showCurrent(pathInput.value, false);
    });

    var file = el('input', { type: 'file', accept: field.accept || '' });
    file.style.marginTop = '.5rem';
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;

      // The extension is the real gate. Platforms label PDFs inconsistently
      // (application/pdf, application/x-pdf, application/acrobat), so an exact
      // MIME match would reject valid files; the reported type is only used to
      // catch something obviously different, like an image renamed to .pdf.
      var lower = f.name.toLowerCase();
      var extOk = !exts.length || exts.some(function (e) { return lower.slice(-e.length) === e; });
      // Compare only the top-level type ("application"), which every PDF
      // label shares, so an image renamed to .pdf is still caught.
      var want = (field.accept || '').split('/')[0];
      var got = (f.type || '').split('/')[0].toLowerCase();
      var typeOk = !field.accept || !f.type || got === want;
      if (!extOk || !typeOk) {
        toast('That is not a ' + (exts.join(' / ') || 'valid') + ' file.', true);
        file.value = ''; return;
      }
      if (f.size > maxBytes) {
        toast('That file is ' + (f.size / 1048576).toFixed(1) + ' MB — the limit is ' +
              Math.round(maxBytes / 1048576) + ' MB.', true);
        file.value = ''; return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result);
        var comma = dataUrl.indexOf(',');
        if (comma < 0) { toast('Could not read that file.', true); file.value = ''; return; }
        var base64 = dataUrl.slice(comma + 1);
        var safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        // Timestamped so a re-upload never collides with the old one and
        // visitors are never served a cached copy of the previous CV.
        var repoPath = UPLOAD_DIR + '/' + Date.now() + '-' + safe;
        state.uploads[path] = {
          repoPath: repoPath, base64: base64,
          contentType: f.type || 'application/octet-stream'
        };
        setAt(path, repoPath);
        pathInput.value = repoPath;
        showCurrent(repoPath, true);
        toast('File queued — it goes live when you publish.');
      };
      reader.onerror = function () { toast('Could not read that file.', true); file.value = ''; };
      reader.readAsDataURL(f);
    });

    controls.appendChild(current);
    controls.appendChild(pathInput);
    controls.appendChild(el('div', { class: 'hint' }, [
      'Upload a new PDF to replace it (added to ' + UPLOAD_DIR + '/ on publish), ' +
      'or type a path / URL directly. The old file stays in the repo.'
    ]));
    controls.appendChild(file);
    row.appendChild(controls);
    wrap.appendChild(row);
    return wrap;
  }

  function setPreview(img, value) {
    if (!value) { img.style.visibility = 'hidden'; return; }
    img.style.visibility = 'visible';
    // admin lives in /admin, site assets are one level up
    img.src = /^https?:|^data:/.test(value) ? value : '../' + value;
    img.onerror = function () { img.style.visibility = 'hidden'; };
  }

  function renderList(field, path) {
    var arr = getAt(path);
    if (!Array.isArray(arr)) { arr = []; setAt(path, arr); }

    var box = el('div', { class: 'section-card' });
    box.appendChild(el('h3', {}, [field.label]));
    var listHost = el('div', {});
    box.appendChild(listHost);

    function redraw() {
      listHost.innerHTML = '';
      arr.forEach(function (_, idx) {
        listHost.appendChild(renderListItem(field, path, idx, arr, redraw));
      });
    }

    var addBtn = el('button', { class: 'btn-ghost btn-sm' }, ['+ Add ' + (field.itemLabel || 'item')]);
    addBtn.addEventListener('click', function () {
      arr.push(field.itemType === 'string' ? '' : blankItem(field.fields));
      redraw(); refreshDirty();
    });
    box.appendChild(addBtn);
    redraw();
    return box;
  }

  function renderListItem(field, path, idx, arr, redraw) {
    var item = el('div', { class: 'list-item' });
    var head = el('div', { class: 'item-head' });
    head.appendChild(el('span', { class: 'ttl' }, [(field.itemLabel || 'Item') + ' ' + (idx + 1)]));

    var up = el('button', { class: 'btn-ghost btn-sm', title: 'Move up' }, ['↑']);
    var down = el('button', { class: 'btn-ghost btn-sm', title: 'Move down' }, ['↓']);
    var del = el('button', { class: 'btn-danger btn-sm', title: 'Remove' }, ['Delete']);
    up.addEventListener('click', function () { if (idx > 0) { swap(arr, idx, idx - 1); redraw(); refreshDirty(); } });
    down.addEventListener('click', function () { if (idx < arr.length - 1) { swap(arr, idx, idx + 1); redraw(); refreshDirty(); } });
    del.addEventListener('click', function () {
      if (!confirm('Delete this ' + (field.itemLabel || 'item').toLowerCase() + '? It disappears from the live site when you publish.')) return;
      arr.splice(idx, 1); redraw(); refreshDirty();
    });
    head.appendChild(up); head.appendChild(down); head.appendChild(del);
    item.appendChild(head);

    if (field.itemType === 'string') {
      var input = el('input', { type: 'text' });
      input.value = arr[idx] == null ? '' : arr[idx];
      input.addEventListener('input', function () { arr[idx] = input.value; });
      item.appendChild(input);
    } else {
      var grid = el('div', { class: 'grid2' });
      field.fields.forEach(function (f) {
        // image / textarea / html span both columns for readability
        var node = renderField(f, path + '.' + idx + '.' + f.key);
        if (f.type === 'image' || f.type === 'file' || f.type === 'textarea' || f.type === 'html') node.style.gridColumn = '1 / -1';
        grid.appendChild(node);
      });
      item.appendChild(grid);
    }
    return item;
  }

  function swap(arr, a, b) { var t = arr[a]; arr[a] = arr[b]; arr[b] = t; }

  function blankItem(fields) {
    var o = {};
    (fields || []).forEach(function (f) {
      o[f.key] = f.type === 'bool' ? false : (f.type === 'number' ? 0 : (f.type === 'group' ? {} : (f.type === 'list' ? [] : '')));
    });
    return o;
  }

  // ---------------------------------------------------------
  // App shell
  // ---------------------------------------------------------
  function buildNav() {
    var nav = $('nav');
    nav.innerHTML = '';
    SCHEMA.forEach(function (sec) {
      var b = el('button', { class: 'nav-item' + (sec.key === state.activeSection ? ' active' : '') }, [sec.label]);
      b.addEventListener('click', function () { state.activeSection = sec.key; buildNav(); renderSection(); });
      nav.appendChild(b);
    });
  }

  function renderSection() {
    var sec = SCHEMA.filter(function (s) { return s.key === state.activeSection; })[0];
    $('sectionTitle').textContent = 'Editing — ' + sec.label;
    var root = $('formRoot');
    root.innerHTML = '';
    var card = el('div', { class: 'section-card' });
    card.appendChild(el('h2', {}, [sec.label]));
    sec.fields.forEach(function (f) {
      if (f.type === 'group' || f.type === 'list') return; // these render their own card
      card.appendChild(renderField(f, sec.key + '.' + f.key));
    });
    if (card.querySelectorAll('label.field, .switch').length) root.appendChild(card);
    sec.fields.forEach(function (f) {
      if (f.type === 'group' || f.type === 'list') root.appendChild(renderField(f, sec.key + '.' + f.key));
    });
  }

  function startApp() {
    show('app');
    $('repoInfo').textContent = state.cfg.owner + '/' + state.cfg.repo + ' · ' + state.cfg.branch;
    buildNav();
    renderSection();
    refreshDirty();
    status(null);
    touchIdle();
  }

  // ---------------------------------------------------------
  // Load content from GitHub (authoritative) with local fallback
  // ---------------------------------------------------------
  function loadContent() {
    toast('Loading current content…');
    return getContentFile().then(function (file) {
      if (file && file.content) {
        state.sha = file.sha;
        var json = dec.decode(unb64(file.content.replace(/\n/g, '')));
        state.content = JSON.parse(json);
      } else {
        state.sha = null;
        state.content = {};
      }
      state.original = clone(state.content);
    }).catch(function (err) {
      // Fall back to the published file so the editor still opens.
      return fetch('../' + CONTENT_PATH + '?v=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          state.content = data; state.original = clone(data); state.sha = null;
          toast('Loaded local copy (could not reach GitHub: ' + err.message + ')', true);
        });
    });
  }

  // ---------------------------------------------------------
  // Save: commit images, then content.json
  // ---------------------------------------------------------
  // Human-readable list of what changed, so nothing goes live unreviewed.
  function labelFor(topKey) {
    var s = SCHEMA.filter(function (x) { return x.key === topKey; })[0];
    return s ? s.label : topKey;
  }

  function describe(v) {
    if (v === undefined) return '(empty)';
    if (v === null) return 'nothing';
    if (Array.isArray(v)) return v.length + ' item' + (v.length === 1 ? '' : 's');
    if (typeof v === 'object') return 'a group of settings';
    var s = String(v);
    if (s === '') return '(empty)';
    return s.length > 70 ? '"' + s.slice(0, 70) + '…"' : '"' + s + '"';
  }

  function diff(a, b, path, out) {
    var isObj = function (x) { return x && typeof x === 'object' && !Array.isArray(x); };
    if (isObj(a) && isObj(b)) {
      var keys = Object.keys(a).concat(Object.keys(b)).filter(function (k, i, arr) { return arr.indexOf(k) === i; });
      keys.forEach(function (k) { diff(a[k], b[k], path.concat(k), out); });
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        out.push({ path: path, what: a.length + ' → ' + b.length + ' items' });
      }
      for (var i = 0; i < Math.max(a.length, b.length); i++) diff(a[i], b[i], path.concat(String(i + 1)), out);
      return out;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ path: path, what: describe(a) + '  →  ' + describe(b) });
    }
    return out;
  }

  function changeList() {
    var raw = diff(state.original || {}, state.content || {}, [], []);
    // Collapse to a readable "Section › field › 2" trail.
    return raw.map(function (c) {
      var trail = c.path.slice();
      if (trail.length) trail[0] = labelFor(trail[0]);
      return { label: trail.join(' › ') || 'content', what: c.what };
    });
  }

  function openReview() {
    if (state.publishing) return;
    var changes = changeList();
    var uploads = Object.keys(state.uploads).map(function (k) { return state.uploads[k].repoPath; });
    var body = $('reviewBody');
    body.innerHTML = '';

    if (!changes.length && !uploads.length) {
      $('reviewSummary').textContent = 'Nothing has changed since you loaded the editor.';
      $('reviewGo').disabled = true;
    } else {
      $('reviewSummary').textContent = changes.length + ' change' + (changes.length === 1 ? '' : 's') +
        (uploads.length ? ' and ' + uploads.length + ' new file' + (uploads.length === 1 ? '' : 's') : '') +
        ' will go live on your site.';
      $('reviewGo').disabled = false;
      changes.slice(0, 200).forEach(function (c) {
        body.appendChild(el('div', { class: 'change' }, [
          el('strong', {}, [c.label]), el('div', { class: 'what' }, [c.what])
        ]));
      });
      uploads.forEach(function (p) {
        var kind = /\.pdf$/i.test(p) ? 'New document' : 'New image';
        body.appendChild(el('div', { class: 'change' }, [
          el('strong', {}, [kind]), el('div', { class: 'what' }, [p])
        ]));
      });
    }
    modal('reviewModal', true);
  }

  function publish() {
    modal('reviewModal', false);
    var btn = $('save');
    state.publishing = true;
    btn.disabled = true; btn.textContent = 'Publishing…';
    status('busy', 'Committing…');

    // Stamp the revision so we can tell when the live site has caught up.
    var rev = new Date().toISOString();
    state.content._rev = rev;

    var files = Object.keys(state.uploads).map(function (k) {
      return { path: state.uploads[k].repoPath, base64: state.uploads[k].base64 };
    });
    files.push({ path: CONTENT_PATH, base64: utf8ToB64(JSON.stringify(state.content, null, 2) + '\n') });

    var msg = 'admin: update site content' + (files.length > 1 ? ' (+' + (files.length - 1) + ' file)' : '');

    // Someone editing from another device would silently lose their work, so
    // check content.json hasn't moved under us before writing.
    getContentFile().then(function (file) {
      if (state.sha && file && file.sha !== state.sha) {
        throw new Error('The site content was changed somewhere else since you opened the editor. ' +
          'Reload this page to get the latest version before publishing.');
      }
      return publishCommit(files, msg);
    }).then(function () {
      state.uploads = {};
      state.original = clone(state.content);
      refreshDirty();
      btn.disabled = false; btn.textContent = 'Review & publish';
      renderSection();
      return getContentFile().then(function (f) { if (f) state.sha = f.sha; });
    }).then(function () {
      return waitForLive(rev);
    }).catch(function (err) {
      status('fail', 'Publish failed');
      btn.disabled = false; btn.textContent = 'Review & publish';
      toast('Publish failed: ' + err.message, true);
    }).then(function () { state.publishing = false; });
  }

  // Poll the real published file until GitHub Pages serves the new revision.
  function waitForLive(rev) {
    // On localhost "../data/content.json" is the local file, not the deployed
    // one, so there is nothing meaningful to wait for.
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:') {
      status('live', 'Committed to GitHub');
      toast('Committed. GitHub Pages will rebuild in about a minute.');
      return Promise.resolve();
    }
    status('busy', 'Waiting for the site to rebuild…');
    var tries = 0;
    return new Promise(function (resolve) {
      (function poll() {
        fetch('../' + CONTENT_PATH + '?v=' + Date.now(), { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (live) {
            if (live && live._rev === rev) {
              status('live', 'Live on your site ✓');
              toast('Published — your changes are live.');
              return resolve();
            }
            next();
          })
          .catch(next);
        function next() {
          if (++tries >= LIVE_POLL_TRIES) {
            status('live', 'Committed — rebuild pending');
            toast('Saved to GitHub. The live site is taking longer than usual to rebuild; check again shortly.');
            return resolve();
          }
          setTimeout(poll, LIVE_POLL_MS);
        }
      })();
    });
  }

  // ---------------------------------------------------------
  // Version history / rollback
  // ---------------------------------------------------------
  function openHistory() {
    var body = $('histBody');
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'muted' }, ['Loading…']));
    modal('histModal', true);

    listVersions().then(function (commits) {
      body.innerHTML = '';
      if (!commits || !commits.length) {
        body.appendChild(el('p', { class: 'muted' }, ['No history yet.']));
        return;
      }
      commits.forEach(function (c, i) {
        var when = new Date(c.commit.author.date).toLocaleString();
        var row = el('div', { class: 'ver' });
        row.appendChild(el('div', { class: 'meta' }, [
          el('div', {}, [c.commit.message.split('\n')[0]]),
          el('div', { class: 'when' }, [when + (i === 0 ? ' — current' : '')])
        ]));
        if (i > 0) {
          var btn = el('button', { class: 'btn-ghost btn-sm' }, ['Load']);
          btn.addEventListener('click', function () {
            if (isDirty() && !confirm('You have unpublished changes that will be discarded. Continue?')) return;
            btn.disabled = true; btn.textContent = 'Loading…';
            getContentAt(c.sha).then(function (data) {
              state.content = data;
              modal('histModal', false);
              renderSection();
              refreshDirty();
              toast('Loaded the version from ' + when + '. Review it, then publish to make it live.');
            }).catch(function (e) {
              btn.disabled = false; btn.textContent = 'Load';
              toast('Could not load that version: ' + e.message, true);
            });
          });
          row.appendChild(btn);
        }
        body.appendChild(row);
      });
    }).catch(function (e) {
      body.innerHTML = '';
      body.appendChild(el('p', { class: 'err' }, ['Could not load history: ' + e.message]));
    });
  }

  // ---------------------------------------------------------
  // Auth flows
  // ---------------------------------------------------------
  function doSetup() {
    var btn = $('su_btn');
    var p1 = $('su_pass').value, p2 = $('su_pass2').value;
    var owner = $('su_owner').value.trim(), repo = $('su_repo').value.trim();
    var branch = $('su_branch').value.trim() || 'main', token = $('su_token').value.trim();
    var err = $('su_err'); err.textContent = '';
    if (p1.length < 12) { err.textContent = 'Password must be at least 12 characters.'; return; }
    if (p1 !== p2) { err.textContent = 'Passwords do not match.'; return; }
    if (!owner || !repo || !token) { err.textContent = 'Owner, repo and token are required.'; return; }

    var cfg = { owner: owner, repo: repo, branch: branch };
    btn.disabled = true; btn.textContent = 'Checking token…';

    // Verify the token works *before* saving it, so a typo fails here rather
    // than at the first publish.
    validateAccess(cfg, token).then(function () {
      btn.textContent = 'Encrypting…';
      var salt = crypto.getRandomValues(new Uint8Array(16));
      return deriveKey(p1, salt, PBKDF2_ITERS).then(function (key) {
        return Promise.all([ encryptStr(key, 'CMS_OK'), encryptStr(key, token) ]).then(function (res) {
          saveStore({ salt: b64(salt), iters: PBKDF2_ITERS, verify: res[0], token: res[1],
            owner: owner, repo: repo, branch: branch, fails: 0 });
          state.cfg = cfg;
          state.token = token;
          $('su_pass').value = $('su_pass2').value = $('su_token').value = '';
          return loadContent().then(startApp);
        });
      });
    }).catch(function (e) {
      err.textContent = e.message;
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Verify token & continue';
    });
  }

  function lockoutLeft(store) {
    return store && store.lockUntil ? store.lockUntil - Date.now() : 0;
  }

  function doLogin() {
    var store = loadStore();
    var pass = $('li_pass').value;
    var err = $('li_err'); err.textContent = '';
    if (!store) { show('setup'); return; }

    var wait = lockoutLeft(store);
    if (wait > 0) {
      err.textContent = 'Too many wrong attempts. Try again in ' + Math.ceil(wait / 1000) + 's.';
      return;
    }

    var btn = $('li_btn');
    btn.disabled = true; btn.textContent = 'Unlocking…';
    var iters = store.iters || LEGACY_ITERS;

    // Only decryption failure means "wrong password" — anything that goes
    // wrong afterwards (network, GitHub) must not burn a login attempt.
    var unwrap = deriveKey(pass, unb64(store.salt), iters).then(function (key) {
      return decryptStr(key, store.verify).then(function (v) {
        if (v !== 'CMS_OK') throw new Error('bad');
        return decryptStr(key, store.token);
      });
    });

    unwrap.catch(function () {
      var s = loadStore() || store;
      s.fails = (s.fails || 0) + 1;
      if (s.fails >= MAX_FAILS) {
        var pow = Math.min(s.fails - MAX_FAILS, 6);
        var delay = Math.min(LOCKOUT_MS * Math.pow(2, pow), MAX_LOCKOUT_MS);
        s.lockUntil = Date.now() + delay;
        err.textContent = 'Incorrect password. Locked for ' + Math.ceil(delay / 1000) + 's.';
      } else {
        err.textContent = 'Incorrect password. ' + (MAX_FAILS - s.fails) + ' attempts left before a lockout.';
      }
      saveStore(s);
    });

    unwrap.then(function (token) {
      store.fails = 0; delete store.lockUntil; saveStore(store);
      state.cfg = { owner: store.owner, repo: store.repo, branch: store.branch };
      state.token = token;
      $('li_pass').value = '';
      // Old stores used weaker key stretching — silently re-wrap at the
      // current strength now that we know the password is right.
      if (iters < PBKDF2_ITERS) upgradeStore(pass, token, store);
      return loadContent().then(startApp).catch(function (e) {
        err.textContent = 'Signed in, but the editor could not load: ' + e.message;
        show('login');
      });
    }).catch(function () { /* already reported above */ })
      .then(function () { btn.disabled = false; btn.textContent = 'Unlock'; });
  }

  function upgradeStore(pass, token, store) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    deriveKey(pass, salt, PBKDF2_ITERS).then(function (key) {
      return Promise.all([ encryptStr(key, 'CMS_OK'), encryptStr(key, token) ]).then(function (res) {
        store.salt = b64(salt); store.iters = PBKDF2_ITERS;
        store.verify = res[0]; store.token = res[1];
        saveStore(store);
      });
    }).catch(function () { /* keep the working store if the upgrade fails */ });
  }

  // ---------------------------------------------------------
  // Auto-lock: drop the token from memory after inactivity
  // ---------------------------------------------------------
  function lock(reason) {
    state.token = null; state.content = null; state.original = null; state.uploads = {};
    clearTimeout(state.idleTimer);
    modal('reviewModal', false); modal('histModal', false);
    status(null);
    $('li_pass').value = '';
    show('login');
    if (reason) $('li_err').textContent = reason;
  }

  function touchIdle() {
    if (!state.token) return;
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(function () {
      if (state.publishing) { touchIdle(); return; }   // never interrupt a publish
      lock('Locked automatically after 15 minutes of inactivity.');
    }, IDLE_LOCK_MS);
  }

  // ---------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------
  function init() {
    // Never allow the editor to be framed — a hidden iframe could bait clicks
    // onto the publish button.
    if (window.top !== window.self) {
      document.body.innerHTML = '<div class="center"><div class="card"><h2>Blocked</h2>' +
        '<p class="muted">The admin cannot be opened inside a frame.</p></div></div>';
      return;
    }

    if (!window.crypto || !crypto.subtle) {
      document.body.innerHTML = '<div class="center"><div class="card"><h2>Unsupported</h2>' +
        '<p class="muted">This admin needs a modern browser over HTTPS (or localhost).</p></div></div>';
      return;
    }

    // Ask the browser to keep this site's stored login (best effort). This
    // helps prevent the encrypted token from being evicted; it does NOT
    // override a manual "clear cookies/site data on close" setting or a
    // private window — for those, add a site-data exception in the browser.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
    $('su_btn').addEventListener('click', doSetup);
    $('li_btn').addEventListener('click', doLogin);
    $('li_pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('reset').addEventListener('click', function () {
      if (!confirm('Reset this browser? This removes the saved login and encrypted token from THIS device only. Your live site is untouched. You will need your GitHub token to set up again.')) return;
      localStorage.removeItem(LS_KEY);
      lock();
      toast('Local data cleared.');
      show('setup');
    });
    $('logout').addEventListener('click', function () {
      if (isDirty() && !confirm('You have unpublished changes. Lock anyway and lose them?')) return;
      lock();
    });
    $('save').addEventListener('click', openReview);
    $('reviewCancel').addEventListener('click', function () { modal('reviewModal', false); });
    $('reviewGo').addEventListener('click', publish);
    $('history').addEventListener('click', openHistory);
    $('histClose').addEventListener('click', function () { modal('histModal', false); });

    // Click the dimmed backdrop or press Escape to dismiss a modal.
    ['reviewModal', 'histModal'].forEach(function (id) {
      $(id).addEventListener('click', function (e) { if (e.target === $(id)) modal(id, false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { modal('reviewModal', false); modal('histModal', false); }
    });

    // Reset the auto-lock countdown on any real interaction.
    ['mousedown', 'keydown', 'touchstart', 'focus'].forEach(function (ev) {
      document.addEventListener(ev, touchIdle, true);
    });

    window.addEventListener('beforeunload', function (e) {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';   // browsers show their own "leave site?" prompt
      return '';
    });

    show(loadStore() ? 'login' : 'setup');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
