/* ============================================================
   cms.js — content hydration for the static site (GitHub Pages safe)
   ------------------------------------------------------------
   - Loads /data/content.json and injects it into the page.
   - Singular fields use data-cms / data-cms-html / data-cms-attr.
   - Repeating sections use data-cms-list="key" and are rebuilt here.
   - If the JSON ever fails to load, the page keeps the hardcoded
     fallback markup, so the site never appears empty.
   - After hydration it loads the theme scripts, guaranteeing the
     sliders / circles / counters initialise on the final DOM.
   ============================================================ */
(function () {
  'use strict';

  // Theme scripts, in dependency order. cms.js injects them AFTER
  // hydration so Swiper/circle-progress/counterUp see the final DOM.
  var THEME_SCRIPTS = [
    'assets/js/jquery-3.6.0.min.js',
    'assets/js/waypoints.min.js',
    'assets/js/tw-elements.umd.min.js',
    'assets/js/cd-headline.js',
    'assets/js/jquery.counterup.min.js',
    'assets/js/swiper-bundle.min.js',
    'assets/js/scrollIt.min.js',
    'assets/js/circle-progress.min.js',
    'assets/js/script.js',
    'assets/js/theme-mode.js'
  ];

  // Resolve a dotted path ("a.b.0.c") against the data object.
  function get(obj, path) {
    if (path == null) return undefined;
    return String(path).split('.').reduce(function (acc, key) {
      return acc == null ? undefined : acc[key];
    }, obj);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Singular field hydration -------------------------------
  function hydrateFields(data) {
    document.querySelectorAll('[data-cms]').forEach(function (el) {
      var v = get(data, el.getAttribute('data-cms'));
      if (v !== undefined && v !== null) el.textContent = v;
    });

    document.querySelectorAll('[data-cms-html]').forEach(function (el) {
      var v = get(data, el.getAttribute('data-cms-html'));
      if (v !== undefined && v !== null) el.innerHTML = v;
    });

    // data-cms-attr="src:profile.photo, href:social.github"
    document.querySelectorAll('[data-cms-attr]').forEach(function (el) {
      el.getAttribute('data-cms-attr').split(',').forEach(function (pair) {
        var bits = pair.split(':');
        if (bits.length < 2) return;
        var attr = bits.shift().trim();
        var v = get(data, bits.join(':').trim());
        if (v !== undefined && v !== null) el.setAttribute(attr, v);
      });
    });
  }

  // ---- List renderers -----------------------------------------
  // Each returns an HTML string for one item, matching the
  // original template markup exactly.
  var renderers = {
    'profile.roles': function (role, i) {
      return '<b' + (i === 0 ? ' class="is-visible"' : '') + '>' + esc(role) + '</b>';
    },

    'profile.sidebarSkills': function (s) {
      return '' +
        '<div class="progressCircle">' +
          '<div class="relative w-12 h-12 circle" data-percent="' + esc(s.percent) + '" data-circlefill="#00BC91" data-circleempty="#777777">' +
            '<div class="absolute inset-0 text-[13px] font-medium label flex-center">' + esc(s.label != null ? s.label : (s.percent + '%')) + '</div>' +
          '</div>' +
          '<p class="text-[13px] font-normal dark:font-light text-black dark:text-white/90">' + esc(s.name) + '</p>' +
        '</div>';
    },

    'about.details': function (d) {
      return '' +
        '<li>' +
          '<span class="flex-[0_0_6rem]">' + esc(d.label) + '</span>' +
          '<span class="flex-[0_0_2rem]">:</span>' +
          '<span class="text-black dark:text-white">' + esc(d.value) + '</span>' +
        '</li>';
    },

    'about.counters': function (c) {
      return '' +
        '<li>' +
          '<div class="mb-1 text-2xl font-semibold md:text-3xl number text-theme 2xl:text-4xl">' +
            '<span>' + esc(c.number) + '</span>' + esc(c.suffix || '') +
          '</div>' +
          '<div class="text-sm">' + esc(c.label) + '</div>' +
        '</li>';
    },

    'services.items': function (s, i, ctx) {
      var icon = (s.icon && ctx.iconMap[s.icon]) || ctx.icons[i] || ctx.icons[0] || '';
      return '' +
        '<div class="card-item group hover:border-theme dark:hover:border-theme">' +
          '<div class="absolute transition duration-300 md:top-10 icon right-6 top-7 md:right-8 group-hover:-rotate-45 lg:top-11">' + icon + '</div>' +
          '<div class="text-5xl font-extrabold transition duration-300 md:text-6xl number lg:text-7xl text-greyBlack opacity-30 group-hover:opacity-100">' + esc(s.number) + '</div>' +
          '<h4 class="mt-5 mb-4 text-xl font-medium text-black dark:text-white xl:text-2xl">' + esc(s.title) + '</h4>' +
          '<p>' + esc(s.desc) + '</p>' +
        '</div>';
    },

    'skills.items': function (s) {
      return '' +
        '<div class="swiper-slide">' +
          '<div class="text-center icon">' +
            '<img src="' + esc(s.img) + '" alt="' + esc(s.name) + '">' +
          '</div>' +
          '<div class="progressCircle">' +
            '<div class="relative w-32 h-32 mx-auto circle md:w-40 md:h-40" data-percent="' + esc(s.percent) + '" data-circlefill="#00BC91" data-circleempty="#777777">' +
              '<div class="absolute inset-0 text-2xl font-semibold text-black dark:text-white label flex-center"></div>' +
            '</div>' +
          '</div>' +
          '<div class="text-black dark:text-white name">' + esc(s.name) + '</div>' +
        '</div>';
    },

    'resume.experience.items': function (x) {
      return timelineItem(x.company, x.period, x.role, x.desc);
    },
    'resume.education.items': function (x) {
      return timelineItem(x.school, x.period, x.degree, x.desc);
    },

    'portfolio.items': function (p) {
      var span = p.wide ? 'md:col-span-2' : 'md:col-span-1';
      return '' +
        '<div class="item ' + span + ' group">' +
          '<a href="' + esc(p.href || '#') + '" class="block p-3 overflow-hidden border md:p-4 rounded-xl border-platinum dark:border-greyBlack">' +
            '<div class="img-wrapper">' +
              '<img src="' + esc(p.image) + '" class="rounded-lg max-md:h-[17rem] w-full max-md:object-cover max-md:object-center transition-all duration-300 group-hover:blur-xs" alt="' + esc(p.title) + '">' +
              '<div class="absolute inset-0 transition-all duration-300 opacity-0 overlay bg-gradient-to-t from-white dark:from-black to-transparent rounded-xl group-hover:opacity-100"></div>' +
            '</div>' +
            '<div class="info text-center position-center max-lg:text-3xl text-lead font-semibold text-black dark:text-white leading-1.15 transition duration-500 scale-110 opacity-0 group-hover:scale-100 group-hover:opacity-100 relative z-10">' +
              esc(p.title) + ' <span>' + esc(p.subtitle || '') + '</span>' +
            '</div>' +
          '</a>' +
          (p.tag ? '<ul class="absolute z-10 transition-all duration-500 opacity-0 md:top-9 md:right-9 top-6 right-6 group-hover:opacity-100">' +
            '<li><a href="' + esc(p.href || '#') + '" class="inline-flex items-center gap-2 px-5 py-3 text-sm font-light leading-none text-white transition-colors bg-metalBlack rounded-3xl hover:text-theme">' + esc(p.tag) + '</a></li>' +
          '</ul>' : '') +
        '</div>';
    },

    'certificates.items': function (c) {
      return '' +
        '<div class="article group">' +
          '<div class="thumbnail overflow-hidden flex col-span-12 sm:col-span-6 md:col-span-5">' +
            '<a href="' + esc(c.href || '#') + '" class="block w-full overflow-hidden rounded-xl">' +
              '<img src="' + esc(c.image) + '" class="object-cover object-center w-full h-full min-h-[288px] max-h-60 md:min-h-60 transition-all duration-300 ease-in-out group-hover:scale-105" alt="' + esc(c.title) + '">' +
            '</a>' +
          '</div>' +
          '<div class="post-content relative px-3 pt-6 pb-2 md:p-5 flex flex-col col-span-12 sm:col-span-6 md:col-span-7">' +
            '<div class="flex items-center gap-5">' +
              '<div class="text-sm font-medium tags">' +
                '<a href="#" class="transition-colors hover:text-theme">Skills:</a> ' +
                '<span class="post_date">' + esc(c.skills || '') + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="post-title mt-3 md:mt-4.5 mb-6 md:mb-8">' +
              '<a href="' + esc(c.href || '#') + '" class="text-xl font-semibold leading-normal text-black dark:text-white transition-colors line-clamp-2 2xl:text-2xl 2xl:leading-normal hover:text-theme">' + esc(c.title) + '</a>' +
            '</div>' +
            '<div class="read-details">' +
              '<a href="' + esc(c.href || '#') + '" class="inline-flex items-center gap-2 border border-theme text-theme text-sm py-3.5 px-6 rounded-3xl leading-none transition-all duration-300 hover:bg-themeHover hover:border-themeHover dark:font-medium hover:text-white">Details</a>' +
            '</div>' +
          '</div>' +
        '</div>';
    },

    'ctf.items': function (c) {
      return '' +
        '<div class="group relative rounded-2xl overflow-hidden border border-platinum dark:border-metalBlack hover:border-theme dark:hover:border-theme transition duration-300">' +
          '<img src="' + esc(c.image) + '" alt="CTF Challenge" class="w-full h-auto object-cover group-hover:scale-105 transition duration-300">' +
          '<div class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition duration-300">' +
            '<a href="' + esc(c.href || '#') + '" target="_blank" class="text-white font-medium underline">' + esc(c.label || 'View') + '</a>' +
          '</div>' +
        '</div>';
    }
  };

  function timelineItem(heading, period, title, desc) {
    var descHtml = desc ? String(desc).split('\n').map(function (line) {
      return esc(line);
    }).join('<br>') : '';
    return '' +
      '<li>' +
        '<div class="flex items-center justify-between mb-5 md:w-64 md:block md:mb-0">' +
          (heading ? '<h6 class="text-sm font-medium text-black dark:text-white text-opacity-60 md:text-base md:text-opacity-100">' + esc(heading) + '</h6>' : '') +
          (period ? '<p class="text-[13px] md:text-sm text-theme">' + esc(period) + '</p>' : '') +
        '</div>' +
        '<div class="md:flex-1 md:pl-16 relative md:before:content-[\'\'] md:before:absolute md:before:-left-1 md:before:top-3 md:before:w-2 md:before:h-2 md:before:bg-theme md:before:rounded-full md:before:shadow-dots_glow">' +
          (title ? '<h4 class="text-xl xl:text-2xl font-medium xl:font-medium leading-7 text-black dark:text-white mb-2.5">' + esc(title) + '</h4>' : '') +
          (descHtml ? '<p>' + descHtml + '</p>' : '') +
        '</div>' +
      '</li>';
  }

  function hydrateLists(data) {
    document.querySelectorAll('[data-cms-list]').forEach(function (container) {
      var key = container.getAttribute('data-cms-list');
      var renderer = renderers[key];
      var items = get(data, key);
      if (!renderer || !Array.isArray(items)) return;

      // For services, reuse the existing inline SVG icons from the DOM.
      // Original card order is web, shield, gear, strategy.
      var ctx = { icons: [], iconMap: {} };
      if (key === 'services.items') {
        container.querySelectorAll('.card-item .icon').forEach(function (iconEl) {
          ctx.icons.push(iconEl.innerHTML);
        });
        var names = ['web', 'shield', 'gear', 'strategy'];
        ctx.icons.forEach(function (svg, idx) {
          if (names[idx]) ctx.iconMap[names[idx]] = svg;
        });
      }

      container.innerHTML = items.map(function (item, i) {
        return renderer(item, i, ctx);
      }).join('');
    });
  }

  function applyMeta(data) {
    if (data.site) {
      if (data.site.title) document.title = data.site.title;
      var desc = document.querySelector('meta[name="description"]');
      if (desc && data.site.metaDescription) desc.setAttribute('content', data.site.metaDescription);
      var fav = document.querySelector('link[rel="shortcut icon"], link[rel="icon"]');
      if (fav && data.site.favicon) fav.setAttribute('href', data.site.favicon);
    }
  }

  // ---- Contact form (static-friendly) -------------------------
  function wireContactForm(data) {
    var form = document.getElementById('contactForm');
    if (!form) return;
    var endpoint = data.contact && data.contact.formEndpoint;
    var email = (data.contact && data.contact.email) || '';
    form.setAttribute('action', endpoint || '#');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var name = fd.get('client__name') || '';
      var from = fd.get('client_email') || '';
      var message = fd.get('contact__message') || '';
      var btn = form.querySelector('button[type="submit"]');

      if (endpoint) {
        if (btn) { btn.disabled = true; btn.dataset._t = btn.textContent; btn.textContent = 'Sending…'; }
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: fd
        }).then(function (r) {
          if (r.ok) { form.reset(); alert('Thanks! Your message has been sent.'); }
          else { alert('Sorry, something went wrong. Please email me directly at ' + email); }
        }).catch(function () {
          alert('Network error. Please email me directly at ' + email);
        }).finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset._t || 'Send Message'; }
        });
      } else {
        // No endpoint configured → open the visitor's mail client.
        var subject = encodeURIComponent('Portfolio contact from ' + name);
        var body = encodeURIComponent(message + '\n\nFrom: ' + name + ' <' + from + '>');
        window.location.href = 'mailto:' + email + '?subject=' + subject + '&body=' + body;
      }
    });
  }

  function loadThemeScripts(i) {
    i = i || 0;
    if (i >= THEME_SCRIPTS.length) return;
    var s = document.createElement('script');
    s.src = THEME_SCRIPTS[i];
    s.onload = function () { loadThemeScripts(i + 1); };
    s.onerror = function () { loadThemeScripts(i + 1); };
    document.body.appendChild(s);
  }

  function hydrate(data) {
    try {
      applyMeta(data);
      hydrateLists(data);
      hydrateFields(data);
      wireContactForm(data);
    } catch (err) {
      if (window.console) console.error('[cms] hydration error', err);
    }
  }

  function dataUrl() {
    // Works from the site root and from sub-pages at the root.
    return 'data/content.json?v=' + Date.now();
  }

  fetch(dataUrl(), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) { window.__CONTENT__ = data; hydrate(data); })
    .catch(function (err) {
      if (window.console) console.warn('[cms] using fallback content:', err.message);
    })
    .finally(function () { loadThemeScripts(0); });
})();
