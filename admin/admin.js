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
      { key: 'cvFile', label: 'CV file (path or URL)', type: 'text' },
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
    token: null,      // decrypted GitHub token (memory only)
    content: null,    // working copy being edited
    sha: null,        // sha of content.json on GitHub
    uploads: {},      // path -> { base64, contentType }
    activeSection: SCHEMA[0].key
  };

  var $ = function (id) { return document.getElementById(id); };

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

  function deriveKey(password, salt) {
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 210000, hash: 'SHA-256' },
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

  function getContentFile() {
    return gh('contents/' + CONTENT_PATH + '?ref=' + encodeURIComponent(state.cfg.branch))
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('GitHub GET failed (' + r.status + ')');
        return r.json();
      });
  }

  function putFile(path, base64Content, message, sha) {
    var body = { message: message, content: base64Content, branch: state.cfg.branch };
    if (sha) body.sha = sha;
    return gh('contents/' + path, { method: 'PUT', body: body })
      .then(function (r) {
        if (!r.ok) {
          return r.json().catch(function(){return {};}).then(function (j) {
            throw new Error((j && j.message) || ('PUT ' + path + ' failed (' + r.status + ')'));
          });
        }
        return r.json();
      });
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
      redraw();
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
    up.addEventListener('click', function () { if (idx > 0) { swap(arr, idx, idx - 1); redraw(); } });
    down.addEventListener('click', function () { if (idx < arr.length - 1) { swap(arr, idx, idx + 1); redraw(); } });
    del.addEventListener('click', function () { arr.splice(idx, 1); redraw(); });
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
        if (f.type === 'image' || f.type === 'textarea' || f.type === 'html') node.style.gridColumn = '1 / -1';
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
    buildNav();
    renderSection();
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
    }).catch(function (err) {
      // Fall back to the published file so the editor still opens.
      return fetch('../' + CONTENT_PATH + '?v=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (data) { state.content = data; state.sha = null;
          toast('Loaded local copy (could not reach GitHub: ' + err.message + ')', true); });
    });
  }

  // ---------------------------------------------------------
  // Save: commit images, then content.json
  // ---------------------------------------------------------
  function save() {
    var btn = $('save');
    btn.disabled = true; btn.textContent = 'Saving…';

    var uploadPaths = Object.keys(state.uploads);
    var chain = Promise.resolve();

    uploadPaths.forEach(function (fieldPath) {
      var up = state.uploads[fieldPath];
      chain = chain.then(function () {
        return putFile(up.repoPath, up.base64, 'admin: upload image ' + up.repoPath);
      });
    });

    chain.then(function () {
      var json = JSON.stringify(state.content, null, 2) + '\n';
      return putFile(CONTENT_PATH, utf8ToB64(json), 'admin: update site content', state.sha);
    }).then(function (res) {
      state.sha = res.content.sha;
      state.uploads = {};
      btn.disabled = false; btn.textContent = 'Save changes';
      toast('Saved! GitHub Pages will rebuild in ~1 minute.');
      renderSection();
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = 'Save changes';
      toast('Save failed: ' + err.message, true);
    });
  }

  // ---------------------------------------------------------
  // Auth flows
  // ---------------------------------------------------------
  function doSetup() {
    var p1 = $('su_pass').value, p2 = $('su_pass2').value;
    var owner = $('su_owner').value.trim(), repo = $('su_repo').value.trim();
    var branch = $('su_branch').value.trim() || 'main', token = $('su_token').value.trim();
    var err = $('su_err'); err.textContent = '';
    if (p1.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
    if (p1 !== p2) { err.textContent = 'Passwords do not match.'; return; }
    if (!owner || !repo || !token) { err.textContent = 'Owner, repo and token are required.'; return; }

    var salt = crypto.getRandomValues(new Uint8Array(16));
    deriveKey(p1, salt).then(function (key) {
      return Promise.all([ encryptStr(key, 'CMS_OK'), encryptStr(key, token) ]).then(function (res) {
        saveStore({ salt: b64(salt), verify: res[0], token: res[1], owner: owner, repo: repo, branch: branch });
        state.cfg = { owner: owner, repo: repo, branch: branch };
        state.token = token;
        return loadContent().then(startApp);
      });
    }).catch(function (e) { err.textContent = 'Setup failed: ' + e.message; });
  }

  function doLogin() {
    var store = loadStore();
    var pass = $('li_pass').value;
    var err = $('li_err'); err.textContent = '';
    if (!store) { show('setup'); return; }
    deriveKey(pass, unb64(store.salt)).then(function (key) {
      return decryptStr(key, store.verify).then(function (v) {
        if (v !== 'CMS_OK') throw new Error('bad');
        return decryptStr(key, store.token);
      }).then(function (token) {
        state.cfg = { owner: store.owner, repo: store.repo, branch: store.branch };
        state.token = token;
        return loadContent().then(startApp);
      });
    }).catch(function () { err.textContent = 'Incorrect password.'; });
  }

  // ---------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------
  function init() {
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
      if (!confirm('Reset this browser? This removes the saved login and encrypted token from THIS device only. You will need your GitHub token to set up again.')) return;
      state.token = null; state.content = null;
      localStorage.removeItem(LS_KEY);
      toast('Local data cleared.');
      show('setup');
    });
    $('logout').addEventListener('click', function () {
      state.token = null; state.content = null; $('li_pass').value = ''; show('login');
    });
    $('save').addEventListener('click', save);

    show(loadStore() ? 'login' : 'setup');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
